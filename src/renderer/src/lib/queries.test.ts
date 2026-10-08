import { describe, expect, it } from 'vitest'
import { QueryObserver } from '@tanstack/react-query'
import { ApiError } from './api'
import { createQueryClient, queryKeys, refetchAfterMutation, shouldRetryQuery } from './queries'

describe('query client defaults', () => {
  it('retries a read once for transient errors only', () => {
    expect(shouldRetryQuery(0, new ApiError('NETWORK', 'offline'))).toBe(true)
    expect(shouldRetryQuery(1, new ApiError('NETWORK', 'offline'))).toBe(false)
    expect(shouldRetryQuery(0, new ApiError('NOT_FOUND', 'gone'))).toBe(false)
    expect(shouldRetryQuery(0, new Error('anything'))).toBe(true)
  })

  it('never retries mutations and keeps data fresh for a few seconds', () => {
    const client = createQueryClient()
    const defaults = client.getDefaultOptions()
    expect(defaults.mutations?.retry).toBe(false)
    expect(defaults.queries?.staleTime).toBe(10_000)
    expect(defaults.queries?.refetchOnWindowFocus).toBe(true)
  })
})

describe('query keys', () => {
  it('start with the method name so prefixes can be invalidated', () => {
    expect(queryKeys.topics('nb1')).toEqual(['listTopics', 'nb1'])
    expect(queryKeys.cards('nb1')).toEqual(['listCards', 'nb1', null])
    expect(queryKeys.cards('nb1', 't1')).toEqual(['listCards', 'nb1', 't1'])
    expect(queryKeys.quizzes('nb1', 'mock_exam')).toEqual(['listQuizzes', 'nb1', 'mock_exam'])
    expect(queryKeys.reviewQueue()).toEqual(['getReviewQueue', {}])
    expect(queryKeys.exams()).toEqual(['listExams', null])
  })
})

describe('refetchAfterMutation', () => {
  // A query a screen is showing: subscribed, so invalidating it refetches it.
  async function shownQuery(client: ReturnType<typeof createQueryClient>, queryKey: readonly unknown[], fetch: () => Promise<string>) {
    const observer = new QueryObserver(client, { queryKey, queryFn: fetch, retry: false })
    const unsubscribe = observer.subscribe(() => undefined)
    await client.getQueryCache().find({ queryKey })?.promise
    return unsubscribe
  }

  it('resolves only once the shown queries have their new data', async () => {
    const client = createQueryClient()
    let version = 0
    let release!: () => void
    const unsubscribe = await shownQuery(client, ['getTopic', 't1'], async () => {
      version += 1
      if (version > 1) await new Promise<void>((resolve) => (release = resolve))
      return `v${version}`
    })
    let done = false
    const refetched = refetchAfterMutation(client, [['getTopic', 't1']]).then(() => (done = true))
    await Promise.resolve()
    await Promise.resolve()
    expect(done).toBe(false)
    release()
    await refetched
    expect(client.getQueryData(['getTopic', 't1'])).toBe('v2')
    unsubscribe()
  })

  it('leaves other queries alone for a list of keys, and everything stale for all', async () => {
    const client = createQueryClient()
    client.setQueryData(['getTopic', 't1'], 'topic')
    client.setQueryData(['getToday'], 'today')
    await refetchAfterMutation(client, [['getTopic']])
    expect(client.getQueryState(['getTopic', 't1'])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['getToday'])?.isInvalidated).toBe(false)
    await refetchAfterMutation(client, 'none')
    expect(client.getQueryState(['getToday'])?.isInvalidated).toBe(false)
    await refetchAfterMutation(client, 'all')
    expect(client.getQueryState(['getToday'])?.isInvalidated).toBe(true)
  })

  it('does not reject when a refetch fails (the query shows the error)', async () => {
    const client = createQueryClient()
    let calls = 0
    const unsubscribe = await shownQuery(client, ['getToday'], async () => {
      calls += 1
      if (calls > 1) throw new ApiError('NETWORK', 'offline')
      return 'today'
    })
    await expect(refetchAfterMutation(client, 'all')).resolves.toBeUndefined()
    expect(client.getQueryState(['getToday'])?.status).toBe('error')
    unsubscribe()
  })
})

import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { createQueryClient, queryKeys, shouldRetryQuery } from './queries'

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

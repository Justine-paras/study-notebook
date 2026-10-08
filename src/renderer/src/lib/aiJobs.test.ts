import { describe, expect, it, vi } from 'vitest'
import { finishedJobToast } from '../components/AiJobNotifier'
import { ApiError } from './api'
import { AiJobStore, type AiJob } from './aiJobs'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const META = { task: 'lesson' as const, label: 'Lesson on Heaps', href: '/topics/t1' }

describe('AiJobStore', () => {
  it('runs a job once: a second start while it runs joins the running call', async () => {
    const store = new AiJobStore(() => 1000)
    const call = deferred<string>()
    const fn = vi.fn(() => call.promise)
    const first = store.start('lesson:t1', META, fn)
    const second = store.start('lesson:t1', META, fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
    expect(store.isPending('lesson:t1')).toBe(true)
    expect(store.get('lesson:t1')).toMatchObject({ status: 'pending', startedAt: 1000, label: 'Lesson on Heaps', href: '/topics/t1' })
    call.resolve('lesson')
    await expect(first).resolves.toBe('lesson')
    expect(store.get('lesson:t1')).toMatchObject({ status: 'success', data: 'lesson', error: null })
    expect(store.isPending('lesson:t1')).toBe(false)
  })

  it('runs different keys side by side and can start a key again once it finished', async () => {
    const store = new AiJobStore()
    const fn = vi.fn(async () => 'ok')
    await Promise.all([store.start('a', META, fn), store.start('b', META, fn)])
    await store.start('a', META, fn)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('keeps the error (as ApiError) after the call fails, until dismissed', async () => {
    const store = new AiJobStore()
    const failing = store.start('quiz:t1', { ...META, task: 'quiz' }, async () => {
      throw new ApiError('RATE_LIMITED', 'slow down')
    })
    await expect(failing).rejects.toBeInstanceOf(ApiError)
    const job = store.get('quiz:t1')
    expect(job?.status).toBe('error')
    expect(job?.error?.code).toBe('RATE_LIMITED')
    store.dismiss('quiz:t1')
    expect(store.get('quiz:t1')).toBeUndefined()
  })

  it('turns anything thrown into an ApiError and survives a call that throws synchronously', async () => {
    const store = new AiJobStore()
    const run = store.start('x', META, () => {
      throw new Error('boom')
    })
    await expect(run).rejects.toMatchObject({ code: 'UNKNOWN', message: 'boom' })
    expect(store.get('x')?.status).toBe('error')
  })

  it('never dismisses a running job', () => {
    const store = new AiJobStore()
    void store.start('x', META, () => new Promise<never>(() => undefined))
    store.dismiss('x')
    expect(store.get('x')?.status).toBe('pending')
  })

  it('lists running jobs oldest first, with a stable array between changes', async () => {
    let now = 10
    const store = new AiJobStore(() => now)
    const a = deferred<void>()
    void store.start('a', META, () => a.promise)
    now = 20
    void store.start('b', { ...META, task: 'summary' }, () => new Promise<never>(() => undefined))
    const list = store.pending()
    expect(list.map((j) => j.key)).toEqual(['a', 'b'])
    expect(store.pending()).toBe(list)
    a.resolve()
    await a.promise
    await Promise.resolve()
    expect(store.pending().map((j) => j.key)).toEqual(['b'])
  })

  it('resolves the result link from the data when given a function', async () => {
    const store = new AiJobStore()
    await store.start('mock:nb1', { task: 'quiz', label: 'Your mock exam', href: (quiz: { id: string }) => `/quiz/${quiz.id}` }, async () => ({ id: 'q9' }))
    expect(store.get('mock:nb1')?.href).toBe('/quiz/q9')
  })

  it('tells finish listeners whether a screen was watching the job', async () => {
    const store = new AiJobStore()
    const seen: [string, boolean][] = []
    store.onFinish((job, shown) => seen.push([job.key, shown]))
    const stopWatching = store.watch('shown')
    await store.start('shown', META, async () => 1)
    await store.start('away', META, async () => 2)
    stopWatching()
    await store.start('shown', META, async () => 3)
    expect(seen).toEqual([
      ['shown', true],
      ['away', false],
      ['shown', false]
    ])
  })

  it('counts several watchers and ignores a second unwatch', async () => {
    const store = new AiJobStore()
    const shown: boolean[] = []
    store.onFinish((_job, isShown) => shown.push(isShown))
    const one = store.watch('k')
    const two = store.watch('k')
    one()
    one()
    await store.start('k', META, async () => 1)
    two()
    await store.start('k', META, async () => 2)
    expect(shown).toEqual([true, false])
  })

  it('notifies subscribers on every change', async () => {
    const store = new AiJobStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    await store.start('k', META, async () => 1)
    expect(listener).toHaveBeenCalledTimes(2) // pending, then success
    store.dismiss('k')
    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
    await store.start('k', META, async () => 1)
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('keeps the call arguments on the job for a retry', async () => {
    const store = new AiJobStore()
    await store.start('k', { ...META, args: ['t1', { regenerate: true }] }, async () => 1)
    expect(store.get('k')?.args).toEqual(['t1', { regenerate: true }])
  })
})

function job(overrides: Partial<AiJob>): AiJob {
  return {
    key: 'k',
    task: 'lesson',
    label: 'Lesson on Heaps',
    href: '/topics/t1',
    args: [],
    status: 'success',
    startedAt: 0,
    finishedAt: 1,
    data: undefined,
    error: null,
    announceSuccess: true,
    ...overrides
  }
}

describe('finishedJobToast', () => {
  it('announces a finished job with a link to its result', () => {
    const go = vi.fn()
    const toast = finishedJobToast(job({}), go)
    expect(toast).toMatchObject({ tone: 'good', title: 'Your lesson is ready', message: 'Lesson on Heaps' })
    toast?.action?.onClick()
    expect(go).toHaveBeenCalledWith('/topics/t1')
  })

  it('stays quiet when the caller announces successes itself', () => {
    expect(finishedJobToast(job({ announceSuccess: false }), vi.fn())).toBeNull()
  })

  it('sends key problems to Settings and keeps the toast until dismissed', () => {
    const go = vi.fn()
    const toast = finishedJobToast(job({ status: 'error', error: new ApiError('NO_API_KEY', 'missing') }), go)
    expect(toast).toMatchObject({ tone: 'bad', title: "Your lesson couldn't be written", duration: 0 })
    expect(toast?.message).toContain('Settings')
    expect(toast?.action?.label).toBe('Open Settings')
    toast?.action?.onClick()
    expect(go).toHaveBeenCalledWith('/settings')
  })

  it('links other failures back to where the job can be retried', () => {
    const go = vi.fn()
    const toast = finishedJobToast(job({ status: 'error', task: 'summary', label: 'Week 2.pdf', href: '/notebooks/nb1', error: new ApiError('NETWORK', 'offline') }), go)
    expect(toast).toMatchObject({ title: "Your summary couldn't be written", action: { label: 'Go there' } })
    expect(toast?.message).toMatch(/^Week 2\.pdf: /)
    toast?.action?.onClick()
    expect(go).toHaveBeenCalledWith('/notebooks/nb1')
  })
})

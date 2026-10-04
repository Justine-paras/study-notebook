// Long AI calls (lessons, quizzes, mock exams, summaries, syllabus reading,
// explanation feedback, flashcards) run as app-wide jobs. With the real API
// they take 30 to 120 seconds, so a job must outlive the component that
// started it: the learner can leave the page and come back to the same
// progress, the same job never runs twice (a double click, a second visit, a
// remount), and its result or error is still there afterwards. When a job
// finishes while no screen shows it, <AiJobNotifier> announces it with a toast.

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { StudyApiMethod } from '@shared/api'
import type { AiTask } from '@shared/types'
import { api, toApiError, type ApiError } from './api'
import { ensureAiProgressListener } from './aiProgress'
import { refetchAfterMutation, type ApiArgs, type ApiReturn, type InvalidateTarget } from './queries'

export type AiJobStatus = 'pending' | 'success' | 'error'

export interface AiJob<T = unknown> {
  key: string
  task: AiTask
  /** What is being made, e.g. "Lesson on Heaps" (top bar and toasts). */
  label: string
  /** The page that shows the result, when there is one. */
  href: string | null
  /** The call's arguments, so it can be retried after the starting screen is gone. */
  args: readonly unknown[]
  status: AiJobStatus
  /** Renderer clock (epoch ms) when the call started. */
  startedAt: number
  finishedAt: number | null
  data: T | undefined
  error: ApiError | null
  /** False when the success toast is left to the caller (it announces the result itself). */
  announceSuccess: boolean
}

export interface AiJobMeta<T> {
  task: AiTask
  label: string
  /** Where the result can be seen; may depend on it (a new quiz's page). */
  href?: string | ((data: T) => string) | null
  /** Default true: toast the result when nobody is watching the job. */
  announceSuccess?: boolean
  args?: readonly unknown[]
}

/** Called once per finished job. `shown` is false when no mounted screen was watching it. */
export type AiJobFinishListener = (job: AiJob, shown: boolean) => void

function resolveHref<T>(href: AiJobMeta<T>['href'], data: T | undefined): string | null {
  if (typeof href === 'function') return data === undefined ? null : href(data)
  return href ?? null
}

export class AiJobStore {
  private readonly jobs = new Map<string, AiJob>()
  private readonly running = new Map<string, Promise<unknown>>()
  private readonly watchers = new Map<string, number>()
  private readonly listeners = new Set<() => void>()
  private readonly finishListeners = new Set<AiJobFinishListener>()
  private pendingList: readonly AiJob[] = []

  constructor(private readonly now: () => number = Date.now) {}

  /** The latest job for `key` (a new object after every change, so it works as a store snapshot). */
  get(key: string): AiJob | undefined {
    return this.jobs.get(key)
  }

  isPending(key: string): boolean {
    return this.running.has(key)
  }

  /** Running jobs, oldest first. The same array until something changes. */
  pending(): readonly AiJob[] {
    return this.pendingList
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  onFinish(listener: AiJobFinishListener): () => void {
    this.finishListeners.add(listener)
    return () => {
      this.finishListeners.delete(listener)
    }
  }

  /** Marks `key` as shown on screen until the returned function is called. */
  watch(key: string): () => void {
    this.watchers.set(key, (this.watchers.get(key) ?? 0) + 1)
    let done = false
    return () => {
      if (done) return
      done = true
      const left = (this.watchers.get(key) ?? 1) - 1
      if (left > 0) this.watchers.set(key, left)
      else this.watchers.delete(key)
    }
  }

  /**
   * Runs `call` as the job `key`. While that job is still running, a second
   * start returns the running call's promise and `call` is not made again.
   * Rejects with ApiError.
   */
  start<T>(key: string, meta: AiJobMeta<T>, call: () => Promise<T>): Promise<T> {
    const existing = this.running.get(key)
    if (existing) return existing as Promise<T>
    ensureAiProgressListener()
    const startedAt = this.now()
    const base = {
      key,
      task: meta.task,
      label: meta.label,
      args: meta.args ?? [],
      startedAt,
      announceSuccess: meta.announceSuccess ?? true
    }
    this.set({ ...base, href: resolveHref(meta.href, undefined), status: 'pending', finishedAt: null, data: undefined, error: null })

    let promise: Promise<T>
    try {
      promise = Promise.resolve(call())
    } catch (err) {
      promise = Promise.reject(err)
    }
    const tracked = promise.then(
      (data) => {
        this.finish({ ...base, href: resolveHref(meta.href, data), status: 'success', finishedAt: this.now(), data, error: null })
        return data
      },
      (err: unknown) => {
        const error = toApiError(err)
        this.finish({ ...base, href: resolveHref(meta.href, undefined), status: 'error', finishedAt: this.now(), data: undefined, error })
        throw error
      }
    )
    this.running.set(key, tracked)
    // Callers may ignore the promise; the error lives on in the job.
    tracked.catch(() => undefined)
    return tracked
  }

  /** Forgets a finished job (its result or error). A running job is kept. */
  dismiss(key: string): void {
    if (this.running.has(key) || !this.jobs.has(key)) return
    this.jobs.delete(key)
    this.changed()
  }

  private finish(job: AiJob): void {
    this.running.delete(job.key)
    this.set(job)
    const shown = (this.watchers.get(job.key) ?? 0) > 0
    for (const listener of [...this.finishListeners]) {
      try {
        listener(job, shown)
      } catch {
        // A failing toast must not break the job's own result.
      }
    }
  }

  private set(job: AiJob): void {
    this.jobs.set(job.key, job)
    this.changed()
  }

  private changed(): void {
    this.pendingList = [...this.jobs.values()].filter((j) => j.status === 'pending').sort((a, b) => a.startedAt - b.startedAt)
    for (const listener of [...this.listeners]) listener()
  }
}

/** The app's job store (one window, one learner). */
export const aiJobs = new AiJobStore()

/** The latest job for `key` (null for none), re-rendering as it changes. Marks it as shown while mounted. */
export function useAiJob<T>(key: string | null): AiJob<T> | null {
  const job = useSyncExternalStore(aiJobs.subscribe, () => (key ? (aiJobs.get(key) ?? null) : null))
  useEffect(() => (key ? aiJobs.watch(key) : undefined), [key])
  return job as AiJob<T> | null
}

/** Every running job, oldest first (for the top bar). */
export function usePendingAiJobs(): readonly AiJob[] {
  return useSyncExternalStore(aiJobs.subscribe, () => aiJobs.pending())
}

export interface AiActionOptions<M extends StudyApiMethod> extends Omit<AiJobMeta<ApiReturn<M>>, 'label' | 'args'> {
  /** What is being made; a function gets the call's arguments. */
  label: string | ((args: ApiArgs<M>) => string)
  /** What to refetch on success. Default: everything (as useApiMutation). */
  invalidate?: InvalidateTarget
  /**
   * Runs on success even after the starting screen was left: persist results
   * here (storage, cache). Setting component state from it is harmless but
   * may land on an unmounted component.
   */
  onSuccess?: (data: ApiReturn<M>, args: ApiArgs<M>) => void
}

export interface AiAction<M extends StudyApiMethod> {
  job: AiJob<ApiReturn<M>> | null
  isPending: boolean
  /** The last run's error, until it is retried or dismissed. */
  error: ApiError | null
  /** The last successful run's result. */
  data: ApiReturn<M> | undefined
  /** Starts the call unless this job is already running. Never throws. */
  run: (...args: ApiArgs<M>) => void
  /** Like run, but returns the result and rejects with ApiError. */
  runAsync: (...args: ApiArgs<M>) => Promise<ApiReturn<M>>
  /** Runs the last call again with the same arguments (no-op without one). */
  retry: () => void
  /** Forgets a finished run's error or result. */
  dismiss: () => void
}

/**
 * An AI call as an app-wide job identified by `key` (e.g. `lesson:<topicId>`):
 *
 *   const lesson = useAiAction('generateLesson', `lesson:${topic.id}`, { task: 'lesson', label: `Lesson on ${topic.title}`, href })
 *   lesson.run(topic.id)
 *   {lesson.isPending && <AiWorking task="lesson" startedAt={lesson.job?.startedAt} />}
 *   <ErrorNotice error={lesson.error} onRetry={() => lesson.run(topic.id)} onDismiss={lesson.dismiss} />
 *
 * `key` null disables run (e.g. while ids are loading).
 */
export function useAiAction<M extends StudyApiMethod>(method: M, key: string | null, options: AiActionOptions<M>): AiAction<M> {
  const queryClient = useQueryClient()
  const job = useAiJob<ApiReturn<M>>(key)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const runAsync = useCallback(
    (...args: ApiArgs<M>): Promise<ApiReturn<M>> => {
      if (!key) return Promise.reject(toApiError(new Error('This action is not ready yet.')))
      const { invalidate = 'all', onSuccess, task, label, href, announceSuccess } = optionsRef.current
      const meta = { task, label: typeof label === 'function' ? label(args) : label, href, announceSuccess, args }
      return aiJobs.start(key, meta, async () => {
        // TS can't relate api[M] to its own Parameters/ReturnType for a generic M.
        const fn = api[method] as unknown as (...a: ApiArgs<M>) => Promise<ApiReturn<M>>
        const data = await fn(...args)
        try {
          onSuccess?.(data, args)
        } catch {
          // The result is saved; a failing follow-up must not report the job as failed.
        }
        // The job only reads as done once the screens have the new data, so the
        // old view (e.g. "Create my lesson") can't flash and be clicked again.
        await refetchAfterMutation(queryClient, invalidate)
        return data
      })
    },
    [key, method, queryClient]
  )

  const run = useCallback((...args: ApiArgs<M>) => void runAsync(...args).catch(() => undefined), [runAsync])
  const retry = useCallback(() => {
    const last = key ? aiJobs.get(key) : undefined
    if (last && last.status !== 'pending') run(...(last.args as ApiArgs<M>))
  }, [key, run])
  const dismiss = useCallback(() => {
    if (key) aiJobs.dismiss(key)
  }, [key])

  return useMemo(
    () => ({
      job,
      isPending: job?.status === 'pending',
      error: job?.status === 'error' ? job.error : null,
      data: job?.status === 'success' ? job.data : undefined,
      run,
      runAsync,
      retry,
      dismiss
    }),
    [job, run, runAsync, retry, dismiss]
  )
}

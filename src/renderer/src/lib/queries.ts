// React Query layer: stable query keys, one hook per StudyApi read method, and
// useApiMutation for writes. Everything is local and cheap, so a successful
// mutation simply invalidates every query (screens never hand-maintain caches).

import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult
} from '@tanstack/react-query'
import type { StudyApi, StudyApiMethod } from '@shared/api'
import type {
  Card,
  Exam,
  ID,
  Insights,
  Lesson,
  Note,
  NotebookSummary,
  Quiz,
  QuizKind,
  QuizResult,
  ReviewCard,
  Settings,
  Source,
  SourceText,
  TodayOverview,
  TopicWithProgress
} from '@shared/types'
import { api, ApiError, toApiError } from './api'

// ---------------------------------------------------------------------------
// Query client
// ---------------------------------------------------------------------------

/** Retries a failed read once, unless the error will just happen again. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < 1 && toApiError(error).retryable
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        retry: shouldRetryQuery,
        refetchOnWindowFocus: true
      },
      mutations: {
        // Writes (and AI generations) must never run twice behind the learner's back.
        retry: false
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export type ReviewQueueOptions = NonNullable<Parameters<StudyApi['getReviewQueue']>[0]>

/** Every key starts with the method name, so `queryKeys.x()` prefixes can be invalidated. */
export const queryKeys = {
  notebooks: () => ['listNotebooks'] as const,
  notebook: (id: ID) => ['getNotebook', id] as const,
  sources: (notebookId: ID) => ['listSources', notebookId] as const,
  sourceText: (sourceId: ID) => ['getSourceText', sourceId] as const,
  topics: (notebookId: ID) => ['listTopics', notebookId] as const,
  topic: (id: ID) => ['getTopic', id] as const,
  lesson: (topicId: ID) => ['getLesson', topicId] as const,
  quizzes: (notebookId: ID, kind?: QuizKind) => ['listQuizzes', notebookId, kind ?? null] as const,
  quiz: (id: ID) => ['getQuiz', id] as const,
  quizResult: (id: ID) => ['getQuizResult', id] as const,
  reviewQueue: (options: ReviewQueueOptions = {}) => ['getReviewQueue', options] as const,
  cards: (notebookId: ID, topicId?: ID) => ['listCards', notebookId, topicId ?? null] as const,
  notes: (notebookId: ID, topicId?: ID) => ['listNotes', notebookId, topicId ?? null] as const,
  exams: (notebookId?: ID) => ['listExams', notebookId ?? null] as const,
  today: () => ['getToday'] as const,
  insights: () => ['getInsights'] as const,
  settings: () => ['getSettings'] as const
}

// ---------------------------------------------------------------------------
// Read hooks
// ---------------------------------------------------------------------------

/**
 * Extra react-query options a screen may pass (enabled, staleTime,
 * refetchInterval, select is not supported to keep return types simple).
 */
export type QueryOptions<T> = Omit<UseQueryOptions<T, ApiError, T, QueryKey>, 'queryKey' | 'queryFn' | 'select'>

function useApiQuery<T>(
  queryKey: QueryKey,
  queryFn: () => Promise<T>,
  options: QueryOptions<T> | undefined,
  ready = true
): UseQueryResult<T, ApiError> {
  return useQuery<T, ApiError, T, QueryKey>({
    ...options,
    queryKey,
    queryFn: async () => {
      try {
        return await queryFn()
      } catch (err) {
        throw toApiError(err)
      }
    },
    // `ready` guards hooks whose id is still undefined (route params, dependent queries).
    enabled: ready && (options?.enabled ?? true)
  })
}

// The `?? ''` placeholders below are never sent: the query is disabled until the id exists.

export function useNotebooks(options?: QueryOptions<NotebookSummary[]>) {
  return useApiQuery(queryKeys.notebooks(), () => api.listNotebooks(), options)
}

export function useNotebook(id: ID | undefined, options?: QueryOptions<NotebookSummary>) {
  return useApiQuery(queryKeys.notebook(id ?? ''), () => api.getNotebook(id!), options, !!id)
}

export function useSources(notebookId: ID | undefined, options?: QueryOptions<Source[]>) {
  return useApiQuery(queryKeys.sources(notebookId ?? ''), () => api.listSources(notebookId!), options, !!notebookId)
}

export function useSourceText(sourceId: ID | undefined, options?: QueryOptions<SourceText>) {
  return useApiQuery(queryKeys.sourceText(sourceId ?? ''), () => api.getSourceText(sourceId!), options, !!sourceId)
}

export function useTopics(notebookId: ID | undefined, options?: QueryOptions<TopicWithProgress[]>) {
  return useApiQuery(queryKeys.topics(notebookId ?? ''), () => api.listTopics(notebookId!), options, !!notebookId)
}

export function useTopic(id: ID | undefined, options?: QueryOptions<TopicWithProgress>) {
  return useApiQuery(queryKeys.topic(id ?? ''), () => api.getTopic(id!), options, !!id)
}

/** The topic's current lesson, or null when none has been generated yet. */
export function useLesson(topicId: ID | undefined, options?: QueryOptions<Lesson | null>) {
  return useApiQuery(queryKeys.lesson(topicId ?? ''), () => api.getLesson(topicId!), options, !!topicId)
}

export function useQuizzes(notebookId: ID | undefined, kind?: QuizKind, options?: QueryOptions<Quiz[]>) {
  return useApiQuery(
    queryKeys.quizzes(notebookId ?? '', kind),
    () => api.listQuizzes(notebookId!, kind),
    options,
    !!notebookId
  )
}

export function useQuiz(id: ID | undefined, options?: QueryOptions<Quiz>) {
  return useApiQuery(queryKeys.quiz(id ?? ''), () => api.getQuiz(id!), options, !!id)
}

/** Only valid for submitted quizzes: pass `{ enabled: !!quiz?.submittedAt }`. */
export function useQuizResult(id: ID | undefined, options?: QueryOptions<QuizResult>) {
  return useApiQuery(queryKeys.quizResult(id ?? ''), () => api.getQuizResult(id!), options, !!id)
}

/**
 * Due cards. The queue changes after every review (and every mutation
 * invalidates it), so review screens should copy it into local state when a
 * session starts instead of rendering this query live.
 */
export function useReviewQueue(queueOptions?: ReviewQueueOptions, options?: QueryOptions<ReviewCard[]>) {
  return useApiQuery(queryKeys.reviewQueue(queueOptions), () => api.getReviewQueue(queueOptions), options)
}

export function useCards(notebookId: ID | undefined, topicId?: ID, options?: QueryOptions<Card[]>) {
  return useApiQuery(
    queryKeys.cards(notebookId ?? '', topicId),
    () => api.listCards(notebookId!, topicId),
    options,
    !!notebookId
  )
}

export function useNotes(notebookId: ID | undefined, topicId?: ID, options?: QueryOptions<Note[]>) {
  return useApiQuery(
    queryKeys.notes(notebookId ?? '', topicId),
    () => api.listNotes(notebookId!, topicId),
    options,
    !!notebookId
  )
}

/** Exams of one notebook, or of every notebook when `notebookId` is omitted. */
export function useExams(notebookId?: ID, options?: QueryOptions<Exam[]>) {
  return useApiQuery(queryKeys.exams(notebookId), () => api.listExams(notebookId), options)
}

export function useToday(options?: QueryOptions<TodayOverview>) {
  return useApiQuery(queryKeys.today(), () => api.getToday(), options)
}

export function useInsights(options?: QueryOptions<Insights>) {
  return useApiQuery(queryKeys.insights(), () => api.getInsights(), options)
}

export function useSettings(options?: QueryOptions<Settings>) {
  return useApiQuery(queryKeys.settings(), () => api.getSettings(), options)
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export type ApiArgs<M extends StudyApiMethod> = Parameters<StudyApi[M]>
export type ApiReturn<M extends StudyApiMethod> = Awaited<ReturnType<StudyApi[M]>>

/** What to refetch after success: everything (default), nothing, or specific key prefixes. */
export type InvalidateTarget = 'all' | 'none' | readonly QueryKey[]

export type ApiMutationOptions<M extends StudyApiMethod> = Omit<
  UseMutationOptions<ApiReturn<M>, ApiError, ApiArgs<M>>,
  'mutationFn'
> & {
  invalidate?: InvalidateTarget
}

/**
 * A mutation for any StudyApi method. Variables are the method's arguments
 * as a tuple, exactly as you would pass them to `api[method]`:
 *
 *   const rename = useApiMutation('updateNotebook')
 *   rename.mutate([notebook.id, { name }])
 *   const lesson = await generate.mutateAsync([topicId, { regenerate: true }])
 *   pickFiles.mutate([])  // methods without arguments take an empty tuple
 *
 * On success every query is invalidated (pass `invalidate: 'none'` for
 * high-frequency writes such as quiz autosave, or a list of key prefixes).
 * Invalidation is not awaited, so `onSuccess` and `mutateAsync` resolve
 * immediately (for example to navigate away after a delete) and screens
 * re-render when the refetch lands.
 */
export function useApiMutation<M extends StudyApiMethod>(
  method: M,
  options: ApiMutationOptions<M> = {}
): UseMutationResult<ApiReturn<M>, ApiError, ApiArgs<M>> {
  const queryClient = useQueryClient()
  const { invalidate = 'all', onSuccess, ...rest } = options
  return useMutation<ApiReturn<M>, ApiError, ApiArgs<M>>({
    ...rest,
    mutationKey: [method],
    mutationFn: async (args: ApiArgs<M>): Promise<ApiReturn<M>> => {
      // TS can't relate api[M] to its own Parameters/ReturnType for a generic M.
      const fn = api[method] as unknown as (...a: ApiArgs<M>) => Promise<ApiReturn<M>>
      try {
        return (await fn(...args)) as ApiReturn<M>
      } catch (err) {
        throw toApiError(err)
      }
    },
    onSuccess: (...params) => {
      invalidateAfterMutation(queryClient, invalidate)
      return onSuccess?.(...params)
    }
  })
}

export function invalidateAfterMutation(queryClient: QueryClient, target: InvalidateTarget): void {
  if (target === 'none') return
  if (target === 'all') {
    void queryClient.invalidateQueries()
    return
  }
  for (const queryKey of target) void queryClient.invalidateQueries({ queryKey })
}

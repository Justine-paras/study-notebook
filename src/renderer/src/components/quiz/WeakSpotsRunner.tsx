import { useEffect, useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { ArrowRight, Sparkles } from 'lucide-react'
import type { ID, QuizResult, TopicWithProgress } from '@shared/types'
import { api, isApiError, toApiError, type ApiError } from '../../lib/api'
import { pluralize } from '../../lib/format'
import { usePomodoroNotebook } from '../../lib/pomodoro'
import { queryKeys, useApiMutation, useNotebook, useQuiz, useQuizResult } from '../../lib/queries'
import { AiWorking } from '../AiWorking'
import { ErrorNotice } from '../ErrorNotice'
import { MasteryPill } from '../MasteryPill'
import {
  groupTopicsByNotebook,
  weakQuizCount,
  weakQuizSettings,
  weakQuizStorageKey,
  weakTopicNote,
  type NotebookGroup
} from '../review/sessionModel'
import { Button, EmptyState, LoadingBlock, Sheet } from '../ui'
import { QuizResults } from './QuizResults'
import { QuizRunner } from './QuizRunner'
import { readStored, removeStored, writeStored } from './useStoredState'
import './WeakSpotsRunner.css'

export interface WeakSpotsRunnerProps {
  /** The plan's date, so a reload resumes today's quiz instead of writing a new one. */
  planDate: string
  topicIds: readonly ID[]
  /** Start writing the questions right away (the learner just chose to continue). */
  autoStart: boolean
  onProgress?: (fraction: number) => void
  onFinished: () => void
  /** Label of the button that leaves this part. */
  finishLabel: string
}

/**
 * Part 2 of today's session: a weak-spot quiz (all question types, mixed
 * difficulty, focused on recent mistakes) over the plan's weak topics, one
 * quiz per notebook, run inline and then graded.
 */
export function WeakSpotsRunner({ planDate, topicIds, autoStart, onProgress, onFinished, finishLabel }: WeakSpotsRunnerProps) {
  const results = useQueries({
    queries: topicIds.map((id) => ({
      queryKey: queryKeys.topic(id),
      queryFn: async () => {
        try {
          return await api.getTopic(id)
        } catch (err) {
          throw toApiError(err)
        }
      }
    }))
  })
  const pending = results.some((r) => r.isPending)
  const loaded = results.flatMap((r) => (r.data ? [r.data] : []))
  const failure = results.find((r) => r.error && !(isApiError(r.error) && r.error.code === 'NOT_FOUND'))?.error ?? null
  const topics = new Map(loaded.map((t) => [t.id, t]))
  const groups = groupTopicsByNotebook(topicIds, loaded)
  const [groupIndex, setGroupIndex] = useState(0)

  if (topicIds.length > 0 && pending) return <LoadingBlock label="Gathering your weak spots…" />
  if (failure && loaded.length === 0) {
    return (
      <ErrorNotice
        error={failure}
        title="Your weak spots couldn't be loaded"
        onRetry={() => results.forEach((r) => void r.refetch())}
      />
    )
  }

  const group = groups[groupIndex]
  if (!group) {
    return (
      <EmptyState
        kicker="nothing slipping"
        title="No weak spots today"
        action={
          <Button iconEnd={<ArrowRight size={16} aria-hidden="true" />} onClick={onFinished}>
            {finishLabel}
          </Button>
        }
      >
        None of the topics you have studied is slipping right now. Nice work.
      </EmptyState>
    )
  }

  const isLastGroup = groupIndex === groups.length - 1
  return (
    <WeakGroup
      key={group.notebookId}
      planDate={planDate}
      group={group}
      topics={topics}
      count={weakQuizCount(groups.length)}
      autoStart={autoStart || groupIndex > 0}
      position={groups.length > 1 ? `${groupIndex + 1} of ${groups.length}` : null}
      nextLabel={isLastGroup ? finishLabel : 'Next subject'}
      onProgress={(fraction) => onProgress?.((groupIndex + fraction) / groups.length)}
      onDone={() => (isLastGroup ? onFinished() : setGroupIndex(groupIndex + 1))}
    />
  )
}

interface WeakGroupProps {
  planDate: string
  group: NotebookGroup
  topics: ReadonlyMap<ID, TopicWithProgress>
  count: number
  autoStart: boolean
  /** "1 of 2" when the weak topics span several notebooks. */
  position: string | null
  nextLabel: string
  onProgress: (fraction: number) => void
  onDone: () => void
}

function parseQuizId(value: unknown): ID | null {
  return typeof value === 'string' && value ? value : null
}

function WeakGroup({ planDate, group, topics, count, autoStart, position, nextLabel, onProgress, onDone }: WeakGroupProps) {
  usePomodoroNotebook(group.notebookId)
  const notebook = useNotebook(group.notebookId)
  const storageKey = weakQuizStorageKey(planDate, group.notebookId)
  const [quizId, setQuizId] = useState<ID | null>(() => readStored(storageKey, parseQuizId, null))
  const [result, setResult] = useState<QuizResult | null>(null)
  const quiz = useQuiz(quizId ?? undefined)
  const create = useApiMutation('createQuiz', {
    onSuccess: (created) => {
      writeStored(storageKey, created.id)
      setQuizId(created.id)
    }
  })

  // A remembered quiz that was deleted since is simply forgotten.
  useEffect(() => {
    if (isApiError(quiz.error) && quiz.error.code === 'NOT_FOUND') {
      removeStored(storageKey)
      setQuizId(null)
    }
  }, [quiz.error, storageKey])

  const startedRef = useRef(false)
  const start = () => {
    if (startedRef.current) return
    startedRef.current = true
    create.mutate(
      [{ notebookId: group.notebookId, topicId: null, kind: 'weak_spots', settings: weakQuizSettings(count), topicIds: group.topicIds }],
      { onError: () => (startedRef.current = false) }
    )
  }
  const startRef = useRef(start)
  startRef.current = start
  useEffect(() => {
    if (autoStart && !quizId) startRef.current()
  }, [autoStart, quizId])

  const submitted = result !== null || !!quiz.data?.submittedAt
  const stored = useQuizResult(quizId ?? undefined, { enabled: !!quiz.data?.submittedAt && result === null })
  const shownResult = result ?? stored.data ?? null
  const fraction = submitted ? 1 : quiz.data ? 0.5 : 0
  useEffect(() => onProgress(fraction), [fraction, onProgress])

  const name = notebook.data ? notebook.data.code.trim() || notebook.data.name : null
  const title = name ? `Weak spots: ${name}` : 'Your weak spots'

  if (create.isPending) {
    return (
      <AiWorking
        task="quiz"
        title="Writing questions on your weak spots"
        explanation="Writing a mixed set of questions on the topics you keep missing, with extra attention to your recent mistakes."
      />
    )
  }

  if (quizId && quiz.isPending) return <LoadingBlock label="Opening your weak-spot quiz…" />
  const quizError: ApiError | null = quizId && quiz.error && !(isApiError(quiz.error) && quiz.error.code === 'NOT_FOUND') ? quiz.error : null
  if (quizError) return <ErrorNotice error={quizError} onRetry={() => void quiz.refetch()} title="Your quiz couldn't be opened" />

  if (!quizId || !quiz.data) {
    const listed = group.topicIds.map((id) => topics.get(id)).filter((t): t is TopicWithProgress => t !== undefined)
    return (
      <Sheet raised kicker={position ? `fix weak spots, ${position}` : 'fix weak spots'} title={title} className="weak-intro">
        <p className="weak-intro__text">
          {pluralize(count, 'mixed question')} on the {listed.length === 1 ? 'topic' : 'topics'} you keep missing. Rate how sure you
          are on each one: answers you were sure about but got wrong are the most useful to fix.
        </p>
        <ul className="weak-intro__topics">
          {listed.map((topic) => (
            <li key={topic.id} className="weak-intro__topic">
              <span className="weak-intro__name">{topic.title}</span>
              <span className="hand hand--sm weak-intro__why">{weakTopicNote(topic.progress)}</span>
              <MasteryPill state={topic.progress.state} mastery={topic.progress.mastery} />
            </li>
          ))}
        </ul>
        <ErrorNotice error={create.error} onRetry={start} title="Your questions couldn't be written" />
        <div className="weak-intro__actions">
          <Button size="lg" icon={<Sparkles size={18} aria-hidden="true" />} onClick={start}>
            Write my questions
          </Button>
          <span className="text-sm muted">Takes up to a minute.</span>
        </div>
      </Sheet>
    )
  }

  if (submitted) {
    if (!shownResult) {
      return stored.error ? (
        <ErrorNotice error={stored.error} onRetry={() => void stored.refetch()} title="Your results couldn't be loaded" />
      ) : (
        <LoadingBlock label="Loading your results…" />
      )
    }
    return (
      <QuizResults
        result={shownResult}
        title={title}
        actions={
          <Button size="lg" iconEnd={<ArrowRight size={18} aria-hidden="true" />} onClick={onDone}>
            {nextLabel}
          </Button>
        }
      />
    )
  }

  return <QuizRunner key={quiz.data.id} quiz={quiz.data} title={title} onSubmitted={setResult} />
}

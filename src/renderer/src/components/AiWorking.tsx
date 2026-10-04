import { useEffect, useState } from 'react'
import type { AiTask, ID } from '@shared/types'
import { useAiProgress } from '../lib/aiProgress'
import { formatClock } from '../lib/format'
import { ProgressBar } from './ui/ProgressBar'
import { Spinner } from './ui/Spinner'
import './AiWorking.css'

export const AI_TASK_TITLES: Record<AiTask, string> = {
  syllabus: 'Finding topics in your syllabus',
  lesson: 'Writing your lesson',
  quiz: 'Writing your questions',
  flashcards: 'Making flashcards',
  explanation: 'Checking your explanation',
  summary: 'Summarizing this file'
}

export const AI_TASK_EXPLANATIONS: Record<AiTask, string> = {
  syllabus: 'Reading your syllabus to list the topics in course order and any exam dates. This usually takes about a minute.',
  lesson: 'Reading your files and writing an in-depth lesson in small parts. This usually takes one to two minutes.',
  quiz: 'Writing questions from your files and mixing in earlier topics. This can take a minute or two.',
  flashcards: 'Turning the lesson and your mistakes into flashcards. This can take up to a minute.',
  explanation: 'Comparing your explanation with the lesson and your files to see what is covered and what is missing. This takes about half a minute.',
  summary: 'Reading the file and writing a short summary of its main points. This can take a minute.'
}

function secondsSince(time: number): number {
  return Math.max(0, Math.floor((Date.now() - time) / 1000))
}

export interface AiWorkingProps {
  task: AiTask
  /** Overrides the default title (e.g. "Writing your mock exam"). */
  title?: string
  /** Overrides the default explanation. */
  explanation?: string
  /** Smaller, for inline use inside panels and rows. */
  compact?: boolean
  /**
   * When the job started (AiJob.startedAt). Keeps the elapsed time and the
   * latest progress right when the panel mounts mid-job (the learner left the
   * page and came back). Default: when the panel mounted.
   */
  startedAt?: number
  /**
   * What the job works on (topic, file or notebook id, as in
   * AiProgressEvent.subjectId), so another job of the same task, e.g. a
   * second file being summarized, doesn't show its progress here.
   */
  subjectId?: ID | null
  className?: string
}

/**
 * Shown while an AI call runs (mount it while the mutation is pending):
 * live progress message, elapsed time and a calm note on what is being made.
 *   {lesson.isPending && <AiWorking task="lesson" startedAt={lesson.job?.startedAt} />}
 */
export function AiWorking({ task, title, explanation, compact = false, startedAt: jobStartedAt, subjectId, className }: AiWorkingProps) {
  const [mountedAt] = useState(() => Date.now())
  const startedAt = jobStartedAt ?? mountedAt
  const progress = useAiProgress(task, startedAt, subjectId)
  const [elapsed, setElapsed] = useState(() => secondsSince(startedAt))

  useEffect(() => {
    const update = () => setElapsed(secondsSince(startedAt))
    update()
    const id = window.setInterval(update, 1000)
    return () => window.clearInterval(id)
  }, [startedAt])

  const heading = title ?? AI_TASK_TITLES[task]
  const message = progress?.message
  const fraction = progress?.progress ?? null

  return (
    <div className={['ai-working', compact && 'ai-working--compact', className].filter(Boolean).join(' ')} aria-busy="true">
      <div className="ai-working__head">
        <Spinner size={compact ? 16 : 20} label={null} />
        <div className="ai-working__title" role="status">
          {heading}
        </div>
        <span className="ai-working__elapsed tabular" aria-label={`${elapsed} seconds so far`}>
          {formatClock(elapsed)}
        </span>
      </div>
      {fraction !== null ? (
        <ProgressBar value={fraction * 100} label={heading} size="sm" tone="ink" />
      ) : (
        <div className="ai-working__indeterminate" aria-hidden="true">
          <span />
        </div>
      )}
      {/* Only the progress message is announced, not the ticking clock. */}
      <div className="ai-working__message" aria-live="polite">
        {message ?? 'Starting…'}
      </div>
      {!compact && <p className="ai-working__explanation">{explanation ?? AI_TASK_EXPLANATIONS[task]}</p>}
      {!compact && <p className="hand hand--sm ai-working__note">you can leave this page: it keeps going and tells you when it's done</p>}
    </div>
  )
}

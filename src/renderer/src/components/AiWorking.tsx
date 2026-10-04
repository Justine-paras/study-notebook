import { useEffect, useState } from 'react'
import type { AiTask } from '@shared/types'
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
  syllabus: 'Reading your syllabus to list the topics in course order and any exam dates. This usually takes under a minute.',
  lesson: 'Reading your files and writing a lesson in small parts. This can take a minute.',
  quiz: 'Writing questions from your files and mixing in earlier topics. This can take up to a minute.',
  flashcards: 'Turning the lesson and your mistakes into flashcards. This takes a few seconds.',
  explanation: 'Comparing your explanation with the lesson and your files to see what is covered and what is missing.',
  summary: 'Reading the file and writing a short summary of its main points. This can take a minute.'
}

export interface AiWorkingProps {
  task: AiTask
  /** Overrides the default title (e.g. "Writing your mock exam"). */
  title?: string
  /** Overrides the default explanation. */
  explanation?: string
  /** Smaller, for inline use inside panels and rows. */
  compact?: boolean
  className?: string
}

/**
 * Shown while an AI call runs (mount it while the mutation is pending):
 * live progress message, elapsed time and a calm note on what is being made.
 *   {generate.isPending && <AiWorking task="lesson" />}
 */
export function AiWorking({ task, title, explanation, compact = false, className }: AiWorkingProps) {
  const progress = useAiProgress(task)
  const [startedAt] = useState(() => Date.now())
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
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
      {!compact && <p className="hand hand--sm ai-working__note">you can keep using the app while this runs</p>}
    </div>
  )
}

import type { ReactNode } from 'react'
import { BookOpen, Check, Flag, X } from 'lucide-react'
import { Markdown } from '../Markdown'
import { Callout } from '../ui'
import './AnswerFeedback.css'

export interface AnswerFeedbackProps {
  correct: boolean
  /** Bold first line, e.g. "Not quite. The answer is O(n)." */
  title: ReactNode
  /** Why the answer is right (Markdown). */
  explanation?: string
  /** Where it comes from, e.g. "Lecture 05.pdf, page 12". */
  sourceRef?: string
  /** "Sure but wrong": flagged so it comes back first. */
  overconfident?: boolean
  /** Announce it to screen readers as soon as it appears (instant feedback). */
  live?: boolean
  className?: string
}

/** Green or red feedback under an answered question, with the explanation and its source. */
export function AnswerFeedback({ correct, title, explanation, sourceRef, overconfident = false, live = false, className }: AnswerFeedbackProps) {
  const icon = correct ? <Check size={18} aria-hidden="true" /> : overconfident ? <Flag size={18} aria-hidden="true" /> : <X size={18} aria-hidden="true" />
  return (
    <Callout
      tone={correct ? 'good' : 'bad'}
      icon={icon}
      title={title}
      role={live ? 'status' : undefined}
      className={['answer-feedback', className].filter(Boolean).join(' ')}
    >
      {explanation?.trim() ? <Markdown variant="compact" className="answer-feedback__md">{explanation}</Markdown> : null}
      {sourceRef?.trim() ? (
        <span className="answer-feedback__source">
          <BookOpen size={14} aria-hidden="true" />
          <span>
            <span className="sr-only">Source: </span>
            {sourceRef}
          </span>
        </span>
      ) : null}
    </Callout>
  )
}

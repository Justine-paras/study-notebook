import { forwardRef, useId, type ReactNode, type RefObject } from 'react'
import { BookOpen, RotateCcw } from 'lucide-react'
import type { Confidence, Rating, ReviewCard } from '@shared/types'
import { CONFIDENCE_LABELS } from '../../lib/format'
import { Markdown } from '../Markdown'
import { Callout, Pill, Sheet, TextArea } from '../ui'
import { ConfidencePicker } from '../quiz/ConfidencePicker'
import { GradeButtons } from './GradeButtons'
import type { ReviewStage } from './reviewModel'
import './ReviewCardView.css'

export interface ReviewCardViewProps {
  card: ReviewCard
  stage: ReviewStage
  confidence: Confidence | null
  response: string
  onResponse: (response: string) => void
  onConfidence: (confidence: Confidence) => void
  onGrade: (rating: Rating) => void
  /** "Card 3 of 18". */
  position: ReactNode
  /** The card was missed earlier in this session and came back. */
  repeat?: boolean
  pendingRating?: Rating | null
  /** Shown under the grade buttons (e.g. a failed save). */
  footer?: ReactNode
  confidenceRef?: RefObject<HTMLDivElement | null>
  gradesRef?: RefObject<HTMLDivElement | null>
  /** Shows a short nudge when Space/Enter is pressed before picking a confidence. */
  nudge?: boolean
}

// Plain one-line questions read best in the serif display face; anything with
// Markdown structure (code, lists, math, tables) is rendered as Markdown.
const MARKDOWN_HINT = /[`*_#|$[\]]|\n/

/**
 * One flashcard in review: recall from memory, optionally type it, pick how
 * sure you are (which reveals the answer and its source), then grade.
 */
export const ReviewCardView = forwardRef<HTMLDivElement, ReviewCardViewProps>(function ReviewCardView(
  {
    card,
    stage,
    confidence,
    response,
    onResponse,
    onConfidence,
    onGrade,
    position,
    repeat = false,
    pendingRating = null,
    footer,
    confidenceRef,
    gradesRef,
    nudge = false
  },
  ref
) {
  const frontId = useId()
  const revealed = stage === 'revealed'
  const plainFront = !MARKDOWN_HINT.test(card.front.trim())

  return (
    <div className="review-card">
      <div className="review-card__head">
        <span className="review-card__position">{position}</span>
        <div className="review-card__tags">
          {repeat && (
            <Pill tone="warn" icon={<RotateCcw size={12} aria-hidden="true" />}>
              Second look
            </Pill>
          )}
          <Pill notebookColor={card.notebookColor} size="md">
            {card.topicTitle ? `${card.notebookName} · ${card.topicTitle}` : card.notebookName}
          </Pill>
        </div>
      </div>

      <Sheet raised density="roomy" as="article" className="review-card__sheet" aria-labelledby={frontId}>
        <div className="review-card__front" ref={ref} tabIndex={-1} id={frontId}>
          <span className="caps-label caps-label--xs">Recall from memory</span>
          {plainFront ? (
            <p className="review-card__question display">{card.front}</p>
          ) : (
            <Markdown className="review-card__question-md">{card.front}</Markdown>
          )}
        </div>

        <TextArea
          label="Write or say your answer first. Trying to recall is what makes it stick."
          className="review-card__answer"
          rows={3}
          placeholder="Your answer (optional)"
          value={response}
          readOnly={revealed}
          onChange={(event) => onResponse(event.target.value)}
          onKeyDown={(event) => {
            // Ctrl+Enter leaves the answer box for the confidence buttons, so the keyboard flow never needs a mouse.
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              confidenceRef?.current?.querySelector('button')?.focus()
            }
          }}
        />

        {!revealed ? (
          <ConfidencePicker
            ref={confidenceRef}
            variant="buttons"
            value={confidence}
            onChange={onConfidence}
            showKeys
            className={nudge ? 'review-card__confidence--nudge' : undefined}
            hint={
              nudge
                ? 'Pick how sure you are first (1, 2 or 3). Then the answer appears.'
                : "Picking one shows the answer. Your confidence helps the app spot things you think you know but don't."
            }
          />
        ) : (
          <>
            <Callout
              tone="outline"
              label={confidence ? `Answer · you said "${CONFIDENCE_LABELS[confidence]}"` : 'Answer'}
              className="review-card__reveal"
              role="region"
              aria-label="Answer"
            >
              <Markdown variant="lesson" className="review-card__back">
                {card.back}
              </Markdown>
              {card.sourceRef.trim() && (
                <span className="review-card__source">
                  <BookOpen size={14} aria-hidden="true" />
                  Source: {card.sourceRef}
                </span>
              )}
            </Callout>
            <GradeButtons
              ref={gradesRef}
              previews={card.previews}
              confidence={confidence}
              onGrade={onGrade}
              pendingRating={pendingRating}
              disabled={pendingRating !== null}
            />
          </>
        )}
        {footer}
      </Sheet>
    </div>
  )
})

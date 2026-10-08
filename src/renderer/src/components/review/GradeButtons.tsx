import { forwardRef, useId } from 'react'
import type { Confidence, Rating, RatingPreview } from '@shared/types'
import { RATING_LABELS } from '../../lib/format'
import { Kbd } from '../ui'
import { GRADE_HINTS, GRADE_TONES, previewLabel, RATINGS } from './reviewModel'
import './GradeButtons.css'

export interface GradeButtonsProps {
  previews: readonly RatingPreview[]
  confidence: Confidence | null
  onGrade: (rating: Rating) => void
  /** The rating being saved (shows which button was pressed). */
  pendingRating?: Rating | null
  disabled?: boolean
}

/** Again / Hard / Good / Easy with when the card comes back for each, keys 1-4. */
export const GradeButtons = forwardRef<HTMLDivElement, GradeButtonsProps>(function GradeButtons(
  { previews, confidence, onGrade, pendingRating = null, disabled = false },
  ref
) {
  const labelId = useId()
  return (
    <div className="grades" ref={ref} tabIndex={-1} role="group" aria-labelledby={labelId}>
      <span id={labelId} className="grades__label">
        How did you do?
      </span>
      <div className="grades__buttons">
        {RATINGS.map((rating) => {
          const interval = previewLabel(previews, rating, confidence)
          return (
            <button
              key={rating}
              type="button"
              className={`grades__button grades__button--${GRADE_TONES[rating]}`}
              disabled={disabled}
              aria-busy={pendingRating === rating || undefined}
              aria-label={`${RATING_LABELS[rating]}: ${GRADE_HINTS[rating].toLowerCase()}${interval ? `, back in ${interval}` : ''}`}
              onClick={() => onGrade(rating)}
            >
              <span className="grades__name">{RATING_LABELS[rating]}</span>
              <span className="grades__interval">{interval ? `in ${interval}` : GRADE_HINTS[rating]}</span>
              <Kbd className="grades__key">{rating}</Kbd>
            </button>
          )
        })}
      </div>
      {confidence === 'guess' && (
        <span className="grades__note">You were guessing, so Good and Easy count as Hard: the card comes back sooner.</span>
      )}
    </div>
  )
})

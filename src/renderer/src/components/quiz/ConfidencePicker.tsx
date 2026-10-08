import { forwardRef, useId, type ReactNode } from 'react'
import type { Confidence } from '@shared/types'
import { CONFIDENCE_LABELS, CONFIDENCE_ORDER } from '../../lib/format'
import { ChipToggle, Kbd } from '../ui'
import './ConfidencePicker.css'

export interface ConfidencePickerProps {
  value: Confidence | null
  onChange: (confidence: Confidence) => void
  /** chips: small chips under each quiz question. buttons: big buttons with key hints (flashcard review). */
  variant?: 'chips' | 'buttons'
  /** Visible label. Default "Confidence" (chips) or "How sure are you?" (buttons). */
  label?: string
  /** Text under the buttons. */
  hint?: ReactNode
  /** Show 1/2/3 key hints on the buttons. */
  showKeys?: boolean
  disabled?: boolean
  className?: string
}

/**
 * Sure / Unsure / Guessing. Every answer gets one, so the app can spot
 * things the learner thinks they know but doesn't.
 */
export const ConfidencePicker = forwardRef<HTMLDivElement, ConfidencePickerProps>(function ConfidencePicker(
  { value, onChange, variant = 'chips', label, hint, showKeys = false, disabled = false, className },
  ref
) {
  const labelId = useId()
  const hintId = useId()
  const text = label ?? (variant === 'chips' ? 'Confidence' : 'How sure are you?')

  return (
    <div
      ref={ref}
      className={['confidence', `confidence--${variant}`, className].filter(Boolean).join(' ')}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={hint ? hintId : undefined}
      tabIndex={-1}
    >
      <span id={labelId} className="confidence__label">
        {text}
      </span>
      <div className="confidence__options">
        {CONFIDENCE_ORDER.map((confidence, index) =>
          variant === 'chips' ? (
            <ChipToggle
              key={confidence}
              size="sm"
              pressed={value === confidence}
              disabled={disabled}
              onChange={() => onChange(confidence)}
            >
              {CONFIDENCE_LABELS[confidence]}
            </ChipToggle>
          ) : (
            <button
              key={confidence}
              type="button"
              className="confidence__button"
              aria-pressed={value === confidence}
              disabled={disabled}
              onClick={() => onChange(confidence)}
            >
              <span>{CONFIDENCE_LABELS[confidence]}</span>
              {showKeys && <Kbd className="confidence__key">{index + 1}</Kbd>}
            </button>
          )
        )}
      </div>
      {hint && (
        <span id={hintId} className="confidence__hint">
          {hint}
        </span>
      )}
    </div>
  )
})

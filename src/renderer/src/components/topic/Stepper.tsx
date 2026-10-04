import { Check } from 'lucide-react'
import type { PathStep, Topic } from '@shared/types'
import { PATH_STEP_LABELS } from '../../lib/format'
import { stepViews } from './topicModel'
import './Stepper.css'

export interface StepperProps {
  current: PathStep
  pathStep: Topic['pathStep']
  onSelect: (step: PathStep) => void
}

/**
 * The 5-step learning path. Every step can be opened (nothing is locked);
 * done steps get a check and the recommended next step says "Up next".
 */
export function Stepper({ current, pathStep, onSelect }: StepperProps) {
  return (
    <nav aria-label="Learning path">
      <ol className="stepper">
        {stepViews(current, pathStep).map((view) => {
          const { label, hint } = PATH_STEP_LABELS[view.step]
          return (
            <li key={view.step} className="stepper__item">
              <button
                type="button"
                className={[
                  'stepper__step',
                  `stepper__step--${view.status}`,
                  view.recommended && 'stepper__step--recommended'
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-current={view.status === 'current' ? 'step' : undefined}
                onClick={() => onSelect(view.step)}
              >
                <span className="stepper__dot" aria-hidden="true">
                  {view.status === 'done' ? <Check size={16} strokeWidth={3} /> : view.number}
                </span>
                <span className="stepper__text">
                  <span className="stepper__label">
                    <span className="sr-only">Step {view.number}: </span>
                    {label}
                    {view.status === 'done' && <span className="sr-only"> (done)</span>}
                  </span>
                  <span className={view.recommended ? 'stepper__hint stepper__hint--next' : 'stepper__hint'}>
                    {view.recommended ? 'Up next' : hint}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

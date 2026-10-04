import type { CalibrationBucket, WeakTopic } from '@shared/types'
import { Panel, ProgressBar } from '../ui'
import { CONFIDENCE_LABELS, CONFIDENCE_ORDER, pluralize } from '../../lib/format'
import { CALIBRATION_TONES, calibrationInterpretation, overconfidenceNote } from './insightsModel'
import './Calibration.css'

export interface CalibrationProps {
  calibration: CalibrationBucket[]
  overconfidentLast7Days: number
  weakTopics: WeakTopic[]
}

/** Confidence vs accuracy: how often each confidence level was actually right. */
export function Calibration({ calibration, overconfidentLast7Days, weakTopics }: CalibrationProps) {
  const total = calibration.reduce((sum, b) => sum + b.answered, 0)
  const note = overconfidenceNote(overconfidentLast7Days, weakTopics)
  const buckets = CONFIDENCE_ORDER.map(
    (confidence) =>
      calibration.find((b) => b.confidence === confidence) ?? { confidence, answered: 0, correct: 0, accuracy: null }
  )

  return (
    <Panel title="Do you know what you think you know?" meta={total > 0 ? `${pluralize(total, 'answer')}, last 30 days` : undefined}>
      <ul className="calibration">
        {buckets.map((bucket) => {
          const label = CONFIDENCE_LABELS[bucket.confidence]
          return (
            <li key={bucket.confidence} className="calibration__row">
              <div className="calibration__head">
                <span>
                  When you said <strong>{label}</strong>
                </span>
                <span className={bucket.accuracy === null ? 'calibration__value calibration__value--none' : 'calibration__value'}>
                  {bucket.accuracy === null ? 'no answers yet' : `${bucket.accuracy}% correct`}
                </span>
              </div>
              <ProgressBar
                value={bucket.accuracy ?? 0}
                label={`Accuracy when you said ${label}`}
                valueText={
                  bucket.accuracy === null
                    ? 'No answers yet'
                    : `${bucket.accuracy}% correct, ${bucket.correct} of ${bucket.answered}`
                }
                tone={CALIBRATION_TONES[bucket.confidence]}
              />
            </li>
          )
        })}
      </ul>
      <p className="calibration__summary">
        {note && (
          <>
            You were <strong>sure but wrong</strong> {note.times} this week
            {note.topic ? `, most often on ${note.topic}` : ''}. Those are the most dangerous mistakes, so they come back
            first.{' '}
          </>
        )}
        {calibrationInterpretation(calibration)}
      </p>
    </Panel>
  )
}

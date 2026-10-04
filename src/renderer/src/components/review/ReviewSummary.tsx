import type { ReactNode } from 'react'
import { Sheet, Stat } from '../ui'
import type { ReviewSummary as Summary } from './reviewModel'
import './ReviewSummary.css'

export interface ReviewSummaryProps {
  summary: Summary
  /** Caveat line above the title, e.g. "part 1 done!". */
  kicker?: string
  title?: string
  actions?: ReactNode
}

/** End of a review run: recalled, sure-but-wrong, and what comes back. */
export function ReviewSummary({ summary, kicker = 'all done!', title = 'Review finished', actions }: ReviewSummaryProps) {
  const { reviewed, recalled, overconfident, missed } = summary
  return (
    <Sheet raised density="roomy" kicker={kicker} title={title} titleLevel={2} className="review-summary">
      <div className="review-summary__stats">
        <Stat boxed value={`${recalled} / ${reviewed}`} label="recalled" tone={reviewed > 0 && recalled === reviewed ? 'good' : 'default'} />
        <Stat boxed value={overconfident} label={'"sure" but wrong'} tone={overconfident > 0 ? 'bad' : 'default'} />
        <Stat boxed value={missed} label="coming back soon" />
      </div>
      <p className="review-summary__text">
        {missed > 0
          ? 'Missed cards return in a few minutes, then tomorrow. Topics you were sure about but got wrong are flagged in Insights.'
          : 'Every card stuck. Each one now waits a little longer before it comes back, because the memory is stronger.'}
      </p>
      {actions !== undefined && <div className="review-summary__actions">{actions}</div>}
    </Sheet>
  )
}

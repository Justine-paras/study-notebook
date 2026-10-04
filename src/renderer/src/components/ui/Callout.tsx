import type { HTMLAttributes, ReactNode } from 'react'
import './Callout.css'

export type CalloutTone = 'neutral' | 'info' | 'good' | 'bad' | 'warn' | 'outline' | 'highlight'

export interface CalloutProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** good/bad: answer feedback. info: tips. outline: paper with an ink border (check questions, revealed answers). highlight: worked examples. */
  tone?: CalloutTone
  /** Bold lead-in, e.g. "Not quite. The answer is O(n)." */
  title?: ReactNode
  /** Small uppercase label above the content, e.g. "Quick check before moving on". */
  label?: ReactNode
  icon?: ReactNode
  children?: ReactNode
}

/**
 * A tinted box for feedback, tips and worked examples.
 *   <Callout tone="good" title="Correct.">Sorted input makes a chain.</Callout>
 *   <Callout tone="outline" label="Quick check before moving on">...</Callout>
 */
export function Callout({ tone = 'neutral', title, label, icon, children, className, ...rest }: CalloutProps) {
  return (
    <div {...rest} className={['callout', `callout--${tone}`, className].filter(Boolean).join(' ')}>
      {icon && <span className="callout__icon">{icon}</span>}
      <div className="callout__content">
        {label !== undefined && <div className="caps-label caps-label--xs">{label}</div>}
        {title !== undefined && <div className="callout__title">{title}</div>}
        {children}
      </div>
    </div>
  )
}

import type { CSSProperties } from 'react'
import type { NotebookColor } from '@shared/types'
import { clamp, notebookColorVars } from '../../lib/format'
import './ProgressBar.css'

export type ProgressTone = 'ink' | 'good' | 'bad' | 'warn' | 'info' | 'caution' | 'muted' | 'accent'

export interface ProgressBarProps {
  /** 0-100 (or 0-max). */
  value: number
  max?: number
  /** Accessible name, e.g. "Mastery of Binary search trees". Required: the bar has no visible label of its own. */
  label: string
  /** Text read by screen readers instead of the percentage, e.g. "Part 2 of 5". */
  valueText?: string
  /** Fill color family. Default ink. */
  tone?: ProgressTone
  /** Fill with a notebook's cover color (overrides tone). */
  notebookColor?: NotebookColor
  /** Any CSS color, usually a token: "var(--mastery-weak-fg)" (overrides tone and notebookColor). */
  color?: string
  /** Track height: sm 6px, md 8px (default), lg 10px. */
  size?: 'sm' | 'md' | 'lg'
  /** White fill on a translucent track, for use on notebook covers. */
  onCover?: boolean
  /** Show "68%" to the right. */
  showValue?: boolean
  /** Keep a sliver of fill at 0 so the bar reads as a bar (prototype topic rows). */
  minVisible?: boolean
  className?: string
}

/** `<ProgressBar value={68} label="Exam readiness" notebookColor="blue" showValue />` */
export function ProgressBar({
  value,
  max = 100,
  label,
  valueText,
  tone = 'ink',
  notebookColor,
  color,
  size = 'md',
  onCover = false,
  showValue = false,
  minVisible = false,
  className
}: ProgressBarProps) {
  const pct = max > 0 ? clamp((value / max) * 100, 0, 100) : 0
  const shown = minVisible ? Math.max(pct, 3) : pct
  const fill = color ?? (notebookColor ? notebookColorVars(notebookColor).cover : undefined)
  const style = { '--progress': `${shown}%`, ...(fill ? { '--progress-fill': fill } : {}) } as CSSProperties
  const classes = [
    'progress',
    `progress--${size}`,
    !fill && `progress--${tone}`,
    onCover && 'progress--on-cover',
    className
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes} style={style}>
      <div
        className="progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.round(clamp(value, 0, max))}
        aria-valuetext={valueText}
      >
        <div className="progress__fill" />
      </div>
      {showValue && <span className="progress__value tabular">{Math.round(pct)}%</span>}
    </div>
  )
}

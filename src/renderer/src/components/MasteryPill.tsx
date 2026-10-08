import type { CSSProperties } from 'react'
import type { MasteryState } from '@shared/types'
import { MASTERY_LABELS, MASTERY_LEGEND_ORDER, masteryColorVars } from '../lib/format'
import { ProgressBar } from './ui/ProgressBar'
import './MasteryPill.css'

export interface MasteryPillProps {
  state: MasteryState
  /** 0-100; adds "· 40% mastery" after the label. */
  mastery?: number | null
  size?: 'sm' | 'md'
  className?: string
}

function stateStyle(state: MasteryState): CSSProperties {
  const vars = masteryColorVars(state)
  return { '--mastery-bg': vars.bg, '--mastery-fg': vars.fg, '--mastery-ink': vars.ink } as CSSProperties
}

/** Colored label for a topic's mastery state: `<MasteryPill state={p.state} mastery={p.mastery} />` */
export function MasteryPill({ state, mastery, size = 'sm', className }: MasteryPillProps) {
  const text =
    mastery === null || mastery === undefined ? MASTERY_LABELS[state] : `${MASTERY_LABELS[state]} · ${Math.round(mastery)}% mastery`
  return (
    <span
      className={['mastery-pill', `mastery-pill--${size}`, className].filter(Boolean).join(' ')}
      style={stateStyle(state)}
    >
      {text}
    </span>
  )
}

export interface MasteryBarProps {
  state: MasteryState
  /** 0-100. */
  mastery: number
  /** Accessible name, e.g. "Mastery of Hash tables". */
  label: string
  size?: 'sm' | 'md' | 'lg'
  showValue?: boolean
  className?: string
}

/** Mastery bar in the state's color (with a sliver at 0%): `<MasteryBar state="weak" mastery={48} label="Mastery of Hashing" />` */
export function MasteryBar({ state, mastery, label, size = 'md', showValue = false, className }: MasteryBarProps) {
  return (
    <ProgressBar
      value={mastery}
      label={label}
      color={masteryColorVars(state).fg}
      size={size}
      showValue={showValue}
      minVisible
      className={className}
    />
  )
}

/** The five states with their colors, strongest first: `<MasteryLegend />` */
export function MasteryLegend({ className }: { className?: string }) {
  return (
    <ul className={['mastery-legend', className].filter(Boolean).join(' ')} aria-label="Mastery states">
      {MASTERY_LEGEND_ORDER.map((state) => (
        <li key={state} className="mastery-legend__item" style={stateStyle(state)}>
          <span className="mastery-legend__swatch" aria-hidden="true" />
          {MASTERY_LABELS[state]}
        </li>
      ))}
    </ul>
  )
}

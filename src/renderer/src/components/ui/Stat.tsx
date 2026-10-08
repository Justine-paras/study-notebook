import type { ReactNode } from 'react'
import './Stat.css'

export interface StatProps {
  /** The big number, already formatted ("87%", "412", "3 / 6"). */
  value: ReactNode
  /** Caption under it ("recalled in reviews this week"). */
  label: ReactNode
  /** Draw it as a bordered card (session summary) instead of bare (Memory check). */
  boxed?: boolean
  tone?: 'default' | 'good' | 'bad' | 'warn'
}

/** `<Stat value="87%" label="recalled in reviews this week" />` */
export function Stat({ value, label, boxed = false, tone = 'default' }: StatProps) {
  return (
    <div className={['stat', boxed && 'stat--boxed', tone !== 'default' && `stat--${tone}`].filter(Boolean).join(' ')}>
      <div className="stat__value tabular">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  )
}

import { useId } from 'react'
import { Link } from 'react-router'
import { ArrowRight, BookOpen, Play } from 'lucide-react'
import type { PlanBlock, TodayPlan } from '@shared/types'
import { Button, EmptyState, Sheet } from '../ui'
import { formatMinutes } from '../../lib/format'
import { PLAN_BLOCK_ACTIONS, planBlockLink, planTotals } from './todayModel'
import './PlanSheet.css'

export interface PlanSheetProps {
  plan: TodayPlan
  focusMinutes: number
  /** Starts the focus timer and opens the session. */
  onStart: () => void
  /** True while a focus phase is already running (changes the note under the button). */
  focusRunning: boolean
  /** Where "Learn a new topic" goes when nothing is due. */
  nothingDueTo: string
}

/** "Today's plan" on a lined sheet: numbered blocks, totals and the start button. */
export function PlanSheet({ plan, focusMinutes, onStart, focusRunning, nothingDueTo }: PlanSheetProps) {
  const noteId = useId()

  if (plan.blocks.length === 0) {
    return (
      <Sheet as="section" raised title="Today's plan" className="today-plan">
        <EmptyState
          compact
          titleLevel={3}
          kicker="all caught up!"
          title="Nothing due today"
          action={
            <Button to={nothingDueTo} icon={<BookOpen size={16} aria-hidden="true" />}>
              Learn a new topic
            </Button>
          }
        >
          Your reviews are done and nothing needs fixing. A good moment to get ahead on a new topic, or simply take the day.
        </EmptyState>
      </Sheet>
    )
  }

  const totals = planTotals(plan.totalMinutes, focusMinutes)
  return (
    <Sheet
      as="section"
      raised
      title="Today's plan"
      className="today-plan"
      aside={
        <span className="today-plan__totals">
          about <strong>{totals.minutes}</strong>
          {totals.pomodoros && ` · ${totals.pomodoros}`}
        </span>
      }
    >
      <ol className="today-plan__blocks">
        {plan.blocks.map((block, index) => (
          <PlanBlockItem key={`${block.kind}-${index}`} block={block} number={index + 1} />
        ))}
      </ol>
      <div className="today-plan__start">
        <Button size="lg" icon={<Play size={16} fill="currentColor" aria-hidden="true" />} onClick={onStart} aria-describedby={noteId}>
          Start today's session
        </Button>
        <span id={noteId} className="text-sm muted">
          {focusRunning
            ? 'Your focus timer is already running. Subjects are mixed together.'
            : 'Starts the Pomodoro and mixes subjects together.'}
        </span>
      </div>
    </Sheet>
  )
}

function PlanBlockItem({ block, number }: { block: PlanBlock; number: number }) {
  const to = planBlockLink(block)
  const detailId = useId()
  return (
    <li className={`today-block today-block--${block.kind.replace('_', '-')}${to ? ' today-block--link' : ''}`}>
      <span className="today-block__number" aria-hidden="true">
        {number}
      </span>
      <div className="today-block__body">
        <div className="today-block__head">
          {to ? (
            // The link covers the whole card (::after), so the card is one big target.
            <Link to={to} className="today-block__title" aria-describedby={detailId}>
              {block.title}
              <span className="sr-only">. {PLAN_BLOCK_ACTIONS[block.kind]}</span>
            </Link>
          ) : (
            <span className="today-block__title">{block.title}</span>
          )}
          <span className="today-block__time tabular">{formatMinutes(block.estMinutes)}</span>
        </div>
        <div id={detailId} className="today-block__detail">
          {block.detail}
        </div>
        <div className="hand hand--sm today-block__reason">{block.reason}</div>
      </div>
      {to && <ArrowRight className="today-block__arrow" size={18} aria-hidden="true" />}
    </li>
  )
}

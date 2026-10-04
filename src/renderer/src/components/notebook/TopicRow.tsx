import { ArrowDown, ArrowUp, Layers, Pencil, Trash2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import type { TopicWithProgress } from '@shared/types'
import { MasteryBar, MasteryPill } from '../MasteryPill'
import { Button, IconButton, Menu, type MenuEntry } from '../ui'
import { ROUTES } from '../../lib/routes'
import { topicAction } from './model'
import './TopicRow.css'

export interface TopicRowProps {
  topic: TopicWithProgress
  /** The grey line under the title (see topicStatusLine). */
  status: string
  /** False when no topic in the notebook has a unit label, to drop the empty column. */
  showUnit: boolean
  /** Shows move up/down buttons instead of the main action. */
  reordering: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (direction: 'up' | 'down') => void
  onEdit: () => void
  onDelete: () => void
}

/**
 * One topic in course order: unit, title, status line, mastery pill and bar,
 * and the next thing to do. The Topic page picks the step to open on.
 */
export function TopicRow({ topic, status, showUnit, reordering, canMoveUp, canMoveDown, onMove, onEdit, onDelete }: TopicRowProps) {
  const navigate = useNavigate()
  const { state, mastery, cardCount } = topic.progress
  const action = topicAction(state)
  const href = ROUTES.topic(topic.id)
  // A weak topic's cards can be reviewed right away, due or not, next to relearning it.
  const reviewEntries: MenuEntry[] =
    state === 'weak' && cardCount > 0
      ? [{ label: 'Review cards', icon: <Layers size={16} aria-hidden="true" />, onSelect: () => navigate(ROUTES.reviewTopic(topic.id)) }, 'separator']
      : []
  const items: MenuEntry[] = [
    ...reviewEntries,
    { label: 'Edit topic', icon: <Pencil size={16} aria-hidden="true" />, onSelect: onEdit },
    { label: 'Move up', icon: <ArrowUp size={16} aria-hidden="true" />, onSelect: () => onMove('up'), disabled: !canMoveUp },
    { label: 'Move down', icon: <ArrowDown size={16} aria-hidden="true" />, onSelect: () => onMove('down'), disabled: !canMoveDown },
    'separator',
    { label: 'Delete topic', icon: <Trash2 size={16} aria-hidden="true" />, tone: 'danger', onSelect: onDelete }
  ]

  return (
    <li className={['topic-row', !showUnit && 'topic-row--no-unit'].filter(Boolean).join(' ')} data-topic-id={topic.id}>
      {showUnit && <span className="topic-row__unit">{topic.unitLabel}</span>}
      <div className="topic-row__main">
        <Link to={href} className="topic-row__title">
          {topic.title}
        </Link>
        <div className="topic-row__status">{status}</div>
      </div>
      <div className="topic-row__mastery">
        <MasteryPill state={state} />
        <MasteryBar state={state} mastery={mastery} label={`Mastery of ${topic.title}`} className="topic-row__bar" />
      </div>
      <div className="topic-row__actions">
        {reordering ? (
          <>
            <IconButton
              label={`Move ${topic.title} up`}
              variant="subtle"
              size="sm"
              disabled={!canMoveUp}
              onClick={() => onMove('up')}
              data-reorder={`${topic.id}:up`}
            >
              <ArrowUp size={16} aria-hidden="true" />
            </IconButton>
            <IconButton
              label={`Move ${topic.title} down`}
              variant="subtle"
              size="sm"
              disabled={!canMoveDown}
              onClick={() => onMove('down')}
              data-reorder={`${topic.id}:down`}
            >
              <ArrowDown size={16} aria-hidden="true" />
            </IconButton>
          </>
        ) : (
          <Button
            to={href}
            size="sm"
            variant={action.emphasis ? 'primary' : 'secondary'}
            className="topic-row__action"
            aria-label={`${action.label} ${topic.title}`}
          >
            {action.label}
          </Button>
        )}
        <Menu label={`Actions for ${topic.title}`} items={items} />
      </div>
    </li>
  )
}

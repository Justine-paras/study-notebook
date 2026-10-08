import { useMemo, useState } from 'react'
import { Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import type { Card, ID, TopicWithProgress } from '@shared/types'
import { Badge, Button, EmptyState, IconButton, Menu, Modal, Segmented, Select, TextField, useConfirm, useToast } from '../ui'
import { pluralize } from '../../lib/format'
import { useApiMutation } from '../../lib/queries'
import { CARD_ORIGIN_LABELS, CardDialog } from './CardDialog'
import { cardDueLabel, filterCards, isCardDue, topicOptions, type CardFilter, type CardStatusFilter } from './model'
import './CardBrowser.css'

export interface CardBrowserProps {
  open: boolean
  onClose: () => void
  notebookId: ID
  cards: readonly Card[]
  topics: readonly TopicWithProgress[]
  now?: Date
}

const PAGE_SIZE = 50

const STATUS_OPTIONS: { value: CardStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'due', label: 'Due' },
  { value: 'new', label: 'New' },
  { value: 'suspended', label: 'Paused' }
]

/** Browse, search, edit, pause and delete the notebook's flashcards. */
export function CardBrowser({ open, onClose, notebookId, cards, topics, now = new Date() }: CardBrowserProps) {
  const [filter, setFilter] = useState<CardFilter>({ query: '', topic: 'all', status: 'all' })
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [editing, setEditing] = useState<{ card: Card | null } | null>(null)
  const toast = useToast()
  const confirm = useConfirm()
  const update = useApiMutation('updateCard', { onError: (err) => toast.error(err, "Couldn't change the card") })
  const remove = useApiMutation('deleteCard', {
    onSuccess: () => toast.success('Card deleted'),
    onError: (err) => toast.error(err, "Couldn't delete the card")
  })

  const topicTitles = useMemo(() => new Map(topics.map((t) => [t.id, t.title])), [topics])
  const topicFilterOptions = useMemo(
    () => [{ value: 'all', label: 'All topics' }, { value: 'none', label: 'No topic' }, ...topicOptions(topics)],
    [topics]
  )
  const matches = useMemo(() => filterCards(cards, filter, now), [cards, filter, now])
  const shown = matches.slice(0, limit)

  const changeFilter = (patch: Partial<CardFilter>) => {
    setFilter((f) => ({ ...f, ...patch }))
    setLimit(PAGE_SIZE)
  }

  const askDelete = async (card: Card) => {
    const ok = await confirm({
      title: 'Delete this card?',
      message: 'Its review history goes with it. To stop seeing it for a while, pause it instead.',
      confirmLabel: 'Delete card',
      tone: 'danger'
    })
    if (ok) remove.mutate([card.id])
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title="Flashcards"
        description={`${pluralize(cards.length, 'card')} in this notebook. Paused cards stay out of your reviews until you resume them.`}
        footer={
          <>
            <Button variant="subtle" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setEditing({ card: null })}>
              Add card
            </Button>
            <Button onClick={onClose}>Done</Button>
          </>
        }
      >
        <div className="card-browser__filters">
          <TextField
            type="search"
            label="Search"
            placeholder="Words on either side"
            value={filter.query}
            onChange={(event) => changeFilter({ query: event.target.value })}
            className="card-browser__search"
          />
          <Select
            label="Topic"
            value={filter.topic}
            onChange={(event) => changeFilter({ topic: event.target.value })}
            options={topicFilterOptions}
            className="card-browser__topic"
          />
        </div>
        <div className="card-browser__status">
          <Segmented<CardStatusFilter>
            label="Show"
            size="sm"
            value={filter.status}
            onChange={(status) => changeFilter({ status })}
            options={STATUS_OPTIONS}
          />
          <span className="card-browser__count" role="status">
            {matches.length === cards.length ? pluralize(cards.length, 'card') : `${matches.length} of ${pluralize(cards.length, 'card')}`}
          </span>
        </div>

        {matches.length === 0 ? (
          <EmptyState compact titleLevel={3} title={cards.length === 0 ? 'No cards yet' : 'No cards match'}>
            {cards.length === 0
              ? 'Cards are made when you finish a topic and from your mistakes. You can also write your own.'
              : 'Try other words, another topic or a different filter.'}
          </EmptyState>
        ) : (
          <ul className="card-browser__list" aria-label="Flashcards">
            {shown.map((card) => {
              const topic = card.topicId ? topicTitles.get(card.topicId) : undefined
              const due = cardDueLabel(card, now)
              const name = card.front.length > 60 ? `${card.front.slice(0, 59)}…` : card.front
              return (
                <li key={card.id} className={['card-browser__item', card.suspended && 'card-browser__item--paused'].filter(Boolean).join(' ')}>
                  <div className="card-browser__text">
                    <div className="card-browser__front">{card.front}</div>
                    <div className="card-browser__back">{card.back}</div>
                    <div className="card-browser__meta">
                      <Badge tone={isCardDue(card, now) ? 'warn' : card.state === 'new' && !card.suspended ? 'info' : 'neutral'}>{due}</Badge>
                      <span>{[topic, CARD_ORIGIN_LABELS[card.origin]].filter(Boolean).join(' · ')}</span>
                    </div>
                  </div>
                  <div className="card-browser__actions">
                    <IconButton label={`Edit card: ${name}`} size="sm" onClick={() => setEditing({ card })}>
                      <Pencil size={16} aria-hidden="true" />
                    </IconButton>
                    <Menu
                      label={`More actions for card: ${name}`}
                      items={[
                        card.suspended
                          ? {
                              label: 'Resume reviews',
                              icon: <Play size={16} aria-hidden="true" />,
                              onSelect: () => update.mutate([card.id, { suspended: false }])
                            }
                          : {
                              label: 'Pause reviews',
                              icon: <Pause size={16} aria-hidden="true" />,
                              onSelect: () => update.mutate([card.id, { suspended: true }])
                            },
                        'separator',
                        { label: 'Delete card', icon: <Trash2 size={16} aria-hidden="true" />, tone: 'danger', onSelect: () => void askDelete(card) }
                      ]}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {matches.length > shown.length && (
          <Button variant="ghost" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
            Show {Math.min(PAGE_SIZE, matches.length - shown.length)} more
          </Button>
        )}
      </Modal>
      <CardDialog
        open={editing !== null}
        card={editing?.card ?? null}
        notebookId={notebookId}
        topics={topics}
        defaultTopicId={filter.topic !== 'all' && filter.topic !== 'none' ? filter.topic : null}
        onClose={() => setEditing(null)}
      />
    </>
  )
}

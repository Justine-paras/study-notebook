import { useMemo, useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { Layers, Library, Plus } from 'lucide-react'
import type { Card, ID, TopicWithProgress } from '@shared/types'
import type { ApiError } from '../../lib/api'
import { ErrorNotice } from '../ErrorNotice'
import { Button, LoadingBlock, Panel } from '../ui'
import { pluralize } from '../../lib/format'
import { ROUTES } from '../../lib/routes'
import { CardBrowser } from './CardBrowser'
import { CardDialog } from './CardDialog'
import { countCards } from './model'
import './CardsPanel.css'

export interface CardsPanelProps {
  notebookId: ID
  cards: UseQueryResult<Card[], ApiError>
  topics: readonly TopicWithProgress[]
  now?: Date
}

/** Flashcard counts, a quick way to add one, the card browser and a link to review what's due. */
export function CardsPanel({ notebookId, cards, topics, now = new Date() }: CardsPanelProps) {
  const [adding, setAdding] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const list = useMemo(() => cards.data ?? [], [cards.data])
  const counts = useMemo(() => countCards(list, now), [list, now])

  return (
    <Panel
      title="Flashcards"
      actions={
        <Button variant="subtle" size="sm" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setAdding(true)}>
          Add card
        </Button>
      }
    >
      {cards.isPending ? (
        <LoadingBlock label="Loading cards…" />
      ) : cards.error ? (
        <ErrorNotice error={cards.error} title="Couldn't load your cards" compact onRetry={() => void cards.refetch()} />
      ) : list.length === 0 ? (
        <p className="cards-panel__empty">
          No cards yet. They are made for you when you finish a topic and from the questions you miss. You can also write your own.
        </p>
      ) : (
        <>
          <dl className="cards-panel__stats">
            <div className="cards-panel__stat">
              <dt>cards</dt>
              <dd className="tabular">{counts.total}</dd>
            </div>
            <div className={['cards-panel__stat', counts.due > 0 && 'cards-panel__stat--due'].filter(Boolean).join(' ')}>
              <dt>due now</dt>
              <dd className="tabular">{counts.due}</dd>
            </div>
            <div className="cards-panel__stat">
              <dt>in long-term memory</dt>
              <dd className="tabular">{counts.longTerm}</dd>
            </div>
          </dl>
          <div className="cards-panel__actions">
            {counts.due > 0 && (
              <Button to={ROUTES.review(notebookId)} size="sm" icon={<Layers size={16} aria-hidden="true" />}>
                Review {pluralize(counts.due, 'card')}
              </Button>
            )}
            <Button variant="ghost" size="sm" icon={<Library size={16} aria-hidden="true" />} onClick={() => setBrowsing(true)}>
              Browse cards
            </Button>
          </div>
        </>
      )}
      <CardDialog open={adding} card={null} notebookId={notebookId} topics={topics} onClose={() => setAdding(false)} />
      <CardBrowser
        open={browsing}
        onClose={() => setBrowsing(false)}
        notebookId={notebookId}
        cards={list}
        topics={topics}
        now={now}
      />
    </Panel>
  )
}

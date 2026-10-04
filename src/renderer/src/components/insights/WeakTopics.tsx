import { useId, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Layers, RotateCcw } from 'lucide-react'
import type { ID, WeakTopic } from '@shared/types'
import { Button, EmptyState, Panel, ProgressBar } from '../ui'
import { api, toApiError } from '../../lib/api'
import { queryKeys } from '../../lib/queries'
import { ROUTES } from '../../lib/routes'
import { subjectLabel, weakTopicStatus } from './insightsModel'
import './WeakTopics.css'

/** Rows shown before "Show all", so the side panels stay in view. */
const INITIAL_ROWS = 8

/**
 * How many (non-suspended) flashcards each topic has, from the same topic
 * queries the Topic page uses. A topic is missing until its query loads.
 */
function useCardCounts(topicIds: readonly ID[]): ReadonlyMap<ID, number> {
  const results = useQueries({
    queries: topicIds.map((id) => ({
      queryKey: queryKeys.topic(id),
      queryFn: async () => {
        try {
          return await api.getTopic(id)
        } catch (err) {
          throw toApiError(err)
        }
      }
    }))
  })
  return new Map(results.flatMap((r) => (r.data ? [[r.data.id, r.data.progress.cardCount] as const] : [])))
}

/** "Weak topics": every subject, lowest mastery first, each with why, a Relearn link and (with cards) a card review. */
export function WeakTopics({ topics }: { topics: WeakTopic[] }) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const shown = expanded ? topics : topics.slice(0, INITIAL_ROWS)
  const cardCounts = useCardCounts(shown.map((t) => t.topicId))
  // When some rows offer a card review, every row keeps room for it so the mastery bars line up.
  const withReviews = shown.some((t) => (cardCounts.get(t.topicId) ?? 0) > 0)

  return (
    <Panel title="Weak topics" titleStyle="serif" meta="All subjects, lowest first" flush className="weak-topics">
      {topics.length === 0 ? (
        <EmptyState compact titleLevel={3} kicker="nothing shaky right now" title="No weak topics" className="weak-topics__empty">
          Topics land here when you keep missing their questions or answer them sure but wrong. Keep practicing and
          this list will tell you where to look first.
        </EmptyState>
      ) : (
        <>
          <ul id={listId} className={['weak-topics__list', withReviews && 'weak-topics__list--reviews'].filter(Boolean).join(' ')}>
            {shown.map((topic) => {
              const status = weakTopicStatus(topic.mastery)
              return (
                <li key={topic.topicId} className="weak-topics__row">
                  <div className="weak-topics__text">
                    <span className="weak-topics__title">{topic.title}</span>
                    <span className="weak-topics__meta">
                      {subjectLabel(topic)} · {status.label} · {topic.why}
                    </span>
                  </div>
                  <ProgressBar
                    className="weak-topics__bar"
                    value={topic.mastery}
                    label={`Mastery of ${topic.title}`}
                    tone={status.tone}
                    size="lg"
                    showValue
                    minVisible
                  />
                  <div className="weak-topics__actions">
                    {(cardCounts.get(topic.topicId) ?? 0) > 0 && (
                      <Button
                        to={ROUTES.reviewTopic(topic.topicId)}
                        variant="subtle"
                        size="sm"
                        icon={<Layers size={15} aria-hidden="true" />}
                        aria-label={`Review cards for ${topic.title}`}
                      >
                        Review cards
                      </Button>
                    )}
                    <Button
                      to={ROUTES.topic(topic.topicId, 'learn')}
                      variant="secondary"
                      size="sm"
                      icon={<RotateCcw size={15} aria-hidden="true" />}
                      aria-label={`Relearn ${topic.title}`}
                    >
                      Relearn
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
          {topics.length > INITIAL_ROWS && (
            <div className="weak-topics__more">
              <Button variant="ghost" size="sm" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded((v) => !v)}>
                {expanded ? 'Show fewer' : `Show all ${topics.length}`}
              </Button>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

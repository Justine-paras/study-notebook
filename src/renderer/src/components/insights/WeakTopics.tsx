import { useId, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { WeakTopic } from '@shared/types'
import { Button, EmptyState, Panel, ProgressBar } from '../ui'
import { ROUTES } from '../../lib/routes'
import { subjectLabel, weakTopicStatus } from './insightsModel'
import './WeakTopics.css'

/** Rows shown before "Show all", so the side panels stay in view. */
const INITIAL_ROWS = 8

/** "Weak topics": every subject, lowest mastery first, each with why and a Relearn link. */
export function WeakTopics({ topics }: { topics: WeakTopic[] }) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const shown = expanded ? topics : topics.slice(0, INITIAL_ROWS)

  return (
    <Panel title="Weak topics" titleStyle="serif" meta="All subjects, lowest first" flush className="weak-topics">
      {topics.length === 0 ? (
        <EmptyState compact titleLevel={3} kicker="nothing shaky right now" title="No weak topics" className="weak-topics__empty">
          Topics land here when you keep missing their questions or answer them sure but wrong. Keep practicing and
          this list will tell you where to look first.
        </EmptyState>
      ) : (
        <>
          <ul id={listId} className="weak-topics__list">
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
                  <Button
                    to={ROUTES.topic(topic.topicId, 'learn')}
                    variant="secondary"
                    size="sm"
                    icon={<RotateCcw size={15} aria-hidden="true" />}
                    aria-label={`Relearn ${topic.title}`}
                  >
                    Relearn
                  </Button>
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

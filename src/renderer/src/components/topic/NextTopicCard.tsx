import { ArrowRight } from 'lucide-react'
import type { ID } from '@shared/types'
import { useNotebook, useTopic } from '../../lib/queries'
import { ROUTES } from '../../lib/routes'
import { ErrorNotice } from '../ErrorNotice'
import { MasteryPill } from '../MasteryPill'
import { Button, Pill, Spinner } from '../ui'
import './NextTopicCard.css'

export interface NextTopicCardProps {
  topicId: ID
  /** Why the plan picked it, written for the learner. */
  reason?: string
}

/** The plan's next topic to learn, with a link into its learning path. */
export function NextTopicCard({ topicId, reason }: NextTopicCardProps) {
  const topic = useTopic(topicId)
  const notebook = useNotebook(topic.data?.notebookId)

  if (topic.isPending) {
    return (
      <div className="next-topic next-topic--loading">
        <Spinner label="Loading topic" />
      </div>
    )
  }
  if (topic.error || !topic.data) {
    return <ErrorNotice error={topic.error} onRetry={() => void topic.refetch()} title="This topic couldn't be loaded" compact />
  }

  const t = topic.data
  const started = t.pathStep !== null
  return (
    <article className="next-topic">
      <div className="next-topic__meta">
        {notebook.data && (
          <Pill notebookColor={notebook.data.color}>{notebook.data.code.trim() || notebook.data.name}</Pill>
        )}
        {t.unitLabel && <span className="next-topic__unit">{t.unitLabel}</span>}
        <MasteryPill state={t.progress.state} />
      </div>
      <h3 className="next-topic__title display">{t.title}</h3>
      {t.description.trim() && <p className="next-topic__description">{t.description}</p>}
      {reason && <p className="hand hand--sm next-topic__reason">{reason}</p>}
      <div>
        <Button to={ROUTES.topic(t.id)} iconEnd={<ArrowRight size={16} aria-hidden="true" />}>
          {started ? 'Continue learning' : 'Start learning'}
        </Button>
      </div>
    </article>
  )
}

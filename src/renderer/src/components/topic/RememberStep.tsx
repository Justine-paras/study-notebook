import { useEffect, useId, useRef } from 'react'
import { ArrowLeft, CalendarCheck, Layers } from 'lucide-react'
import type { TopicWithProgress } from '@shared/types'
import { useAiAction } from '../../lib/aiJobs'
import { formatDate, pluralize } from '../../lib/format'
import { ROUTES } from '../../lib/routes'
import { AiWorking } from '../AiWorking'
import { Markdown } from '../Markdown'
import { ErrorNotice } from '../ErrorNotice'
import { Badge, Button, Sheet } from '../ui'
import { CARD_ORIGIN_TAGS } from './topicModel'
import './RememberStep.css'

export interface RememberStepProps {
  topic: TopicWithProgress
  /** Start right away (arriving from Practice, or revisiting a finished topic). */
  autoStart: boolean
}

/**
 * Step 5: finishTopic turns the lesson and the learner's mistakes into
 * flashcards and returns the review plan. It runs once per visit.
 */
export function RememberStep({ topic, autoStart }: RememberStepProps) {
  // finishTopic may call the AI. As a job it survives leaving the page, and a
  // second start while it runs (a remount, a double click) joins the running call.
  const finish = useAiAction('finishTopic', `finish:${topic.id}`, {
    task: 'flashcards',
    label: `Flashcards for ${topic.title}`,
    href: ROUTES.topic(topic.id, 'remember')
  })
  // Once per visit: finishing marks the topic done, which must not start it again.
  const startedRef = useRef(false)
  const { runAsync } = finish

  const start = () => {
    if (startedRef.current) return
    startedRef.current = true
    runAsync(topic.id).catch(() => {
      startedRef.current = false
    })
  }

  const cardsTitleId = useId()
  const shouldAutoStart = autoStart || topic.pathStep === 'done'
  const startRef = useRef(start)
  startRef.current = start
  useEffect(() => {
    if (shouldAutoStart) startRef.current()
  }, [shouldAutoStart])

  if (finish.isPending) {
    return (
      <AiWorking
        task="flashcards"
        title="Making your flashcards"
        explanation="Turning the lesson and the questions you missed into flashcards, then planning when each one comes back."
        startedAt={finish.job?.startedAt}
        subjectId={topic.id}
      />
    )
  }

  if (finish.error) {
    return <ErrorNotice error={finish.error} onRetry={start} title="Your flashcards couldn't be made" />
  }

  if (!finish.data) {
    return (
      <Sheet raised kicker="so you don't forget it" title="Lock it in" className="remember">
        <p className="remember__text">
          Finishing the topic turns the lesson and your mistakes into flashcards, then plans your reviews: each one comes just
          before you would start to forget.
        </p>
        <p className="remember__text muted">
          You haven't been through every step yet. You can finish now and come back to the other steps whenever you like.
        </p>
        <div>
          <Button size="lg" icon={<Layers size={18} aria-hidden="true" />} onClick={start}>
            Make my flashcards
          </Button>
        </div>
      </Sheet>
    )
  }

  const { cardsCreated, reviewPlan } = finish.data

  return (
    <Sheet raised kicker="so you don't forget it" title="Your review plan" className="remember">
      <p className="remember__text">
        Each review comes just before you'd start to forget. The gaps grow as the memory gets stronger, and they shrink again if you
        miss something.
      </p>

      {reviewPlan.length > 0 && (
        <ol className="remember__plan" aria-label="Upcoming reviews">
          {reviewPlan.map((review) => (
            <li key={review.date} className="remember__day">
              <CalendarCheck size={16} aria-hidden="true" className="remember__day-icon" />
              <span className="remember__when">{review.label}</span>
              <span className="remember__date">{formatDate(review.date, 'weekday-short')}</span>
            </li>
          ))}
        </ol>
      )}

      <section className="remember__cards" aria-labelledby={cardsTitleId}>
        <h3 id={cardsTitleId} className="remember__cards-title">
          {cardsCreated.length > 0 ? `Added to your flashcards (${cardsCreated.length})` : 'Your flashcards'}
        </h3>
        {cardsCreated.length === 0 ? (
          <p className="remember__text muted">No new cards this time: this lesson's cards are already in your deck.</p>
        ) : (
          <ul className="remember__list">
            {cardsCreated.map((card) => {
              const tag = CARD_ORIGIN_TAGS[card.origin]
              return (
                <li key={card.id} className="remember__card">
                  <Markdown variant="compact" className="remember__front">
                    {card.front}
                  </Markdown>
                  <Badge tone={tag.tone} className="remember__tag">
                    {tag.label}
                  </Badge>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="remember__actions">
        <Button size="lg" to={ROUTES.notebook(topic.notebookId)} icon={<ArrowLeft size={18} aria-hidden="true" />}>
          Done, back to topics
        </Button>
        <span className="hand hand--sm">
          {cardsCreated.length > 0 ? `first review ${reviewPlan[0]?.label.toLowerCase() ?? 'soon'}` : 'nicely done'}
        </span>
      </div>
      <span className="sr-only">{pluralize(cardsCreated.length, 'flashcard')} added.</span>
    </Sheet>
  )
}

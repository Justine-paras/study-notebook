import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowRight, Coffee, GraduationCap, House, SkipForward } from 'lucide-react'
import type { PlanBlock, ReviewCard, TodayPlan } from '@shared/types'
import { ErrorNotice } from '../components/ErrorNotice'
import { WeakSpotsRunner } from '../components/quiz/WeakSpotsRunner'
import { ReviewFlow } from '../components/review/ReviewFlow'
import {
  nextSessionPart,
  parseSessionPart,
  partNumber,
  planLearnTopicIds,
  planReviewCardIds,
  planWeakTopicIds,
  SESSION_PART_LABELS,
  SESSION_PARTS,
  sessionProgress,
  stillDue,
  type SessionPart
} from '../components/review/sessionModel'
import { NextTopicCard } from '../components/topic/NextTopicCard'
import { BackLink, Button, Card, EmptyState, LoadingBlock, Page, ProgressBar, Sheet } from '../components/ui'
import { usePomodoro } from '../lib/pomodoro'
import { useReviewQueue, useToday } from '../lib/queries'
import { ROUTES } from '../lib/routes'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import './Session.css'

const NEXT_LABELS: Record<SessionPart, string> = {
  review: 'Continue to part 2: fix weak spots',
  weak: 'Continue to part 3: learn something new',
  learn: 'End session'
}

/**
 * Today's session in focus mode: part 1 mixed review, part 2 weak spots,
 * part 3 the next topic to learn, all taken from today's plan. ?part=
 * picks the starting part; every part can be skipped.
 */
export default function SessionScreen() {
  useDocumentTitle("Today's session")
  const navigate = useNavigate()
  const pomodoro = usePomodoro()
  const [params, setParams] = useSearchParams()
  const part = parseSessionPart(params.get('part'))
  const today = useToday()

  // The plan is fixed when the session starts: reviews change it, and the parts must not shift underneath.
  const [plan, setPlan] = useState<TodayPlan | null>(null)
  useEffect(() => {
    if (!plan && today.data && !today.isFetching) setPlan(today.data.plan)
  }, [plan, today.data, today.isFetching])

  const [partFraction, setPartFraction] = useState(0)
  const [autoStartWeak, setAutoStartWeak] = useState(false)
  useEffect(() => setPartFraction(0), [part])

  const goTo = useCallback(
    (next: SessionPart | null, options: { autoStart?: boolean } = {}) => {
      if (!next) {
        navigate(ROUTES.today)
        return
      }
      setAutoStartWeak(next === 'weak' && !!options.autoStart)
      setParams({ part: next })
      document.getElementById('main')?.scrollTo({ top: 0 })
    },
    [navigate, setParams]
  )

  const takeBreak = () => {
    // Ending the focus phase early starts the Pomodoro break (and logs the focus time so far).
    if (pomodoro.phase === 'focus' && pomodoro.isRunning) pomodoro.skip()
    navigate(ROUTES.today)
  }

  const next = nextSessionPart(part)
  const header = (
    <div className="session__top">
      <BackLink onClick={() => navigate(ROUTES.today)}>End session</BackLink>
      <div className="session__where">
        <span className="session__part">
          Part {partNumber(part)} of {SESSION_PARTS.length} · {SESSION_PART_LABELS[part]}
        </span>
        {next && (
          <Button variant="ghost" size="sm" iconEnd={<SkipForward size={16} aria-hidden="true" />} onClick={() => goTo(next)}>
            Skip this part
          </Button>
        )}
      </div>
    </div>
  )

  const progress = (
    <ProgressBar
      value={sessionProgress(part, partFraction)}
      label="Session progress"
      valueText={`Part ${partNumber(part)} of ${SESSION_PARTS.length}, ${Math.round(partFraction * 100)}% through this part`}
      size="md"
    />
  )

  if (!plan) {
    return (
      <Page width="narrow">
        {header}
        {today.error ? (
          <ErrorNotice error={today.error} onRetry={() => void today.refetch()} title="Today's plan couldn't be loaded" />
        ) : (
          <LoadingBlock label="Getting today's plan…" />
        )}
      </Page>
    )
  }

  return (
    <Page width="narrow" className="session">
      {header}
      {progress}
      {part === 'review' && (
        <ReviewPart
          plan={plan}
          onProgress={setPartFraction}
          onContinue={() => goTo('weak', { autoStart: true })}
          onBreak={takeBreak}
        />
      )}
      {part === 'weak' && (
        <WeakSpotsRunner
          planDate={plan.date}
          topicIds={planWeakTopicIds(plan)}
          autoStart={autoStartWeak}
          onProgress={setPartFraction}
          onFinished={() => goTo('learn')}
          finishLabel={NEXT_LABELS.weak}
        />
      )}
      {part === 'learn' && <LearnPart plan={plan} onEnd={() => goTo(null)} />}
    </Page>
  )
}

interface ReviewPartProps {
  plan: TodayPlan
  onProgress: (fraction: number) => void
  onContinue: () => void
  onBreak: () => void
}

/** Part 1: the plan's due cards, interleaved across subjects. */
function ReviewPart({ plan, onProgress, onContinue, onBreak }: ReviewPartProps) {
  const cardIds = planReviewCardIds(plan)
  const queue = useReviewQueue({ cardIds }, { enabled: cardIds.length > 0, staleTime: Infinity, refetchOnWindowFocus: false })
  const [cards, setCards] = useState<ReviewCard[] | null>(null)
  // Only fresh data: a queue cached from an earlier visit may still hold cards graded since.
  const settled = queue.isSuccess && !queue.isFetching
  useEffect(() => {
    if (!cards && settled && queue.data) setCards(stillDue(queue.data, Date.now()))
  }, [cards, settled, queue.data])

  const continueButton = (
    <Button size="lg" iconEnd={<ArrowRight size={18} aria-hidden="true" />} onClick={onContinue}>
      {NEXT_LABELS.review}
    </Button>
  )

  if (cardIds.length === 0 || (cards && cards.length === 0)) {
    return (
      <EmptyState kicker="nothing due!" title="No reviews right now" action={continueButton}>
        Every card is resting until just before you'd forget it. On to your weak spots.
      </EmptyState>
    )
  }
  if (queue.error) {
    return <ErrorNotice error={queue.error} onRetry={() => void queue.refetch()} title="Your cards couldn't be loaded" />
  }
  if (!cards) return <LoadingBlock label="Shuffling your cards…" />

  return (
    <ReviewFlow
      cards={cards}
      showProgress={false}
      onProgress={onProgress}
      summaryKicker="part 1 done!"
      summaryTitle="Review finished"
      renderSummaryActions={() => (
        <>
          {continueButton}
          <Button size="lg" variant="secondary" icon={<Coffee size={18} aria-hidden="true" />} onClick={onBreak}>
            Take a break
          </Button>
        </>
      )}
    />
  )
}

/** Part 3: the plan's next topic(s) to learn, plus any mock exam it suggests. */
function LearnPart({ plan, onEnd }: { plan: TodayPlan; onEnd: () => void }) {
  const topicIds = planLearnTopicIds(plan)
  const reasonFor = (topicId: string) => plan.blocks.find((b) => b.kind === 'learn' && b.topicIds.includes(topicId))?.reason
  const examBlocks = plan.blocks.filter((b): b is PlanBlock => b.kind === 'exam_prep')

  return (
    <Sheet raised kicker="part 3" title="Learn something new" className="session-learn">
      {topicIds.length > 0 ? (
        <>
          <p className="session-learn__text">
            Your memory is warmed up, which is a good moment to start something new. Open the lesson now, or come back to it later
            today.
          </p>
          <div className="session-learn__topics">
            {topicIds.map((id) => (
              <NextTopicCard key={id} topicId={id} reason={reasonFor(id)} />
            ))}
          </div>
        </>
      ) : (
        <EmptyState
          compact
          titleLevel={3}
          kicker="no new topic today"
          title="Nothing new planned"
          action={
            <Button to={ROUTES.notebooks} variant="secondary" icon={<GraduationCap size={16} aria-hidden="true" />}>
              Pick a topic anyway
            </Button>
          }
        >
          Today's plan has no new topic, either because you've reached your daily limit or there's nothing left to start.
        </EmptyState>
      )}

      {examBlocks.map((block) => (
        <Card key={block.title} className="session-learn__exam">
          <div className="session-learn__exam-text">
            <span className="session-learn__exam-title">{block.title}</span>
            <span className="text-sm muted">{block.detail}</span>
            {block.reason && <span className="hand hand--sm">{block.reason}</span>}
          </div>
          {block.notebookIds[0] && (
            <Button to={ROUTES.notebook(block.notebookIds[0])} variant="secondary" size="sm">
              Open the notebook
            </Button>
          )}
        </Card>
      ))}

      <div className="session-learn__actions">
        <Button variant="subtle" icon={<House size={16} aria-hidden="true" />} onClick={onEnd}>
          {NEXT_LABELS.learn}
        </Button>
      </div>
    </Sheet>
  )
}

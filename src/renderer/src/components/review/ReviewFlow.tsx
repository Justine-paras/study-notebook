import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Confidence, Rating, ReviewCard } from '@shared/types'
import { api, toApiError, type ApiError } from '../../lib/api'
import { useHotkeys } from '../../lib/useHotkeys'
import { ErrorNotice } from '../ErrorNotice'
import { Kbd, ProgressBar } from '../ui'
import { ReviewCardView } from './ReviewCardView'
import {
  confidenceForKey,
  currentCard,
  flowProgress,
  initialReviewFlow,
  isFlowDone,
  isRepeat,
  ratingForKey,
  reviewFlowReducer,
  shouldRequeue,
  summarizeReview,
  type ReviewSummary as Summary
} from './reviewModel'
import { ReviewSummary } from './ReviewSummary'
import './ReviewFlow.css'

export interface ReviewFlowProps {
  /** A snapshot of the queue: it must not change while the learner reviews. Key the flow to restart it. */
  cards: readonly ReviewCard[]
  /** Show a progress bar above the card (the session has its own). Default true. */
  showProgress?: boolean
  /** 0-1 progress, for a parent progress bar. */
  onProgress?: (fraction: number) => void
  /** Called once when the last card is graded. */
  onDone?: (summary: Summary) => void
  summaryKicker?: string
  summaryTitle?: string
  /** Buttons under the summary. */
  renderSummaryActions?: (summary: Summary) => ReactNode
}

const NUDGE_MS = 1600

/**
 * The flashcard review loop shared by /review and part 1 of /session:
 * front -> optional typed answer -> confidence (reveals) -> answer and source
 * -> Again/Hard/Good/Easy. Cards rated Again come back at the end of the
 * queue when they are due again within 15 minutes. Keys: 1-3 pick the
 * confidence, then 1-4 grade.
 */
export function ReviewFlow({
  cards,
  showProgress = true,
  onProgress,
  onDone,
  summaryKicker,
  summaryTitle,
  renderSummaryActions
}: ReviewFlowProps) {
  const queryClient = useQueryClient()
  const [state, dispatch] = useReducer(reviewFlowReducer, cards, initialReviewFlow)
  const [pendingRating, setPendingRating] = useState<Rating | null>(null)
  const [error, setError] = useState<{ rating: Rating; error: ApiError } | null>(null)
  const [nudge, setNudge] = useState(false)
  const frontRef = useRef<HTMLDivElement>(null)
  const confidenceRef = useRef<HTMLDivElement>(null)
  const gradesRef = useRef<HTMLDivElement>(null)
  const card = currentCard(state)
  const done = isFlowDone(state)
  const summary = summarizeReview(state.log)

  const fraction = flowProgress(state)
  useEffect(() => {
    onProgress?.(fraction)
  }, [fraction, onProgress])

  // Grades skip cache invalidation (the queue on screen is a snapshot); refresh everything once at the end.
  const finishedRef = useRef(false)
  useEffect(() => {
    if (!done || finishedRef.current) return
    finishedRef.current = true
    void queryClient.invalidateQueries()
    onDone?.(summarizeReview(state.log))
  }, [done, onDone, queryClient, state.log])

  // A new card puts focus on its question, so screen readers read it and 1-3 work right away.
  useEffect(() => {
    if (state.stage === 'ask') frontRef.current?.focus({ preventScroll: state.index === 0 })
  }, [state.index, state.stage])

  useEffect(() => {
    if (state.stage === 'revealed') gradesRef.current?.focus({ preventScroll: true })
  }, [state.stage])

  useEffect(() => {
    if (!nudge) return
    const id = window.setTimeout(() => setNudge(false), NUDGE_MS)
    return () => window.clearTimeout(id)
  }, [nudge])

  const reveal = useCallback((confidence: Confidence) => {
    setNudge(false)
    dispatch({ type: 'reveal', confidence })
  }, [])

  const grade = useCallback(
    async (rating: Rating) => {
      if (!card || state.stage !== 'revealed' || pendingRating !== null) return
      setPendingRating(rating)
      setError(null)
      try {
        const updated = await api.reviewCard({ cardId: card.id, rating, confidence: state.confidence, response: state.response.trim() })
        let requeue: ReviewCard | null = null
        if (shouldRequeue(rating, updated, Date.now())) {
          // Fresh previews for the second look; the old ones describe the card before this grade.
          const fresh = await api.getReviewQueue({ cardIds: [card.id] }).catch(() => [])
          requeue = fresh[0] ?? { ...card, ...updated }
        }
        dispatch({ type: 'graded', rating, requeue })
      } catch (err) {
        setError({ rating, error: toApiError(err) })
      } finally {
        setPendingRating(null)
      }
    },
    [card, pendingRating, state.confidence, state.response, state.stage]
  )

  const asking = !done && state.stage === 'ask'
  useHotkeys(
    {
      '1, 2, 3': (event) => {
        const confidence = confidenceForKey(event.key)
        if (confidence) reveal(confidence)
      },
      'space, enter': (event) => {
        // A focused button keeps its own Space/Enter; otherwise point at the confidence buttons.
        if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement) {
          event.target.click()
          return
        }
        setNudge(true)
        confidenceRef.current?.querySelector('button')?.focus()
      }
    },
    { enabled: asking }
  )
  useHotkeys(
    {
      '1, 2, 3, 4': (event) => {
        const rating = ratingForKey(event.key)
        if (rating) void grade(rating)
      }
    },
    { enabled: !done && state.stage === 'revealed' && pendingRating === null }
  )

  if (done) {
    return (
      <ReviewSummary
        summary={summary}
        kicker={summaryKicker}
        title={summaryTitle}
        actions={renderSummaryActions?.(summary)}
      />
    )
  }
  if (!card) return null

  return (
    <div className="review-flow">
      {showProgress && (
        <ProgressBar
          value={state.index}
          max={state.queue.length}
          label="Review progress"
          valueText={`${state.index} of ${state.queue.length} cards done`}
          size="md"
        />
      )}
      <ReviewCardView
        ref={frontRef}
        key={`${state.index}-${card.id}`}
        card={card}
        stage={state.stage}
        confidence={state.confidence}
        response={state.response}
        onResponse={(response) => dispatch({ type: 'respond', response })}
        onConfidence={reveal}
        onGrade={(rating) => void grade(rating)}
        position={`Card ${state.index + 1} of ${state.queue.length}`}
        repeat={isRepeat(state)}
        pendingRating={pendingRating}
        confidenceRef={confidenceRef}
        gradesRef={gradesRef}
        nudge={nudge}
        footer={
          <ErrorNotice error={error?.error} title="That grade wasn't saved" onRetry={error ? () => void grade(error.rating) : undefined} compact />
        }
      />
      <p className="review-flow__keys">
        {state.stage === 'ask' ? (
          <>
            <Kbd>1</Kbd> sure · <Kbd>2</Kbd> unsure · <Kbd>3</Kbd> guessing shows the answer
          </>
        ) : (
          <>
            <Kbd>1</Kbd> Again · <Kbd>2</Kbd> Hard · <Kbd>3</Kbd> Good · <Kbd>4</Kbd> Easy
          </>
        )}
      </p>
    </div>
  )
}

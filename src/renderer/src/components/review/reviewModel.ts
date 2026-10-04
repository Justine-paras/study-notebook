// Pure state for the flashcard review flow used by /review and part 1 of
// /session: recall -> confidence (reveals) -> grade, with missed cards coming
// back at the end of the queue. No DOM or React here (unit-tested in Node).

import type { Card, Confidence, ID, Rating, RatingPreview, ReviewCard } from '@shared/types'

export const RATINGS: readonly Rating[] = [1, 2, 3, 4]

/** A card rated Again comes back in this session when it is due again within this window. */
export const REQUEUE_WINDOW_MS = 15 * 60_000

export type ReviewStage = 'ask' | 'revealed'

export interface ReviewEntry {
  cardId: ID
  rating: Rating
  confidence: Confidence | null
  /** True when this grading put the card back into the queue. */
  requeued: boolean
}

export interface ReviewFlowState {
  queue: ReviewCard[]
  index: number
  stage: ReviewStage
  confidence: Confidence | null
  /** What the learner typed before revealing. */
  response: string
  log: ReviewEntry[]
}

export type ReviewFlowAction =
  | { type: 'respond'; response: string }
  | { type: 'reveal'; confidence: Confidence }
  | { type: 'graded'; rating: Rating; requeue: ReviewCard | null }

export function initialReviewFlow(cards: readonly ReviewCard[]): ReviewFlowState {
  return { queue: [...cards], index: 0, stage: 'ask', confidence: null, response: '', log: [] }
}

export function reviewFlowReducer(state: ReviewFlowState, action: ReviewFlowAction): ReviewFlowState {
  const card = state.queue[state.index]
  if (!card) return state
  switch (action.type) {
    case 'respond':
      return state.stage === 'ask' ? { ...state, response: action.response } : state
    case 'reveal':
      return state.stage === 'ask' ? { ...state, stage: 'revealed', confidence: action.confidence } : state
    case 'graded': {
      if (state.stage !== 'revealed') return state
      const entry: ReviewEntry = { cardId: card.id, rating: action.rating, confidence: state.confidence, requeued: !!action.requeue }
      return {
        queue: action.requeue ? [...state.queue, action.requeue] : state.queue,
        index: state.index + 1,
        stage: 'ask',
        confidence: null,
        response: '',
        log: [...state.log, entry]
      }
    }
  }
}

export function currentCard(state: ReviewFlowState): ReviewCard | null {
  return state.queue[state.index] ?? null
}

export function isFlowDone(state: ReviewFlowState): boolean {
  return state.index >= state.queue.length
}

/** True when the card under review was already graded earlier in this flow (a second look). */
export function isRepeat(state: ReviewFlowState): boolean {
  const card = currentCard(state)
  return !!card && state.log.some((e) => e.cardId === card.id)
}

/** Again, when the card's new due time falls inside the session window. */
export function shouldRequeue(rating: Rating, updated: Pick<Card, 'due'>, now: number): boolean {
  if (rating !== 1) return false
  const due = Date.parse(updated.due)
  return !Number.isNaN(due) && due - now <= REQUEUE_WINDOW_MS
}

export interface ReviewSummary {
  /** Distinct cards reviewed. */
  reviewed: number
  /** Cards recalled on the first try (not rated Again). */
  recalled: number
  /** Cards rated Again on the first try while "sure". */
  overconfident: number
  /** Cards missed on the first try; they come back soon. */
  missed: number
  /** Gradings in total, including second looks. */
  gradings: number
}

export function summarizeReview(log: readonly ReviewEntry[]): ReviewSummary {
  const first = new Map<ID, ReviewEntry>()
  for (const entry of log) if (!first.has(entry.cardId)) first.set(entry.cardId, entry)
  let recalled = 0
  let overconfident = 0
  for (const entry of first.values()) {
    if (entry.rating > 1) recalled++
    else if (entry.confidence === 'sure') overconfident++
  }
  return { reviewed: first.size, recalled, overconfident, missed: first.size - recalled, gradings: log.length }
}

/** 0-1 progress through the queue (it can grow when cards come back). */
export function flowProgress(state: ReviewFlowState): number {
  return state.queue.length === 0 ? 1 : Math.min(1, state.index / state.queue.length)
}

// ---------------------------------------------------------------------------
// Keys and labels
// ---------------------------------------------------------------------------

const CONFIDENCE_KEYS: Record<string, Confidence> = { '1': 'sure', '2': 'unsure', '3': 'guess' }

/** "1" sure, "2" unsure, "3" guessing. */
export function confidenceForKey(key: string): Confidence | null {
  return CONFIDENCE_KEYS[key] ?? null
}

export function ratingForKey(key: string): Rating | null {
  return key === '1' || key === '2' || key === '3' || key === '4' ? (Number(key) as Rating) : null
}

/**
 * Mirrors the backend rule (adjustRatingForConfidence in shared/learning.ts):
 * a Good or Easy given while guessing is scheduled as Hard, because a lucky
 * guess is not a reliable memory yet. Kept here so the renderer bundle does
 * not pull in the FSRS scheduler.
 */
export function effectiveRating(rating: Rating, confidence: Confidence | null): Rating {
  return confidence === 'guess' && rating >= 3 ? 2 : rating
}

/** The interval label a grade button shows, e.g. "10 min" or "3 days". */
export function previewLabel(previews: readonly RatingPreview[], rating: Rating, confidence: Confidence | null): string | null {
  const effective = effectiveRating(rating, confidence)
  return previews.find((p) => p.rating === effective)?.intervalLabel ?? null
}

export type GradeTone = 'bad' | 'caution' | 'info' | 'good'

export const GRADE_TONES: Record<Rating, GradeTone> = { 1: 'bad', 2: 'caution', 3: 'info', 4: 'good' }

/** One line under each grade, in the learner's terms. */
export const GRADE_HINTS: Record<Rating, string> = {
  1: "Didn't remember",
  2: 'Remembered with effort',
  3: 'Remembered it',
  4: 'Knew it instantly'
}

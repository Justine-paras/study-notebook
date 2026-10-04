import { describe, expect, it } from 'vitest'
import type { ReviewCard } from '@shared/types'
import {
  confidenceForKey,
  currentCard,
  effectiveRating,
  flowProgress,
  initialReviewFlow,
  isFlowDone,
  isRepeat,
  previewLabel,
  ratingForKey,
  reviewFlowReducer,
  shouldRequeue,
  summarizeReview
} from './reviewModel'

function card(id: string): ReviewCard {
  return {
    id,
    notebookId: 'n',
    topicId: 't',
    front: `Front ${id}`,
    back: `Back ${id}`,
    origin: 'lesson',
    sourceRef: '',
    suspended: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    due: '2026-10-04T00:00:00.000Z',
    stability: 1,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 1,
    lapses: 0,
    state: 'review',
    lastReview: null,
    notebookName: 'DSA',
    notebookColor: 'blue',
    topicTitle: 'Hashing',
    previews: [
      { rating: 1, intervalLabel: '1 min', due: '' },
      { rating: 2, intervalLabel: '1 day', due: '' },
      { rating: 3, intervalLabel: '3 days', due: '' },
      { rating: 4, intervalLabel: '8 days', due: '' }
    ]
  }
}

describe('review flow', () => {
  it('reveals only after a confidence and grades only after revealing', () => {
    let state = initialReviewFlow([card('a'), card('b')])
    state = reviewFlowReducer(state, { type: 'graded', rating: 3, requeue: null })
    expect(state.index).toBe(0)
    state = reviewFlowReducer(state, { type: 'respond', response: 'my answer' })
    state = reviewFlowReducer(state, { type: 'reveal', confidence: 'sure' })
    expect(state.stage).toBe('revealed')
    expect(state.response).toBe('my answer')
    // Typing after the reveal does not change what was recalled.
    state = reviewFlowReducer(state, { type: 'respond', response: 'changed' })
    expect(state.response).toBe('my answer')
    state = reviewFlowReducer(state, { type: 'graded', rating: 3, requeue: null })
    expect(state).toMatchObject({ index: 1, stage: 'ask', confidence: null, response: '' })
    expect(state.log).toEqual([{ cardId: 'a', rating: 3, confidence: 'sure', requeued: false }])
    expect(currentCard(state)?.id).toBe('b')
  })

  it('puts a missed card back at the end of the queue', () => {
    let state = initialReviewFlow([card('a'), card('b')])
    state = reviewFlowReducer(state, { type: 'reveal', confidence: 'sure' })
    state = reviewFlowReducer(state, { type: 'graded', rating: 1, requeue: card('a') })
    expect(state.queue.map((c) => c.id)).toEqual(['a', 'b', 'a'])
    state = reviewFlowReducer(state, { type: 'reveal', confidence: 'unsure' })
    state = reviewFlowReducer(state, { type: 'graded', rating: 3, requeue: null })
    expect(isRepeat(state)).toBe(true)
    expect(flowProgress(state)).toBeCloseTo(2 / 3)
    state = reviewFlowReducer(state, { type: 'reveal', confidence: 'unsure' })
    state = reviewFlowReducer(state, { type: 'graded', rating: 3, requeue: null })
    expect(isFlowDone(state)).toBe(true)
    expect(flowProgress(state)).toBe(1)
    expect(summarizeReview(state.log)).toEqual({ reviewed: 2, recalled: 1, overconfident: 1, missed: 1, gradings: 3 })
  })

  it('is done straight away with no cards', () => {
    const state = initialReviewFlow([])
    expect(isFlowDone(state)).toBe(true)
    expect(reviewFlowReducer(state, { type: 'reveal', confidence: 'sure' })).toBe(state)
  })
})

describe('requeue rule', () => {
  const now = Date.parse('2026-10-04T10:00:00.000Z')
  it('requeues Again cards due within 15 minutes', () => {
    expect(shouldRequeue(1, { due: '2026-10-04T10:01:00.000Z' }, now)).toBe(true)
    expect(shouldRequeue(1, { due: '2026-10-04T10:15:00.000Z' }, now)).toBe(true)
    expect(shouldRequeue(1, { due: '2026-10-04T10:16:00.000Z' }, now)).toBe(false)
    expect(shouldRequeue(2, { due: '2026-10-04T10:01:00.000Z' }, now)).toBe(false)
    expect(shouldRequeue(1, { due: 'garbage' }, now)).toBe(false)
  })
})

describe('keys and labels', () => {
  it('maps 1-3 to confidence and 1-4 to ratings', () => {
    expect(['1', '2', '3', '4'].map(confidenceForKey)).toEqual(['sure', 'unsure', 'guess', null])
    expect(['1', '4', '5', 'a'].map(ratingForKey)).toEqual([1, 4, null, null])
  })

  it('shows Hard intervals for Good and Easy when guessing (backend rule)', () => {
    expect(effectiveRating(4, 'guess')).toBe(2)
    expect(effectiveRating(1, 'guess')).toBe(1)
    expect(effectiveRating(4, 'sure')).toBe(4)
    const previews = card('a').previews
    expect(previewLabel(previews, 3, 'sure')).toBe('3 days')
    expect(previewLabel(previews, 3, 'guess')).toBe('1 day')
    expect(previewLabel([], 3, null)).toBeNull()
  })
})

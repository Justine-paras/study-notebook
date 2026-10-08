import { describe, expect, it } from 'vitest'
import {
  addDays,
  adjustRatingForConfidence,
  applyRating,
  buildTodayPlan,
  calibration,
  computeTopicProgress,
  daysBetween,
  examReadiness,
  forecastDue,
  formatInterval,
  gradeResponse,
  interleaveByNotebook,
  isRecalledRating,
  levenshtein,
  localDate,
  MOCK_EXAM_MINUTES,
  newCardSchedule,
  normalizeAnswer,
  planMinutes,
  previewRatings,
  retrievability,
  reviewPlanLabels,
  streakDays,
  weakSpotQuizSize,
  weakTopicReason,
  type PlanCard,
  type PlanTopic,
  type TodayPlanInput
} from './learning'
import type {
  AnswerRecord,
  Card,
  CardSchedule,
  Exam,
  MasteryState,
  Question,
  Rating,
  ReviewLog,
  Topic,
  TopicProgress,
  TopicWithProgress
} from './types'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// Local noon keeps every fixture on the intended calendar day in any time zone.
const NOW = new Date(2026, 9, 4, 12, 0, 0)
const daysAgo = (n: number, from = NOW): Date => new Date(from.getFullYear(), from.getMonth(), from.getDate() - n, 12)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function topic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: 't1',
    notebookId: 'nb1',
    title: 'Binary search trees',
    description: '',
    unitLabel: 'Week 4',
    orderIndex: 0,
    sourceIds: [],
    pathStep: null,
    chunkIndex: 0,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides
  }
}

let seq = 0
function answer(correct: boolean, at: Date, overrides: Partial<AnswerRecord> = {}): AnswerRecord {
  seq += 1
  return {
    id: `a${String(seq).padStart(4, '0')}`,
    notebookId: 'nb1',
    topicId: 't1',
    quizId: null,
    cardId: null,
    source: 'practice',
    questionType: 'mc',
    prompt: 'Q',
    userAnswer: 'x',
    correctAnswer: 'y',
    correct,
    confidence: null,
    answeredAt: at.toISOString(),
    ...overrides
  }
}

function card(overrides: Partial<Card> = {}): Card {
  return {
    ...newCardSchedule(NOW),
    id: 'c1',
    notebookId: 'nb1',
    topicId: 't1',
    front: 'Front',
    back: 'Back',
    origin: 'lesson',
    sourceRef: '',
    suspended: false,
    createdAt: NOW.toISOString(),
    ...overrides
  }
}

function review(rating: Rating, at: Date, overrides: Partial<ReviewLog> = {}): ReviewLog {
  seq += 1
  return {
    id: `r${String(seq).padStart(4, '0')}`,
    cardId: 'c1',
    rating,
    confidence: null,
    stateBefore: 'review',
    scheduledDays: 1,
    elapsedDays: 1,
    reviewedAt: at.toISOString(),
    ...overrides
  }
}

function progress(overrides: Partial<TopicProgress> = {}): TopicProgress {
  return {
    topicId: 't1',
    state: 'reviewing',
    mastery: 50,
    recentAccuracy: null,
    answeredCount: 0,
    missedCount: 0,
    overconfidentCount: 0,
    cardCount: 0,
    dueCards: 0,
    nextReviewAt: null,
    lastPracticedAt: null,
    ...overrides
  }
}

function topicWithProgress(id: string, orderIndex: number, state: MasteryState, mastery: number, overrides: Partial<Topic> = {}): TopicWithProgress {
  return { ...topic({ id, orderIndex, title: `Topic ${id}`, ...overrides }), progress: progress({ topicId: id, state, mastery }) }
}

function planTopic(
  id: string,
  orderIndex: number,
  state: MasteryState,
  mastery: number,
  overrides: Partial<PlanTopic> = {}
): PlanTopic {
  const base = topicWithProgress(id, orderIndex, state, mastery)
  return { ...base, notebookName: 'Data Structures', notebookCode: 'CS 201', ...overrides }
}

function planCard(id: string, notebookId: string, due: Date, overrides: Partial<PlanCard> = {}): PlanCard {
  const code = notebookId === 'nb1' ? 'CS 201' : notebookId === 'nb2' ? 'CS 310' : ''
  return { ...card({ id, notebookId, due: due.toISOString() }), notebookName: `Notebook ${notebookId}`, notebookCode: code, ...overrides }
}

function exam(overrides: Partial<Exam> = {}): Exam {
  return { id: 'e1', notebookId: 'nb1', name: 'Midterm', examDate: '2026-10-12', topicIds: [], createdAt: '2026-09-01T00:00:00.000Z', ...overrides }
}

function question(type: Question['type'], answerText: string, acceptable: string[] = [], options: string[] = []): Question {
  return {
    id: 'q1',
    type,
    prompt: 'Prompt ____',
    options,
    answer: answerText,
    acceptable,
    explanation: '',
    topicId: 't1',
    difficulty: 'medium',
    sourceRef: ''
  }
}

function planInput(overrides: Partial<TodayPlanInput> = {}): TodayPlanInput {
  return { now: NOW, dueCards: [], topics: [], exams: [], newTopicsPerDay: 1, maxReviewsPerDay: 100, ...overrides }
}

/** Reviews a card `Good` each time it comes due and returns the intervals in days. */
function goodIntervals(times: number): number[] {
  let schedule: CardSchedule = newCardSchedule(NOW)
  let at = NOW
  const intervals: number[] = []
  for (let i = 0; i < times; i++) {
    schedule = applyRating(schedule, 3, at, 0.9).schedule
    const due = new Date(schedule.due)
    intervals.push((due.getTime() - at.getTime()) / DAY)
    at = due
  }
  return intervals
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

describe('localDate', () => {
  it('formats the local calendar date with zero padding', () => {
    expect(localDate(new Date(2026, 0, 5, 0, 0, 0))).toBe('2026-01-05')
    expect(localDate(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31')
  })
})

describe('daysBetween', () => {
  it('counts whole calendar days in both directions', () => {
    expect(daysBetween('2026-10-04', '2026-10-04')).toBe(0)
    expect(daysBetween('2026-10-04', '2026-10-12')).toBe(8)
    expect(daysBetween('2026-10-12', '2026-10-04')).toBe(-8)
  })

  it('crosses month, year and leap-day boundaries', () => {
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2)
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365)
  })

  it('is exact across DST changes', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
    expect(daysBetween('2026-10-24', '2026-10-27')).toBe(3)
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2)
  })

  it('rejects malformed dates', () => {
    expect(() => daysBetween('2026-10-4', '2026-10-05')).toThrow(RangeError)
  })
})

describe('addDays', () => {
  it('moves across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-10-04', 0)).toBe('2026-10-04')
  })
})

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

describe('normalizeAnswer', () => {
  it('lower-cases, trims and collapses whitespace', () => {
    expect(normalizeAnswer('  Binary   Search\tTree ')).toBe('binary search tree')
  })

  it('strips surrounding punctuation but keeps brackets', () => {
    expect(normalizeAnswer('"Stack."')).toBe('stack')
    expect(normalizeAnswer('`push`!')).toBe('push')
    expect(normalizeAnswer('O(n)')).toBe('o(n)')
  })

  it('strips articles in front of words only', () => {
    expect(normalizeAnswer('The stack')).toBe('stack')
    expect(normalizeAnswer('an AVL tree')).toBe('avl tree')
    expect(normalizeAnswer('a')).toBe('a')
    expect(normalizeAnswer('a + b')).toBe('a + b')
  })

  it('normalizes spacing inside brackets and around commas', () => {
    expect(normalizeAnswer('O( n )')).toBe('o(n)')
    expect(normalizeAnswer('O(n,m)')).toBe(normalizeAnswer('O(n , m)'))
  })

  it('maps typographic quotes and dashes', () => {
    expect(normalizeAnswer('Dijkstra’s')).toBe("dijkstra's")
    expect(normalizeAnswer('in–order')).toBe('in-order')
  })
})

describe('levenshtein', () => {
  it('computes edit distance and stops early past the limit', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('abc', 'abc')).toBe(0)
    expect(levenshtein('abcdef', 'uvwxyz', 1)).toBe(2)
  })
})

describe('gradeResponse', () => {
  it('never accepts an empty or blank response', () => {
    expect(gradeResponse(question('fill', 'stack'), '')).toBe(false)
    expect(gradeResponse(question('fill', 'stack'), '   ')).toBe(false)
    expect(gradeResponse(question('mc', '...', [], ['...', 'b']), '...')).toBe(false)
  })

  it('grades multiple choice after normalization', () => {
    const q = question('mc', 'O(log n)', [], ['O(1)', 'O(log n)', 'O(n)'])
    expect(gradeResponse(q, 'O(log n)')).toBe(true)
    expect(gradeResponse(q, 'o(log n)')).toBe(true)
    expect(gradeResponse(q, 'O( log n )')).toBe(true)
    expect(gradeResponse(q, 'O(n)')).toBe(false)
    expect(gradeResponse(q, 'O(log m)')).toBe(false)
  })

  it('accepts True/False, T/F in any case', () => {
    const q = question('tf', 'True', [], ['True', 'False'])
    for (const r of ['True', 'true', 'TRUE', 't', 'T', ' true. ']) expect(gradeResponse(q, r)).toBe(true)
    for (const r of ['False', 'f', 'F', 'yes', 'tru']) expect(gradeResponse(q, r)).toBe(false)
    expect(gradeResponse(question('tf', 'False', [], ['True', 'False']), 'f')).toBe(true)
  })

  it('matches fill answers and acceptable alternatives', () => {
    const q = question('fill', 'last in, first out', ['LIFO'])
    expect(gradeResponse(q, 'LIFO')).toBe(true)
    expect(gradeResponse(q, 'Last in, first out.')).toBe(true)
    expect(gradeResponse(q, 'FIFO')).toBe(false)
  })

  it('ignores hyphens and spaces', () => {
    const q = question('identification', 'in-order')
    expect(gradeResponse(q, 'inorder')).toBe(true)
    expect(gradeResponse(q, 'in order')).toBe(true)
    expect(gradeResponse(q, 'In-Order traversal')).toBe(false)
  })

  it('tolerates typos by answer length', () => {
    // Below 5 characters: exact only.
    expect(gradeResponse(question('fill', 'heap'), 'heap')).toBe(true)
    expect(gradeResponse(question('fill', 'heap'), 'hep')).toBe(false)
    // 5-8 characters: one edit.
    expect(gradeResponse(question('fill', 'queue'), 'queu')).toBe(true)
    expect(gradeResponse(question('fill', 'queue'), 'qeu')).toBe(false)
    expect(gradeResponse(question('fill', 'stacks'), 'stack')).toBe(true)
    // 9+ characters: two edits.
    expect(gradeResponse(question('identification', 'polymorphism'), 'polymorfism')).toBe(true)
    expect(gradeResponse(question('identification', 'polymorphism'), 'polimorphizm')).toBe(true)
    expect(gradeResponse(question('identification', 'polymorphism'), 'polimorfism')).toBe(false)
  })

  it('does not treat a different complexity or number as a typo', () => {
    expect(gradeResponse(question('fill', 'O(n log n)'), 'O(log n)')).toBe(false)
    expect(gradeResponse(question('fill', 'O(n^2)'), 'O(n^3)')).toBe(false)
    expect(gradeResponse(question('fill', '1024'), '1025')).toBe(false)
    expect(gradeResponse(question('fill', 'O(n)'), 'o( n )')).toBe(true)
    expect(gradeResponse(question('fill', 'O(n)'), 'O(N)')).toBe(true)
  })

  it('does not accept the opposite word as a typo', () => {
    expect(gradeResponse(question('fill', 'immutable'), 'mutable')).toBe(false)
    expect(gradeResponse(question('fill', 'synchronous'), 'asynchronous')).toBe(false)
    expect(gradeResponse(question('fill', 'deserialize'), 'serialize')).toBe(false)
  })

  it('skips empty acceptable answers', () => {
    expect(gradeResponse(question('fill', 'stack', ['', '  ']), 'queue')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// FSRS
// ---------------------------------------------------------------------------

describe('newCardSchedule', () => {
  it('is a new card due now', () => {
    const s = newCardSchedule(NOW)
    expect(s).toMatchObject({ due: NOW.toISOString(), state: 'new', reps: 0, lapses: 0, lastReview: null, learningSteps: 0 })
  })
})

describe('isRecalledRating', () => {
  it('counts every rating except Again as recalled', () => {
    expect(([1, 2, 3, 4] as Rating[]).map(isRecalledRating)).toEqual([false, true, true, true])
  })
})

describe('adjustRatingForConfidence', () => {
  it('downgrades Good/Easy to Hard when guessing only', () => {
    expect(adjustRatingForConfidence(3, 'guess')).toBe(2)
    expect(adjustRatingForConfidence(4, 'guess')).toBe(2)
    expect(adjustRatingForConfidence(1, 'guess')).toBe(1)
    expect(adjustRatingForConfidence(2, 'guess')).toBe(2)
    expect(adjustRatingForConfidence(4, 'sure')).toBe(4)
    expect(adjustRatingForConfidence(3, 'unsure')).toBe(3)
    expect(adjustRatingForConfidence(3, null)).toBe(3)
  })
})

describe('applyRating', () => {
  it('uses the 1 min / 10 min learning steps for a new card', () => {
    const s = newCardSchedule(NOW)
    const again = applyRating(s, 1, NOW, 0.9)
    expect(new Date(again.schedule.due).getTime() - NOW.getTime()).toBe(1 * MIN)
    expect(again.schedule.state).toBe('learning')
    expect(again.log).toEqual({ stateBefore: 'new', scheduledDays: 0, elapsedDays: 0 })

    const good = applyRating(s, 3, NOW, 0.9)
    expect(new Date(good.schedule.due).getTime() - NOW.getTime()).toBe(10 * MIN)
    expect(good.schedule.reps).toBe(1)
    expect(good.schedule.lastReview).toBe(NOW.toISOString())
  })

  it('sends a forgotten review card back within minutes and counts the lapse', () => {
    let s = newCardSchedule(NOW)
    let at = NOW
    for (let i = 0; i < 3; i++) {
      s = applyRating(s, 3, at, 0.9).schedule
      at = new Date(s.due)
    }
    expect(s.state).toBe('review')
    const { schedule, log } = applyRating(s, 1, at, 0.9)
    expect(schedule.state).toBe('relearning')
    expect(schedule.lapses).toBe(1)
    expect(new Date(schedule.due).getTime() - at.getTime()).toBeLessThanOrEqual(10 * MIN)
    expect(log.stateBefore).toBe('review')
    expect(log.elapsedDays).toBeGreaterThan(0)
  })

  it('schedules Good on a review card days ahead', () => {
    let s = newCardSchedule(NOW)
    s = applyRating(s, 3, NOW, 0.9).schedule
    const at = new Date(s.due)
    s = applyRating(s, 3, at, 0.9).schedule
    expect(s.state).toBe('review')
    const next = applyRating(s, 3, new Date(s.due), 0.9)
    expect(next.log.scheduledDays).toBeGreaterThanOrEqual(3)
    expect(new Date(next.schedule.due).getTime() - new Date(s.due).getTime()).toBeGreaterThanOrEqual(3 * DAY)
  })

  it('grows intervals with repeated Good', () => {
    const reviewIntervals = goodIntervals(7).slice(2)
    for (let i = 1; i < reviewIntervals.length; i++) expect(reviewIntervals[i]).toBeGreaterThan(reviewIntervals[i - 1])
    expect(reviewIntervals[reviewIntervals.length - 1]).toBeGreaterThan(30)
  })

  it('gives longer intervals for lower desired retention', () => {
    let s = newCardSchedule(NOW)
    s = applyRating(s, 4, NOW, 0.9).schedule
    const at = new Date(s.due)
    const relaxed = applyRating(s, 3, at, 0.8).schedule
    const strict = applyRating(s, 3, at, 0.97).schedule
    expect(new Date(relaxed.due).getTime()).toBeGreaterThan(new Date(strict.due).getTime())
  })

  it('is deterministic and does not mutate its input', () => {
    const s = newCardSchedule(NOW)
    const copy = { ...s }
    expect(applyRating(s, 3, NOW, 0.9)).toEqual(applyRating(s, 3, NOW, 0.9))
    expect(s).toEqual(copy)
  })
})

describe('previewRatings', () => {
  it('returns one preview per rating matching applyRating exactly', () => {
    let s = newCardSchedule(NOW)
    s = applyRating(s, 4, NOW, 0.9).schedule
    const at = new Date(new Date(s.due).getTime() + 2 * DAY)
    const previews = previewRatings(s, at, 0.9)
    expect(previews.map((p) => p.rating)).toEqual([1, 2, 3, 4])
    for (const p of previews) expect(p.due).toBe(applyRating(s, p.rating, at, 0.9).schedule.due)
    const dues = previews.map((p) => new Date(p.due).getTime())
    expect(dues[0]).toBeLessThan(dues[1])
    expect(dues[2]).toBeLessThan(dues[3])
  })

  it('labels a new card with minutes and days', () => {
    const labels = previewRatings(newCardSchedule(NOW), NOW, 0.9).map((p) => p.intervalLabel)
    expect(labels[0]).toBe('1 min')
    expect(labels[1]).toBe('6 min')
    expect(labels[2]).toBe('10 min')
    expect(labels[3]).toMatch(/days?$/)
  })

  it('clamps out-of-range retention instead of failing', () => {
    expect(previewRatings(newCardSchedule(NOW), NOW, 2)).toHaveLength(4)
    expect(previewRatings(newCardSchedule(NOW), NOW, Number.NaN)).toHaveLength(4)
  })
})

describe('retrievability', () => {
  it('is 0 for new cards', () => {
    expect(retrievability(newCardSchedule(NOW), NOW)).toBe(0)
  })

  it('is near 1 right after a review and decays over time', () => {
    let s = newCardSchedule(NOW)
    s = applyRating(s, 3, NOW, 0.9).schedule
    s = applyRating(s, 3, new Date(s.due), 0.9).schedule
    const reviewedAt = new Date(s.lastReview as string)
    const r0 = retrievability(s, reviewedAt)
    const rDue = retrievability(s, new Date(s.due))
    const rLater = retrievability(s, new Date(reviewedAt.getTime() + 60 * DAY))
    expect(r0).toBeCloseTo(1, 5)
    expect(rDue).toBeGreaterThan(0.85)
    expect(rDue).toBeLessThan(0.95)
    expect(rLater).toBeLessThan(rDue)
    expect(rLater).toBeGreaterThan(0)
  })

  it('never exceeds 1 when now is before the last review', () => {
    const s = applyRating(newCardSchedule(NOW), 3, NOW, 0.9).schedule
    expect(retrievability(s, new Date(NOW.getTime() - DAY))).toBeLessThanOrEqual(1)
  })
})

describe('formatInterval', () => {
  it('uses short units', () => {
    expect(formatInterval(1 * MIN)).toBe('1 min')
    expect(formatInterval(10 * MIN)).toBe('10 min')
    expect(formatInterval(20 * 1000)).toBe('1 min')
    expect(formatInterval(59.6 * MIN)).toBe('1 hr')
    expect(formatInterval(1 * HOUR)).toBe('1 hr')
    expect(formatInterval(5 * HOUR)).toBe('5 hr')
    expect(formatInterval(23.6 * HOUR)).toBe('1 day')
    expect(formatInterval(1 * DAY)).toBe('1 day')
    expect(formatInterval(3 * DAY)).toBe('3 days')
    expect(formatInterval(13 * DAY)).toBe('13 days')
    expect(formatInterval(14 * DAY)).toBe('2 wk')
    expect(formatInterval(59 * DAY)).toBe('8 wk')
    expect(formatInterval(60 * DAY)).toBe('2 mo')
    expect(formatInterval(122 * DAY)).toBe('4 mo')
    expect(formatInterval(365 * DAY)).toBe('1 yr')
    expect(formatInterval(438 * DAY)).toBe('1.2 yr')
  })

  it('says "now" for zero, negative or invalid values', () => {
    expect(formatInterval(0)).toBe('now')
    expect(formatInterval(-5 * MIN)).toBe('now')
    expect(formatInterval(Number.NaN)).toBe('now')
  })
})

describe('forecastDue', () => {
  it('buckets by local day and puts overdue cards on day 0', () => {
    const cards = [
      { due: daysAgo(5).toISOString() },
      { due: new Date(2026, 9, 4, 23, 30).toISOString() },
      { due: new Date(2026, 9, 5, 0, 15).toISOString() },
      { due: new Date(2026, 9, 10, 9).toISOString() },
      { due: new Date(2026, 9, 11, 9).toISOString() },
      { due: 'not a date' }
    ]
    expect(forecastDue(cards, NOW, 7)).toEqual([
      { date: '2026-10-04', due: 2 },
      { date: '2026-10-05', due: 1 },
      { date: '2026-10-06', due: 0 },
      { date: '2026-10-07', due: 0 },
      { date: '2026-10-08', due: 0 },
      { date: '2026-10-09', due: 0 },
      { date: '2026-10-10', due: 1 }
    ])
  })

  it('handles empty input, zero days and month ends', () => {
    expect(forecastDue([], NOW, 3).map((d) => d.due)).toEqual([0, 0, 0])
    expect(forecastDue([{ due: NOW.toISOString() }], NOW, 0)).toEqual([])
    expect(forecastDue([], new Date(2026, 11, 30, 12), 3).map((d) => d.date)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01'])
  })
})

describe('interleaveByNotebook', () => {
  const ids = (items: { id: string }[]): string => items.map((i) => i.id).join(' ')

  it('alternates notebooks and keeps each notebook in its own order', () => {
    const items = [
      { id: 'a1', notebookId: 'A' },
      { id: 'a2', notebookId: 'A' },
      { id: 'a3', notebookId: 'A' },
      { id: 'b1', notebookId: 'B' },
      { id: 'b2', notebookId: 'B' },
      { id: 'b3', notebookId: 'B' }
    ]
    expect(ids(interleaveByNotebook(items))).toBe('a1 b1 a2 b2 a3 b3')
  })

  it('spreads a dominant notebook so no run is avoidable', () => {
    const items = [
      { id: 'b1', notebookId: 'B' },
      ...[1, 2, 3, 4].map((n) => ({ id: `a${n}`, notebookId: 'A' })),
      { id: 'c1', notebookId: 'C' }
    ]
    const result = interleaveByNotebook(items)
    expect(ids(result)).toBe('a1 b1 a2 c1 a3 a4')
    for (const nb of ['A', 'B', 'C']) {
      const own = items.filter((i) => i.notebookId === nb).map((i) => i.id)
      expect(result.filter((i) => i.notebookId === nb).map((i) => i.id)).toEqual(own)
    }
  })

  it('handles empty and single-notebook input and is deterministic', () => {
    expect(interleaveByNotebook([])).toEqual([])
    const single = [
      { id: 'x', notebookId: 'A' },
      { id: 'y', notebookId: 'A' }
    ]
    expect(interleaveByNotebook(single)).toEqual(single)
    const mixed = [
      { id: 'c', notebookId: 'C' },
      { id: 'b', notebookId: 'B' },
      { id: 'a', notebookId: 'A' }
    ]
    expect(ids(interleaveByNotebook(mixed))).toBe('c b a')
    expect(interleaveByNotebook(mixed)).toEqual(interleaveByNotebook(mixed))
  })
})

// ---------------------------------------------------------------------------
// Topic progress
// ---------------------------------------------------------------------------

describe('computeTopicProgress', () => {
  const run = (overrides: Partial<Parameters<typeof computeTopicProgress>[0]> = {}): TopicProgress =>
    computeTopicProgress({ topic: topic(), answers: [], cards: [], reviews: [], now: NOW, ...overrides })

  it('is not_started with zero mastery when there is no data', () => {
    expect(run()).toEqual({
      topicId: 't1',
      state: 'not_started',
      mastery: 0,
      recentAccuracy: null,
      answeredCount: 0,
      missedCount: 0,
      overconfidentCount: 0,
      cardCount: 0,
      dueCards: 0,
      nextReviewAt: null,
      lastPracticedAt: null
    })
  })

  it('is learning while the path is in progress, even with misses', () => {
    const answers = [1, 2, 3, 4].map((n) => answer(false, new Date(NOW.getTime() - n * HOUR), { confidence: 'sure', source: 'check' }))
    const p = run({ topic: topic({ pathStep: 'practice' }), answers })
    expect(p.state).toBe('learning')
    expect(p.overconfidentCount).toBe(4)
  })

  it('is learning, not reviewing, when only a quiz or mock exam touched an unopened topic', () => {
    const answers = [answer(true, daysAgo(1), { source: 'mock_exam' }), answer(false, daysAgo(1), { source: 'mock_exam' })]
    expect(run({ topic: topic({ pathStep: null }), answers }).state).toBe('learning')
    expect(run({ topic: topic({ pathStep: 'done' }), answers }).state).toBe('reviewing')
  })

  it('gives path progress alone only its 10% share', () => {
    expect(run({ topic: topic({ pathStep: 'done' }) }).mastery).toBe(10)
    expect(run({ topic: topic({ pathStep: 'explain' }) }).mastery).toBe(4)
  })

  it('needs 3 data points for accuracy', () => {
    const two = run({ topic: topic({ pathStep: 'done' }), answers: [answer(true, daysAgo(1)), answer(true, daysAgo(2))] })
    expect(two.recentAccuracy).toBeNull()
    expect(two.answeredCount).toBe(2)
    const three = run({ topic: topic({ pathStep: 'done' }), answers: [answer(true, daysAgo(1)), answer(true, daysAgo(2)), answer(false, daysAgo(3))] })
    expect(three.recentAccuracy).not.toBeNull()
  })

  it('weights recent answers more (0.85^rank)', () => {
    const recentRight = [answer(true, daysAgo(1)), answer(false, daysAgo(2)), answer(false, daysAgo(3))]
    const recentWrong = [answer(false, daysAgo(1)), answer(true, daysAgo(2)), answer(true, daysAgo(3))]
    const w = [1, 0.85, 0.85 ** 2]
    const total = w[0] + w[1] + w[2]
    expect(run({ topic: topic({ pathStep: 'done' }), answers: recentRight }).recentAccuracy).toBe(Math.round((100 * w[0]) / total))
    expect(run({ topic: topic({ pathStep: 'done' }), answers: recentWrong }).recentAccuracy).toBe(Math.round((100 * (w[1] + w[2])) / total))
  })

  it('uses only the newest 20 data points for accuracy, but counts all answers', () => {
    const old = Array.from({ length: 10 }, (_, i) => answer(false, daysAgo(40 + i)))
    const recent = Array.from({ length: 20 }, (_, i) => answer(true, daysAgo(1 + i)))
    const p = run({ topic: topic({ pathStep: 'done' }), answers: [...old, ...recent] })
    expect(p.recentAccuracy).toBe(100)
    expect(p.answeredCount).toBe(30)
    expect(p.missedCount).toBe(10)
  })

  it('combines accuracy and path (re-weighted) when there is no memory data', () => {
    const answers = [answer(true, daysAgo(1)), answer(true, daysAgo(2)), answer(true, daysAgo(3))]
    // (0.5 * 1 + 0.1 * 1) / 0.6 = 1
    expect(run({ topic: topic({ pathStep: 'done' }), answers }).mastery).toBe(100)
    // (0.5 * 1 + 0.1 * 0) / 0.6
    expect(run({ answers }).mastery).toBe(Math.round((100 * 0.5) / 0.6))
  })

  it('counts reviews as data points (correct unless rated Again) and uses card memory', () => {
    const reviewed = card({ ...applyRating(newCardSchedule(daysAgo(2)), 3, daysAgo(2), 0.9).schedule, due: daysAgo(-3).toISOString() })
    const reviews = [review(3, daysAgo(2)), review(1, daysAgo(3)), review(4, daysAgo(4))]
    const p = run({ topic: topic({ pathStep: 'done' }), cards: [reviewed], reviews })
    const w = [1, 0.85, 0.85 ** 2]
    const accuracy = (w[0] + w[2]) / (w[0] + w[1] + w[2])
    const memory = retrievability(reviewed, NOW)
    expect(p.recentAccuracy).toBe(Math.round(100 * accuracy))
    expect(p.mastery).toBe(Math.round(100 * (0.5 * accuracy + 0.4 * memory + 0.1)))
    expect(p.answeredCount).toBe(3)
    expect(p.missedCount).toBe(1)
  })

  it('counts a Hard review as recalled, like the answer log and the recall rate do', () => {
    const done = topic({ pathStep: 'done' })
    const hard = [review(2, daysAgo(1)), review(2, daysAgo(2)), review(2, daysAgo(3)), review(2, daysAgo(4))]
    expect(run({ topic: done, cards: [card()], reviews: hard })).toMatchObject({ recentAccuracy: 100, answeredCount: 4, missedCount: 0 })
    const again = hard.map((r) => ({ ...r, rating: 1 as const }))
    expect(run({ topic: done, cards: [card()], reviews: again })).toMatchObject({ recentAccuracy: 0, missedCount: 4, state: 'weak' })
    // Spaced Hard reviews are still recalls, so they prove the topic over time.
    const strong = card({ ...newCardSchedule(NOW), state: 'review', stability: 60, lastReview: daysAgo(1).toISOString(), due: daysAgo(-50).toISOString() })
    const answers = Array.from({ length: 6 }, (_, i) => answer(true, daysAgo(i + 1)))
    expect(run({ topic: done, answers, cards: [strong], reviews: [review(2, daysAgo(1)), review(2, daysAgo(4))] }).state).toBe('mastered')
  })

  it('does not double count a review logged both as answer and review log', () => {
    const at = daysAgo(1)
    const reviews = [review(1, at, { cardId: 'c1' })]
    const answers = [answer(true, at, { source: 'review', cardId: 'c1', questionType: 'recall' })]
    const p = run({ topic: topic({ pathStep: 'done' }), cards: [card()], reviews, answers })
    expect(p.answeredCount).toBe(1)
    expect(p.missedCount).toBe(1)
  })

  it('ignores warm-up guesses for accuracy and overconfidence', () => {
    const warmups = [1, 2, 3, 4].map((n) => answer(false, daysAgo(n), { source: 'warmup', confidence: 'sure' }))
    const p = run({ topic: topic({ pathStep: 'done' }), answers: warmups })
    expect(p.answeredCount).toBe(0)
    expect(p.overconfidentCount).toBe(0)
    expect(p.state).toBe('reviewing')
  })

  it('is weak with >= 4 data points and accuracy below 60%', () => {
    const answers = [answer(false, daysAgo(1)), answer(false, daysAgo(2)), answer(true, daysAgo(3)), answer(true, daysAgo(4))]
    expect(run({ topic: topic({ pathStep: 'done' }), answers }).state).toBe('weak')
    expect(run({ topic: topic({ pathStep: 'done' }), answers: answers.slice(0, 3) }).state).toBe('reviewing')
  })

  it('is weak with 2 overconfident errors in the last 30 days only', () => {
    const correct = Array.from({ length: 8 }, (_, i) => answer(true, daysAgo(i)))
    const recent = [answer(false, daysAgo(2), { confidence: 'sure' }), answer(false, daysAgo(29), { confidence: 'sure' })]
    const old = [answer(false, daysAgo(31), { confidence: 'sure' }), answer(false, daysAgo(40), { confidence: 'sure' })]
    const unsure = [answer(false, daysAgo(3), { confidence: 'unsure' })]
    const done = topic({ pathStep: 'done' })
    expect(run({ topic: done, answers: [...correct, ...recent] })).toMatchObject({ state: 'weak', overconfidentCount: 2 })
    expect(run({ topic: done, answers: [...correct, ...old, ...unsure, recent[0]] })).toMatchObject({ state: 'reviewing', overconfidentCount: 1 })
  })

  it('stops calling a topic weak for overconfident errors once recent answers make up for them', () => {
    const done = topic({ pathStep: 'done' })
    const sureWrong = [answer(false, daysAgo(6), { confidence: 'sure' }), answer(false, daysAgo(6), { confidence: 'sure' })]
    const fewRight = Array.from({ length: 3 }, (_, i) => answer(true, daysAgo(3 - i)))
    const manyRight = Array.from({ length: 6 }, (_, i) => answer(true, daysAgo(5 - i)))
    // Right after the errors, and with only a few right answers since: still weak.
    expect(run({ topic: done, answers: sureWrong }).state).toBe('weak')
    expect(run({ topic: done, answers: [...sureWrong, ...fewRight] })).toMatchObject({ state: 'weak', overconfidentCount: 2 })
    // Six right answers since bring recent accuracy above 85%: no longer weak, though the errors are still reported.
    const fixed = run({ topic: done, answers: [...sureWrong, ...manyRight] })
    expect(fixed.recentAccuracy).toBeGreaterThanOrEqual(85)
    expect(fixed).toMatchObject({ state: 'reviewing', overconfidentCount: 2 })
  })

  it('counts a sure review rated Again as overconfident', () => {
    const done = topic({ pathStep: 'done' })
    const reviews = [review(1, daysAgo(1), { confidence: 'sure' }), review(1, daysAgo(2), { confidence: 'sure' })]
    expect(run({ topic: done, cards: [card()], reviews }).overconfidentCount).toBe(2)
  })

  it('is mastered only after spaced successful reviews', () => {
    const done = topic({ pathStep: 'done' })
    const answers = Array.from({ length: 6 }, (_, i) => answer(true, daysAgo(i + 1)))
    const strong = card({ ...newCardSchedule(NOW), state: 'review', stability: 60, lastReview: daysAgo(1).toISOString(), due: daysAgo(-50).toISOString() })
    const spaced = [review(3, daysAgo(1)), review(3, daysAgo(4))]
    const sameWeek = [review(3, daysAgo(1)), review(3, daysAgo(2))]
    expect(run({ topic: done, answers, cards: [strong], reviews: spaced }).state).toBe('mastered')
    expect(run({ topic: done, answers, cards: [strong], reviews: sameWeek }).state).toBe('reviewing')
    expect(run({ topic: done, answers, cards: [strong], reviews: [review(3, daysAgo(1))] }).state).toBe('reviewing')
  })

  it('reports cards, due counts, next review and last practice', () => {
    const cards = [
      card({ id: 'c1', due: daysAgo(2).toISOString() }),
      card({ id: 'c2', due: NOW.toISOString() }),
      card({ id: 'c3', due: daysAgo(-3).toISOString() }),
      card({ id: 'c4', due: daysAgo(10).toISOString(), suspended: true })
    ]
    const answers = [answer(true, daysAgo(3))]
    const reviews = [review(3, daysAgo(1), { cardId: 'c1' })]
    const p = run({ topic: topic({ pathStep: 'done' }), cards, answers, reviews })
    expect(p.cardCount).toBe(3)
    expect(p.dueCards).toBe(2)
    expect(p.nextReviewAt).toBe(daysAgo(2).toISOString())
    expect(p.lastPracticedAt).toBe(daysAgo(1).toISOString())
  })

  it('does not depend on input order', () => {
    const answers = [answer(true, daysAgo(1)), answer(false, daysAgo(2)), answer(true, daysAgo(3)), answer(false, daysAgo(4))]
    const done = topic({ pathStep: 'done' })
    expect(run({ topic: done, answers })).toEqual(run({ topic: done, answers: [...answers].reverse() }))
  })
})

// ---------------------------------------------------------------------------
// Exams
// ---------------------------------------------------------------------------

describe('examReadiness', () => {
  const topics = [
    topicWithProgress('a', 0, 'reviewing', 80),
    topicWithProgress('b', 1, 'weak', 40),
    topicWithProgress('c', 2, 'not_started', 0),
    topicWithProgress('d', 3, 'learning', 40),
    topicWithProgress('e', 4, 'mastered', 95)
  ]

  it('averages all notebook topics when the exam lists none', () => {
    const r = examReadiness(exam(), topics)
    expect(r.readiness).toBe(Math.round((80 + 40 + 0 + 40 + 95) / 5))
    expect(r.notStartedCount).toBe(1)
    expect(r.weakest).toEqual([
      { topicId: 'b', title: 'Topic b', mastery: 40 },
      { topicId: 'd', title: 'Topic d', mastery: 40 },
      { topicId: 'a', title: 'Topic a', mastery: 80 }
    ])
  })

  it('uses only covered topics', () => {
    const r = examReadiness(exam({ topicIds: ['a', 'e', 'missing'] }), topics)
    expect(r.readiness).toBe(88)
    expect(r.notStartedCount).toBe(0)
    expect(r.weakest.map((w) => w.topicId)).toEqual(['a', 'e'])
  })

  it('is 0 with no covered topics', () => {
    expect(examReadiness(exam(), [])).toEqual({ readiness: 0, weakest: [], notStartedCount: 0 })
  })
})

// ---------------------------------------------------------------------------
// Today plan
// ---------------------------------------------------------------------------

describe('buildTodayPlan', () => {
  it('is empty when there is nothing to do', () => {
    expect(buildTodayPlan(planInput())).toEqual({ date: '2026-10-04', blocks: [], totalMinutes: 0, dueCount: 0 })
  })

  it('builds a review block, most overdue first, interleaved', () => {
    const dueCards = [
      planCard('a-new', 'nb1', new Date(NOW.getTime() - HOUR)),
      planCard('b-old', 'nb2', daysAgo(3)),
      planCard('a-old', 'nb1', daysAgo(5)),
      planCard('a-mid', 'nb1', daysAgo(2))
    ]
    const plan = buildTodayPlan(planInput({ dueCards }))
    expect(plan.dueCount).toBe(4)
    expect(plan.blocks).toHaveLength(1)
    const block = plan.blocks[0]
    expect(block).toMatchObject({
      kind: 'review',
      title: 'Review 4 cards',
      detail: 'Mixed: CS 201, CS 310',
      reason: 'these are about to slip from memory',
      estMinutes: 3,
      notebookIds: ['nb1', 'nb2']
    })
    expect(block.cardIds).toEqual(['a-old', 'b-old', 'a-mid', 'a-new'])
  })

  it('caps reviews at maxReviewsPerDay, keeping the most overdue, and reports the full due count', () => {
    const dueCards = Array.from({ length: 30 }, (_, i) => planCard(`c${String(i).padStart(2, '0')}`, 'nb1', daysAgo(i)))
    const plan = buildTodayPlan(planInput({ dueCards, maxReviewsPerDay: 18 }))
    expect(plan.dueCount).toBe(30)
    const block = plan.blocks[0]
    expect(block.title).toBe('Review 18 cards')
    expect(block.cardIds).toHaveLength(18)
    expect(block.cardIds).not.toContain('c00')
    expect(block.cardIds[0]).toBe('c29')
    expect(block.estMinutes).toBe(12)
    expect(block.detail).toBe('CS 201')
    expect(block.reason).toBe('the 18 most overdue of 30, before they slip from memory')
  })

  it('ignores suspended or not-yet-due cards and uses the name when a notebook has no code', () => {
    const dueCards = [
      planCard('x', 'nb3', daysAgo(1)),
      planCard('s', 'nb3', daysAgo(1), { suspended: true }),
      planCard('f', 'nb3', daysAgo(-1))
    ]
    const plan = buildTodayPlan(planInput({ dueCards }))
    expect(plan.dueCount).toBe(1)
    expect(plan.blocks[0]).toMatchObject({ title: 'Review 1 card', detail: 'Notebook nb3', estMinutes: 1, reason: 'this one is about to slip from memory' })
  })

  it('skips reviews when the cap is 0 but still counts due cards', () => {
    const plan = buildTodayPlan(planInput({ dueCards: [planCard('x', 'nb1', daysAgo(1))], maxReviewsPerDay: 0 }))
    expect(plan.blocks).toEqual([])
    expect(plan.dueCount).toBe(1)
  })

  it('picks up to 3 weak topics, exam-covered first, then lowest mastery', () => {
    const topics = [
      planTopic('w1', 0, 'weak', 20, { title: 'Hash collisions', pathStep: 'done' }),
      planTopic('w2', 1, 'weak', 50, { title: 'Deadlock avoidance', notebookId: 'nb2', notebookCode: 'CS 310', pathStep: 'done' }),
      planTopic('w3', 2, 'weak', 10, { title: 'AVL rotations', pathStep: 'done' }),
      planTopic('w4', 3, 'weak', 55, { title: 'Paging', notebookId: 'nb2', notebookCode: 'CS 310', pathStep: 'done' }),
      planTopic('ok', 4, 'reviewing', 70, { pathStep: 'done' })
    ]
    const exams = [exam({ id: 'q3', notebookId: 'nb2', name: 'Quiz 3', examDate: '2026-10-12', topicIds: ['w2', 'w4'] })]
    const plan = buildTodayPlan(planInput({ topics, exams, newTopicsPerDay: 0 }))
    expect(plan.blocks).toHaveLength(1)
    expect(plan.blocks[0]).toMatchObject({
      kind: 'weak',
      title: 'Fix 3 weak spots',
      detail: 'Deadlock avoidance · Paging · AVL rotations',
      reason: 'you keep missing these, and 2 are on your Oct 12 Quiz 3',
      // Two notebooks: two weak-spot quizzes of 4 questions.
      estMinutes: 8,
      topicIds: ['w2', 'w4', 'w3'],
      notebookIds: ['nb2', 'nb1']
    })
  })

  it('estimates the weak block from the weak-spot quizzes the session will run', () => {
    expect([1, 2, 3, 4].map(weakSpotQuizSize)).toEqual([8, 4, 4, 4])
    const weakIn = (notebookIds: string[]): number =>
      buildTodayPlan(
        planInput({
          topics: notebookIds.map((nb, i) => planTopic(`w${i}`, i, 'weak', 30, { notebookId: nb, pathStep: 'done' })),
          newTopicsPerDay: 0
        })
      ).blocks[0].estMinutes
    // One topic still gets a whole 8-question quiz; three topics of one notebook share it.
    expect(weakIn(['nb1'])).toBe(8)
    expect(weakIn(['nb1', 'nb1', 'nb1'])).toBe(8)
    expect(weakIn(['nb1', 'nb2', 'nb3'])).toBe(12)
  })

  it('words the weak reason for one topic and for several exams', () => {
    const one = buildTodayPlan(planInput({ topics: [planTopic('w', 0, 'weak', 30, { pathStep: 'done' })], newTopicsPerDay: 0 }))
    expect(one.blocks[0]).toMatchObject({ title: 'Fix 1 weak spot', reason: 'you keep missing this one' })

    const topics = [
      planTopic('w1', 0, 'weak', 30, { pathStep: 'done' }),
      planTopic('w2', 0, 'weak', 30, { notebookId: 'nb2', pathStep: 'done' })
    ]
    const exams = [exam({ id: 'e1', notebookId: 'nb1' }), exam({ id: 'e2', notebookId: 'nb2', name: 'Final', examDate: '2026-12-10' })]
    const two = buildTodayPlan(planInput({ topics, exams, newTopicsPerDay: 0 }))
    expect(two.blocks[0].reason).toBe('you keep missing these, and both are on upcoming exams')
  })

  it('learns in-progress topics first, then exam topics in course order, then course order', () => {
    const topics = [
      planTopic('n0', 0, 'not_started', 0),
      planTopic('n1', 1, 'not_started', 0),
      planTopic('x0', 0, 'not_started', 0, { notebookId: 'nb2', notebookCode: 'CS 310', title: 'Processes', unitLabel: '' }),
      planTopic('x1', 1, 'not_started', 0, { notebookId: 'nb2', notebookCode: 'CS 310', title: 'Threads', unitLabel: 'Unit 2' }),
      planTopic('l', 5, 'learning', 30, { pathStep: 'practice', title: 'Heaps', startedAt: daysAgo(2).toISOString() }),
      planTopic('d', 6, 'reviewing', 70, { pathStep: 'done' })
    ]
    const exams = [exam({ notebookId: 'nb2', name: 'Midterm', examDate: '2026-10-12' })]
    const plan = buildTodayPlan(planInput({ topics, exams, newTopicsPerDay: 3 }))
    expect(plan.blocks.map((b) => b.title)).toEqual(['Learn: Heaps', 'Learn: Processes', 'Learn: Threads'])
    expect(plan.blocks[0]).toMatchObject({
      kind: 'learn',
      detail: 'CS 201 · Week 4 · pick up at Practice',
      reason: 'finish what you started',
      estMinutes: 20,
      topicIds: ['l'],
      notebookIds: ['nb1']
    })
    expect(plan.blocks[1]).toMatchObject({ detail: 'CS 310 · topic 1', reason: 'next up before your Oct 12 Midterm' })
    expect(plan.blocks[2].detail).toBe('CS 310 · Unit 2')

    const noExam = buildTodayPlan(planInput({ topics: topics.slice(0, 2), newTopicsPerDay: 1 }))
    expect(noExam.blocks[0]).toMatchObject({ title: 'Learn: Topic n0', reason: 'next on the CS 201 syllabus' })
  })

  it('still offers to teach a topic that only a mock exam has touched', () => {
    const topics = [
      planTopic('done', 0, 'reviewing', 70, { pathStep: 'done' }),
      planTopic('quizzed', 1, 'learning', 40, { pathStep: null, title: 'Tries' })
    ]
    const plan = buildTodayPlan(planInput({ topics, newTopicsPerDay: 1 }))
    expect(plan.blocks.map((b) => b.title)).toEqual(['Learn: Tries'])
    expect(plan.blocks[0].reason).toBe('next on the CS 201 syllabus')
  })

  it('adds a mock exam block only when an exam is within 3 days', () => {
    const topics = [planTopic('a', 0, 'reviewing', 60, { pathStep: 'done' }), planTopic('b', 1, 'reviewing', 80, { pathStep: 'done' })]
    const soon = exam({ name: 'Midterm', examDate: '2026-10-06' })
    const later = exam({ id: 'e2', name: 'Final', examDate: '2026-10-08' })
    const plan = buildTodayPlan(planInput({ topics, exams: [later, soon], newTopicsPerDay: 0 }))
    expect(plan.blocks).toHaveLength(1)
    expect(plan.blocks[0]).toEqual({
      kind: 'exam_prep',
      title: 'Mock exam: Midterm',
      detail: 'CS 201 · 2 topics · 70% ready',
      reason: 'Midterm is in 2 days: rehearse it under exam conditions',
      estMinutes: MOCK_EXAM_MINUTES,
      cardIds: [],
      topicIds: ['a', 'b'],
      notebookIds: ['nb1']
    })
    const today = buildTodayPlan(planInput({ topics, exams: [exam({ examDate: '2026-10-04' })], newTopicsPerDay: 0 }))
    expect(today.blocks[0].reason).toContain('is today')
    const past = buildTodayPlan(planInput({ topics, exams: [exam({ examDate: '2026-10-01' })], newTopicsPerDay: 0 }))
    expect(past.blocks).toEqual([])
  })

  it('orders blocks review, weak, learn, exam_prep and totals the minutes', () => {
    const topics = [
      planTopic('w', 0, 'weak', 30, { pathStep: 'done' }),
      planTopic('n', 1, 'not_started', 0)
    ]
    const plan = buildTodayPlan(
      planInput({
        dueCards: [planCard('c', 'nb1', daysAgo(1))],
        topics,
        exams: [exam({ examDate: '2026-10-05' })],
        newTopicsPerDay: 1
      })
    )
    expect(plan.blocks.map((b) => b.kind)).toEqual(['review', 'weak', 'learn', 'exam_prep'])
    expect(plan.totalMinutes).toBe(1 + 8 + 20 + 60)
    expect(plan.totalMinutes).toBe(planMinutes(plan.blocks))
    expect(plan.blocks[1].reason).toBe("you keep missing this one, and it's on your Oct 5 Midterm")
    expect(plan.blocks[3].reason).toBe('Midterm is tomorrow: rehearse it under exam conditions')
  })

  it('does not plan a weak topic again as a learn topic, and is deterministic', () => {
    const topics = [planTopic('w', 0, 'weak', 30, { pathStep: 'done' }), planTopic('n', 1, 'not_started', 0)]
    const input = planInput({ topics, newTopicsPerDay: 5 })
    const plan = buildTodayPlan(input)
    expect(plan.blocks.map((b) => b.topicIds)).toEqual([['w'], ['n']])
    expect(buildTodayPlan(input)).toEqual(plan)
  })
})

describe('weakTopicReason', () => {
  it('prefers overconfident errors, then a close exam, then misses', () => {
    const p = progress({ state: 'weak', overconfidentCount: 4, missedCount: 6, answeredCount: 14 })
    expect(weakTopicReason(p, { name: 'CS 310 Quiz 3', daysLeft: 4 })).toBe('sure but wrong 4 times')
    expect(weakTopicReason({ ...p, overconfidentCount: 1 }, { name: 'CS 310 Quiz 3', daysLeft: 4 })).toBe('on CS 310 Quiz 3 in 4 days')
    expect(weakTopicReason({ ...p, overconfidentCount: 0 }, { name: 'Final', daysLeft: 1 })).toBe('on Final tomorrow')
    expect(weakTopicReason({ ...p, overconfidentCount: 0 }, { name: 'Final', daysLeft: 0 })).toBe('on Final today')
    expect(weakTopicReason({ ...p, overconfidentCount: 0 }, { name: 'Final', daysLeft: 40 })).toBe('missed 6 of 14')
    expect(weakTopicReason({ ...p, overconfidentCount: 0 }, null)).toBe('missed 6 of 14')
  })

  it('falls back to accuracy, overdue cards, then a generic reason', () => {
    expect(weakTopicReason(progress({ recentAccuracy: 55 }), null)).toBe('55% right lately')
    expect(weakTopicReason(progress({ dueCards: 3 }), null)).toBe('3 cards overdue')
    expect(weakTopicReason(progress(), null)).toBe('needs another pass')
  })
})

// ---------------------------------------------------------------------------
// Calibration and streaks
// ---------------------------------------------------------------------------

describe('calibration', () => {
  it('always returns sure, unsure, guess in order', () => {
    expect(calibration([])).toEqual([
      { confidence: 'sure', answered: 0, correct: 0, accuracy: null },
      { confidence: 'unsure', answered: 0, correct: 0, accuracy: null },
      { confidence: 'guess', answered: 0, correct: 0, accuracy: null }
    ])
  })

  it('computes rounded accuracy per bucket and ignores unrated answers', () => {
    const answers = [
      { confidence: 'sure' as const, correct: true },
      { confidence: 'sure' as const, correct: true },
      { confidence: 'sure' as const, correct: false },
      { confidence: 'guess' as const, correct: false },
      { confidence: null, correct: true }
    ]
    expect(calibration(answers)).toEqual([
      { confidence: 'sure', answered: 3, correct: 2, accuracy: 67 },
      { confidence: 'unsure', answered: 0, correct: 0, accuracy: null },
      { confidence: 'guess', answered: 1, correct: 0, accuracy: 0 }
    ])
  })
})

describe('streakDays', () => {
  it('counts consecutive days ending today', () => {
    expect(streakDays(['2026-10-04', '2026-10-03', '2026-10-02', '2026-09-30'], '2026-10-04')).toBe(3)
  })

  it('ends yesterday when nothing has happened yet today', () => {
    expect(streakDays(['2026-10-03', '2026-10-02'], '2026-10-04')).toBe(2)
  })

  it('is 0 when the last activity was before yesterday', () => {
    expect(streakDays(['2026-10-02'], '2026-10-04')).toBe(0)
    expect(streakDays([], '2026-10-04')).toBe(0)
  })

  it('handles duplicates, any order and month/year boundaries', () => {
    expect(streakDays(['2027-01-01', '2026-12-31', '2027-01-01', '2026-12-30', 'garbage'], '2027-01-01')).toBe(3)
    expect(streakDays(['2026-03-01', '2026-02-28'], '2026-03-01')).toBe(2)
  })
})

describe('reviewPlanLabels', () => {
  const at = (days: number, hour = 9): string => new Date(2026, 9, 4 + days, hour).toISOString()

  it('labels relative days, weeks and months, then dates', () => {
    const result = reviewPlanLabels([at(1), at(3), at(7), at(14), at(30), at(45), at(30 + 30), at(90)], NOW)
    expect(result).toEqual([
      { label: 'Tomorrow', date: '2026-10-05' },
      { label: 'In 3 days', date: '2026-10-07' },
      { label: 'In 1 week', date: '2026-10-11' },
      { label: 'In 2 weeks', date: '2026-10-18' },
      { label: 'In 1 month', date: '2026-11-03' },
      { label: 'In 2 months', date: '2026-11-18' },
      { label: 'In 2 months', date: '2026-12-03' },
      { label: 'Jan 2, 2027', date: '2027-01-02' }
    ])
  })

  it('uses "Nov 3" style beyond 2 months within the same year', () => {
    const now = new Date(2026, 0, 10, 12)
    expect(reviewPlanLabels([new Date(2026, 3, 3, 9).toISOString()], now)).toEqual([{ label: 'Apr 3', date: '2026-04-03' }])
  })

  it('sorts, de-duplicates by day and labels today', () => {
    const result = reviewPlanLabels([at(3, 18), at(0, 15), at(3, 8), 'nope'], NOW)
    expect(result).toEqual([
      { label: 'Today', date: '2026-10-04' },
      { label: 'In 3 days', date: '2026-10-07' }
    ])
    expect(reviewPlanLabels([], NOW)).toEqual([])
  })
})

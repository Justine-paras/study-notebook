import { describe, expect, it } from 'vitest'
import type { Card, Exam, Quiz, Source, TopicProgress, TopicWithProgress } from '@shared/types'
import type { SyllabusResult } from '@shared/api'
import { MOCK_EXAM_MINUTES as PLAN_MOCK_EXAM_MINUTES } from '@shared/learning'
import {
  MOCK_EXAM_DEFAULTS,
  MOCK_EXAM_MINUTES,
  applyOrder,
  cardDueLabel,
  countCards,
  examCoverageLine,
  examCoveredIds,
  examReadiness,
  filterCards,
  isValidDateKey,
  mockAttemptSummary,
  mockExamInput,
  moveId,
  nextReviewLine,
  notePreview,
  pathStepLine,
  sortAttempts,
  sourceMetaLine,
  splitExams,
  syllabusCandidates,
  syllabusSummary,
  topicAction,
  topicOptions,
  topicStatusLine
} from './model'

// Local noon, so calendar math never straddles midnight.
const NOW = new Date(2026, 9, 3, 12, 0, 0)

function progress(patch: Partial<TopicProgress> = {}): TopicProgress {
  return {
    topicId: 't',
    state: 'not_started',
    mastery: 0,
    recentAccuracy: null,
    answeredCount: 0,
    missedCount: 0,
    overconfidentCount: 0,
    cardCount: 0,
    dueCards: 0,
    nextReviewAt: null,
    lastPracticedAt: null,
    ...patch
  }
}

function topic(id: string, patch: Partial<TopicWithProgress> = {}, p: Partial<TopicProgress> = {}): TopicWithProgress {
  return {
    id,
    notebookId: 'nb',
    title: `Topic ${id}`,
    description: '',
    unitLabel: '',
    orderIndex: 0,
    sourceIds: [],
    pathStep: null,
    chunkIndex: 0,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    progress: progress({ topicId: id, ...p }),
    ...patch
  }
}

function exam(patch: Partial<Exam> = {}): Exam {
  return { id: 'e1', notebookId: 'nb', name: 'Midterm', examDate: '2026-10-12', topicIds: [], createdAt: '', ...patch }
}

function card(patch: Partial<Card> = {}): Card {
  return {
    id: 'c',
    notebookId: 'nb',
    topicId: null,
    front: 'What is a heap?',
    back: 'A tree with the heap property',
    origin: 'manual',
    sourceRef: '',
    suspended: false,
    createdAt: '',
    due: new Date(2026, 9, 5, 9).toISOString(),
    stability: 3,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 2,
    learningSteps: 0,
    reps: 2,
    lapses: 0,
    state: 'review',
    lastReview: null,
    ...patch
  }
}

describe('topicAction', () => {
  it('maps every mastery state to the prototype labels', () => {
    expect(topicAction('not_started')).toEqual({ label: 'Learn', emphasis: false })
    expect(topicAction('learning')).toEqual({ label: 'Continue', emphasis: true })
    expect(topicAction('weak')).toEqual({ label: 'Relearn', emphasis: true })
    expect(topicAction('reviewing')).toEqual({ label: 'Review', emphasis: false })
    expect(topicAction('mastered')).toEqual({ label: 'Review', emphasis: false })
  })
})

describe('pathStepLine', () => {
  it('names the step and the lesson part', () => {
    expect(pathStepLine('warmup', 0)).toBe('Step 1 of 5: Warm-up')
    expect(pathStepLine('learn', 0)).toBe('Step 2 of 5: Learn')
    expect(pathStepLine('learn', 2)).toBe('Step 2 of 5: Learn, part 3')
    expect(pathStepLine('remember', 0)).toBe('Step 5 of 5: Remember')
  })
})

describe('nextReviewLine', () => {
  it('prefers due cards, then the next review date', () => {
    expect(nextReviewLine(null, 3, NOW)).toBe('3 cards due now')
    expect(nextReviewLine(new Date(2026, 9, 3, 20).toISOString(), 0, NOW)).toBe('Review due today')
    expect(nextReviewLine(new Date(2026, 9, 4, 8).toISOString(), 0, NOW)).toBe('Review due tomorrow')
    expect(nextReviewLine(new Date(2026, 9, 12, 8).toISOString(), 0, NOW)).toBe('Next review Oct 12')
    expect(nextReviewLine(null, 0, NOW)).toBeNull()
  })
})

describe('topicStatusLine', () => {
  const nextExam = { exam: exam(), topicIds: new Set(['a']) }

  it('flags not-started topics that are on the next exam', () => {
    expect(topicStatusLine(topic('a'), { now: NOW, nextExam })).toBe('On Midterm in 9 days')
    expect(topicStatusLine(topic('b'), { now: NOW, nextExam })).toBe('Not started yet')
    expect(topicStatusLine(topic('a'), { now: NOW, nextExam: null })).toBe('Not started yet')
  })

  it('shows the path step while learning', () => {
    const t = topic('a', { pathStep: 'learn', chunkIndex: 1 }, { state: 'learning' })
    expect(topicStatusLine(t, { now: NOW, nextExam })).toBe('Step 2 of 5: Learn, part 2')
  })

  it('counts quiz answers on a topic whose lesson was never opened', () => {
    const quizzed = topic('a', {}, { state: 'learning', answeredCount: 3, missedCount: 1 })
    expect(topicStatusLine(quizzed, { now: NOW, nextExam })).toBe('2 of 3 right so far · On Midterm in 9 days')
    const carded = topic('b', {}, { state: 'learning', cardCount: 2 })
    expect(topicStatusLine(carded, { now: NOW, nextExam })).toBe('Lesson not opened yet')
  })

  it('explains why a topic is weak', () => {
    const t = topic('a', { pathStep: 'done' }, { state: 'weak', answeredCount: 17, missedCount: 9, overconfidentCount: 2, dueCards: 1 })
    expect(topicStatusLine(t, { now: NOW, nextExam })).toBe('Missed 9 of 17 · sure but wrong 2 times · review today')
    const quiet = topic('b', { pathStep: 'done' }, { state: 'weak', answeredCount: 5, missedCount: 3 })
    expect(topicStatusLine(quiet, { now: NOW, nextExam })).toBe('Missed 3 of 5 · worth relearning')
  })

  it('shows the next review for learned topics', () => {
    const t = topic('a', { pathStep: 'done' }, { state: 'reviewing', nextReviewAt: new Date(2026, 9, 4, 9).toISOString() })
    expect(topicStatusLine(t, { now: NOW, nextExam })).toBe('Review due tomorrow')
    const none = topic('b', { pathStep: 'done' }, { state: 'mastered' })
    expect(topicStatusLine(none, { now: NOW, nextExam })).toBe('No reviews scheduled')
  })
})

describe('moveId and applyOrder', () => {
  it('swaps with the neighbour and refuses to move past the ends', () => {
    expect(moveId(['a', 'b', 'c'], 'b', 'up')).toEqual(['b', 'a', 'c'])
    expect(moveId(['a', 'b', 'c'], 'b', 'down')).toEqual(['a', 'c', 'b'])
    expect(moveId(['a', 'b', 'c'], 'a', 'up')).toBeNull()
    expect(moveId(['a', 'b', 'c'], 'c', 'down')).toBeNull()
    expect(moveId(['a'], 'x', 'down')).toBeNull()
  })

  it('reorders items by id and keeps unknown ones at the end', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'z' }, { id: 'c' }]
    expect(applyOrder(items, ['c', 'a', 'b']).map((i) => i.id)).toEqual(['c', 'a', 'b', 'z'])
  })
})

describe('topicOptions', () => {
  it('lists topics in course order with their unit label', () => {
    const options = topicOptions([
      topic('b', { title: 'Heaps', orderIndex: 2 }),
      topic('a', { title: 'Big-O', unitLabel: 'Week 1', orderIndex: 1 })
    ])
    expect(options).toEqual([
      { value: 'a', label: 'Week 1 · Big-O' },
      { value: 'b', label: 'Heaps' }
    ])
  })
})

describe('exams', () => {
  const topics = [topic('a', {}, { mastery: 80 }), topic('b', {}, { mastery: 40 }), topic('c', {}, { mastery: 0 })]

  it('treats an empty topic list as every topic', () => {
    expect([...examCoveredIds(exam(), topics)]).toEqual(['a', 'b', 'c'])
    expect(examCoverageLine(exam(), topics)).toBe('Covers all topics')
    expect(examReadiness(exam(), topics)).toBe(40)
  })

  it('ignores deleted topics', () => {
    const e = exam({ topicIds: ['a', 'b', 'gone'] })
    expect([...examCoveredIds(e, topics)]).toEqual(['a', 'b'])
    expect(examCoverageLine(e, topics)).toBe('Covers 2 topics')
    expect(examReadiness(e, topics)).toBe(60)
    expect(examReadiness(exam({ topicIds: ['gone'] }), topics)).toBeNull()
  })

  it('splits upcoming (today included) from past exams', () => {
    const { upcoming, past } = splitExams(
      [
        exam({ id: 'late', examDate: '2026-11-01' }),
        exam({ id: 'today', examDate: '2026-10-03' }),
        exam({ id: 'old', examDate: '2026-09-01' }),
        exam({ id: 'older', examDate: '2026-08-01' })
      ],
      NOW
    )
    expect(upcoming.map((e) => e.id)).toEqual(['today', 'late'])
    expect(past.map((e) => e.id)).toEqual(['old', 'older'])
  })

  it('validates calendar dates', () => {
    expect(isValidDateKey('2026-10-12')).toBe(true)
    expect(isValidDateKey('2026-02-30')).toBe(false)
    expect(isValidDateKey('12/10/2026')).toBe(false)
    expect(isValidDateKey('')).toBe(false)
  })
})

describe('mockExamInput', () => {
  it('builds the agreed mock exam settings from the exam', () => {
    const input = mockExamInput('nb', exam({ topicIds: ['a', 'b'] }), 30, 60)
    expect(input).toEqual({
      notebookId: 'nb',
      topicId: null,
      kind: 'mock_exam',
      settings: {
        types: ['mc', 'tf', 'fill', 'identification'],
        count: 30,
        difficulty: 'mixed',
        timeLimitMin: 60,
        focusWeak: true,
        interleave: false
      },
      topicIds: ['a', 'b'],
      title: 'Mock exam: Midterm'
    })
  })

  it("defaults to the length Today's plan budgets, and offers it as a choice", () => {
    expect(MOCK_EXAM_DEFAULTS.timeLimitMin).toBe(PLAN_MOCK_EXAM_MINUTES)
    expect(MOCK_EXAM_MINUTES).toContain(MOCK_EXAM_DEFAULTS.timeLimitMin)
  })

  it('covers every topic without an exam', () => {
    const input = mockExamInput('nb', null, 20, 45)
    expect(input.topicIds).toEqual([])
    expect(input.title).toBe('Mock exam')
    expect(input.settings.count).toBe(20)
    expect(input.settings.timeLimitMin).toBe(45)
  })
})

describe('mock attempts', () => {
  const base: Quiz = {
    id: 'q',
    notebookId: 'nb',
    topicId: null,
    kind: 'mock_exam',
    title: 'Mock',
    settings: { types: ['mc'], count: 2, difficulty: 'mixed', focusWeak: true, interleave: false, timeLimitMin: 60 },
    questions: [],
    createdAt: new Date(2026, 8, 20, 10).toISOString(),
    startedAt: null,
    submittedAt: null,
    answers: [],
    score: null
  }
  const questions = Array.from({ length: 40 }, (_, i) => ({
    id: `q${i}`,
    type: 'mc' as const,
    prompt: '',
    options: [],
    answer: '',
    acceptable: [],
    explanation: '',
    topicId: null,
    difficulty: 'easy' as const,
    sourceRef: ''
  }))

  it('summarises submitted, started and untouched attempts', () => {
    expect(mockAttemptSummary({ ...base, questions, submittedAt: new Date(2026, 8, 28, 10).toISOString(), score: 31 }, NOW)).toEqual({
      score: '31/40',
      percent: 78,
      when: 'Sep 28',
      status: 'submitted'
    })
    expect(mockAttemptSummary({ ...base, startedAt: new Date(2026, 8, 28, 10).toISOString() }, NOW).status).toBe('in_progress')
    expect(mockAttemptSummary(base, NOW)).toMatchObject({ status: 'not_started', when: 'Made Sep 20' })
  })

  it('sorts newest first', () => {
    const a = { ...base, id: 'a', createdAt: '2026-09-01T00:00:00.000Z' }
    const b = { ...base, id: 'b', createdAt: '2026-09-21T00:00:00.000Z' }
    expect(sortAttempts([a, b]).map((q) => q.id)).toEqual(['b', 'a'])
  })
})

describe('sources and syllabus', () => {
  const source = (patch: Partial<Source>): Source => ({
    id: 's',
    notebookId: 'nb',
    fileName: 'file.pdf',
    ext: 'pdf',
    kind: 'lecture',
    sizeBytes: 2048,
    storedPath: '',
    status: 'ready',
    error: null,
    charCount: 10,
    pageCount: 12,
    summary: null,
    addedAt: '',
    ...patch
  })

  it('describes the size of a file', () => {
    expect(sourceMetaLine(source({}))).toBe('12 pages · 2 KB')
    expect(sourceMetaLine(source({ ext: 'pptx', pageCount: 1 }))).toBe('1 slide · 2 KB')
    expect(sourceMetaLine(source({ pageCount: null }))).toBe('2 KB')
  })

  it('offers ready syllabus files, or any ready file when asked', () => {
    const sources = [
      source({ id: 'syl', kind: 'syllabus' }),
      source({ id: 'broken', kind: 'syllabus', status: 'error' }),
      source({ id: 'lec' })
    ]
    expect(syllabusCandidates(sources).map((s) => s.id)).toEqual(['syl'])
    expect(syllabusCandidates(sources, true).map((s) => s.id)).toEqual(['syl'])
    const noSyllabus = [source({ id: 'lec' }), source({ id: 'x', status: 'processing' })]
    expect(syllabusCandidates(noSyllabus)).toEqual([])
    expect(syllabusCandidates(noSyllabus, true).map((s) => s.id)).toEqual(['lec'])
  })

  it('summarises what the syllabus added', () => {
    const result = (topics: number, exams: number, skipped: number): SyllabusResult => ({
      topicsAdded: Array.from({ length: topics }, (_, i) => topic(`t${i}`)),
      examsAdded: Array.from({ length: exams }, (_, i) => exam({ id: `e${i}` })),
      topicsSkipped: Array.from({ length: skipped }, (_, i) => `Skipped ${i}`)
    })
    expect(syllabusSummary(result(12, 2, 0), 'DSA Syllabus.pdf')).toEqual({
      tone: 'good',
      title: 'Topics added',
      message: 'Added 12 topics and 2 exam dates from DSA Syllabus.pdf.'
    })
    expect(syllabusSummary(result(1, 0, 3), 'S.pdf').message).toBe(
      'Added 1 topic from S.pdf. 3 topics were already here and were kept as they were.'
    )
    expect(syllabusSummary(result(0, 0, 1), 'S.pdf')).toEqual({
      tone: 'info',
      title: 'No new topics',
      message: 'Nothing new was found in S.pdf. 1 topic was already here and was kept as it was.'
    })
  })
})

describe('notePreview', () => {
  it('shows the first line of text without Markdown symbols', () => {
    expect(notePreview('# Deadlocks\n\nFour conditions')).toBe('Deadlocks')
    expect(notePreview('\n\n- **Hold** and `wait`')).toBe('Hold and wait')
    expect(notePreview('See [the slides](https://x.y) first')).toBe('See the slides first')
    expect(notePreview('')).toBe('')
    expect(notePreview('a'.repeat(200), 10)).toBe('aaaaaaaaa…')
  })
})

describe('cards', () => {
  const cards = [
    card({ id: 'due', topicId: 't1', due: new Date(2026, 9, 2).toISOString() }),
    card({ id: 'new', topicId: 't2', state: 'new', front: 'Define recursion' }),
    card({ id: 'later', topicId: null, stability: 30 }),
    card({ id: 'off', topicId: 't1', suspended: true, due: new Date(2026, 9, 1).toISOString() })
  ]

  it('filters by topic, status and text', () => {
    const ids = (f: Parameters<typeof filterCards>[1]) => filterCards(cards, f, NOW).map((c) => c.id)
    expect(ids({ query: '', topic: 'all', status: 'all' })).toEqual(['due', 'new', 'later', 'off'])
    expect(ids({ query: '', topic: 't1', status: 'all' })).toEqual(['due', 'off'])
    expect(ids({ query: '', topic: 'none', status: 'all' })).toEqual(['later'])
    expect(ids({ query: '', topic: 'all', status: 'due' })).toEqual(['due'])
    expect(ids({ query: '', topic: 'all', status: 'new' })).toEqual(['new'])
    expect(ids({ query: '', topic: 'all', status: 'suspended' })).toEqual(['off'])
    expect(ids({ query: '  RECURSION ', topic: 'all', status: 'all' })).toEqual(['new'])
    expect(ids({ query: 'heap property', topic: 'all', status: 'all' })).toEqual(['due', 'new', 'later', 'off'])
    expect(ids({ query: 'what is', topic: 't1', status: 'all' })).toEqual(['due', 'off'])
  })

  it('counts cards, leaving suspended ones out of due', () => {
    expect(countCards(cards, NOW)).toEqual({ total: 4, due: 1, fresh: 1, suspended: 1, longTerm: 1 })
  })

  it('labels when a card is due', () => {
    expect(cardDueLabel(cards[0]!, NOW)).toBe('Due now')
    expect(cardDueLabel(cards[1]!, NOW)).toBe('New')
    expect(cardDueLabel(cards[2]!, NOW)).toBe('Due in 2 days')
    expect(cardDueLabel(cards[3]!, NOW)).toBe('Suspended')
    expect(cardDueLabel(card({ due: new Date(2026, 9, 3, 20).toISOString() }), NOW)).toBe('Due later today')
  })
})

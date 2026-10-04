import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AnswerRecord, Card, Exam, LessonContent, Note, Notebook, Quiz, ReviewLog, Source, Topic } from '@shared/types'
import { openDatabase } from '../database'
import { lastStudiedByNotebook } from './activity'
import { insertAnswer, listRecentMistakes, listTopicAnswers } from './answers'
import { countDueCardsByNotebook, countLongTermCards, findCard, findCards, insertCard, listDueCards, updateCardRow } from './cards'
import { insertExam, listExamRows, listUpcomingExamRows } from './exams'
import { insertFocusSession, listFocusSessionsSince } from './focusSessions'
import { findLessonByTopic, upsertLesson } from './lessons'
import { findNotebook, insertNotebook, listNotebookRows, updateNotebookRow, deleteNotebookRow } from './notebooks'
import { findTopicNoteByKind, insertNote, listNoteRows } from './notes'
import { findQuizRecord, insertQuiz, recentQuizPrompts, updateQuizProgress } from './quizzes'
import { insertReviewLog, listReviewLogs } from './reviewLogs'
import { deleteSetting, readSetting, readSettingRows, writeSetting } from './settings'
import { findSource, getSourceTextRow, insertSource, listReadySourceTexts, listSourceRows, setSourceText, updateSourceRow } from './sources'
import { deleteTopicRow, findTopic, insertTopic, listTopicRows, nextTopicOrderIndex, updateTopicRow } from './topics'

let db: DatabaseSync

beforeEach(() => {
  db = openDatabase(':memory:')
})
afterEach(() => {
  db.close()
})

function notebook(id: string, overrides: Partial<Notebook> = {}): Notebook {
  return { id, name: `Notebook ${id}`, code: 'CS 201', color: 'blue', createdAt: '2026-10-01T10:00:00.000Z', archived: false, ...overrides }
}

function topic(id: string, notebookId: string, orderIndex: number, overrides: Partial<Topic> = {}): Topic {
  return {
    id,
    notebookId,
    title: `Topic ${id}`,
    description: 'desc',
    unitLabel: 'Week 1',
    orderIndex,
    sourceIds: [],
    pathStep: null,
    chunkIndex: 0,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    ...overrides
  }
}

function card(id: string, notebookId: string, topicId: string | null, overrides: Partial<Card> = {}): Card {
  return {
    id,
    notebookId,
    topicId,
    front: `Front ${id}`,
    back: `Back ${id}`,
    origin: 'lesson',
    sourceRef: 'Lecture 1.pdf, page 2',
    suspended: false,
    createdAt: '2026-10-01T10:00:00.000Z',
    due: '2026-10-02T00:00:00.000Z',
    stability: 1.5,
    difficulty: 5.2,
    elapsedDays: 0,
    scheduledDays: 1,
    learningSteps: 0,
    reps: 1,
    lapses: 0,
    state: 'review',
    lastReview: null,
    ...overrides
  }
}

function answer(id: string, notebookId: string, topicId: string | null, overrides: Partial<AnswerRecord> = {}): AnswerRecord {
  return {
    id,
    notebookId,
    topicId,
    quizId: null,
    cardId: null,
    source: 'warmup',
    questionType: 'mc',
    prompt: `Prompt ${id}`,
    userAnswer: 'a',
    correctAnswer: 'b',
    correct: false,
    confidence: 'sure',
    answeredAt: '2026-10-02T10:00:00.000Z',
    ...overrides
  }
}

describe('notebooks', () => {
  it('round-trips, orders active before archived, updates and deletes', () => {
    insertNotebook(db, notebook('b', { createdAt: '2026-10-02T00:00:00.000Z' }))
    insertNotebook(db, notebook('a', { archived: true }))
    insertNotebook(db, notebook('c', { createdAt: '2026-09-01T00:00:00.000Z' }))
    expect(listNotebookRows(db).map((n) => n.id)).toEqual(['c', 'b', 'a'])
    expect(findNotebook(db, 'a')).toEqual(notebook('a', { archived: true }))

    updateNotebookRow(db, { ...notebook('a'), name: 'Renamed', archived: false, color: 'teal' })
    expect(findNotebook(db, 'a')).toMatchObject({ name: 'Renamed', archived: false, color: 'teal' })
    expect(deleteNotebookRow(db, 'a')).toBe(true)
    expect(deleteNotebookRow(db, 'a')).toBe(false)
    expect(findNotebook(db, 'missing')).toBeNull()
  })

  it('cascades a notebook delete to everything inside it', () => {
    insertNotebook(db, notebook('n'))
    insertTopic(db, topic('t', 'n', 0))
    insertCard(db, card('c', 'n', 't'))
    insertAnswer(db, answer('a', 'n', 't'))
    deleteNotebookRow(db, 'n')
    for (const table of ['topics', 'cards', 'answers']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 })
    }
  })
})

describe('sources', () => {
  const base: Source = {
    id: 's1',
    notebookId: 'n',
    fileName: 'Lecture 1.pdf',
    ext: 'pdf',
    kind: 'lecture',
    sizeBytes: 1234,
    storedPath: '/lib/n/Lecture 1.pdf',
    status: 'processing',
    error: null,
    charCount: 0,
    pageCount: null,
    summary: null,
    addedAt: '2026-10-01T10:00:00.000Z'
  }

  it('keeps text separate from metadata', () => {
    insertNotebook(db, notebook('n'))
    insertSource(db, base)
    expect(findSource(db, 's1')).toEqual(base)
    setSourceText(db, 's1', '[Page 1]\nhello')
    updateSourceRow(db, { ...base, status: 'ready', charCount: 14, pageCount: 1 })
    expect(getSourceTextRow(db, 's1')).toBe('[Page 1]\nhello')
    expect(listSourceRows(db, 'n')[0]).toMatchObject({ status: 'ready', charCount: 14, pageCount: 1 })
    expect(listReadySourceTexts(db, 'n')).toEqual([{ id: 's1', notebookId: 'n', fileName: 'Lecture 1.pdf', kind: 'lecture', text: '[Page 1]\nhello' }])
    expect(getSourceTextRow(db, 'missing')).toBeNull()
  })
})

describe('topics', () => {
  it('round-trips JSON source ids and orders by order index', () => {
    insertNotebook(db, notebook('n'))
    expect(nextTopicOrderIndex(db, 'n')).toBe(0)
    insertTopic(db, topic('t2', 'n', 1, { sourceIds: ['s1', 's2'], pathStep: 'learn', chunkIndex: 2 }))
    insertTopic(db, topic('t1', 'n', 0))
    expect(nextTopicOrderIndex(db, 'n')).toBe(2)
    expect(listTopicRows(db, 'n').map((t) => t.id)).toEqual(['t1', 't2'])
    expect(findTopic(db, 't2')).toEqual(topic('t2', 'n', 1, { sourceIds: ['s1', 's2'], pathStep: 'learn', chunkIndex: 2 }))
    updateTopicRow(db, { ...topic('t2', 'n', 1), pathStep: 'done', completedAt: '2026-10-03T00:00:00.000Z' })
    expect(findTopic(db, 't2')).toMatchObject({ pathStep: 'done', completedAt: '2026-10-03T00:00:00.000Z', sourceIds: [] })
  })

  it('keeps cards and answers when a topic is deleted, unlinking them', () => {
    insertNotebook(db, notebook('n'))
    insertTopic(db, topic('t', 'n', 0))
    insertCard(db, card('c', 'n', 't'))
    insertAnswer(db, answer('a', 'n', 't'))
    upsertLesson(db, { id: 'l', topicId: 't', content: {} as LessonContent, createdAt: '2026-10-01T00:00:00.000Z' })
    deleteTopicRow(db, 't')
    expect(findCard(db, 'c')?.topicId).toBeNull()
    expect(listTopicAnswers(db, 'n')).toEqual([])
    expect(findLessonByTopic(db, 't')).toBeNull()
  })
})

describe('lessons', () => {
  it('keeps one lesson per topic', () => {
    insertNotebook(db, notebook('n'))
    insertTopic(db, topic('t', 'n', 0))
    const content = { title: 'One', sourcesUsed: ['a.pdf'] } as LessonContent
    upsertLesson(db, { id: 'l1', topicId: 't', content, createdAt: '2026-10-01T00:00:00.000Z' })
    upsertLesson(db, { id: 'l2', topicId: 't', content: { ...content, title: 'Two' }, createdAt: '2026-10-02T00:00:00.000Z' })
    expect(findLessonByTopic(db, 't')).toEqual({ id: 'l2', topicId: 't', content: { ...content, title: 'Two' }, createdAt: '2026-10-02T00:00:00.000Z' })
    expect(db.prepare('SELECT COUNT(*) AS n FROM lessons').get()).toEqual({ n: 1 })
  })
})

describe('quizzes', () => {
  it('round-trips questions, settings and answers and tracks created cards', () => {
    insertNotebook(db, notebook('n'))
    const quiz: Quiz = {
      id: 'q',
      notebookId: 'n',
      topicId: null,
      kind: 'mock_exam',
      title: 'Mock exam: Midterm',
      settings: { types: ['mc', 'tf'], count: 2, difficulty: 'mixed', focusWeak: true, interleave: false, timeLimitMin: 30 },
      questions: [
        {
          id: 'q1',
          type: 'tf',
          prompt: 'Is it?',
          options: ['True', 'False'],
          answer: 'True',
          acceptable: [],
          explanation: 'Because.',
          topicId: null,
          difficulty: 'easy',
          sourceRef: ''
        }
      ],
      createdAt: '2026-10-01T00:00:00.000Z',
      startedAt: null,
      submittedAt: null,
      answers: [],
      score: null
    }
    insertQuiz(db, quiz)
    expect(findQuizRecord(db, 'q')).toEqual({ quiz, cardsCreated: 0 })
    const submitted = { ...quiz, answers: [{ questionId: 'q1', response: 'True', confidence: 'sure' as const, correct: true }], score: 1, submittedAt: '2026-10-01T01:00:00.000Z' }
    updateQuizProgress(db, submitted, 3)
    expect(findQuizRecord(db, 'q')).toEqual({ quiz: submitted, cardsCreated: 3 })
    updateQuizProgress(db, submitted)
    expect(findQuizRecord(db, 'q')?.cardsCreated).toBe(3)
    expect(recentQuizPrompts(db, 'n', 5)).toEqual(['Is it?'])
  })
})

describe('cards and reviews', () => {
  beforeEach(() => {
    insertNotebook(db, notebook('n'))
    insertNotebook(db, notebook('archived', { archived: true }))
    insertTopic(db, topic('t', 'n', 0))
  })

  it('round-trips the full schedule and booleans', () => {
    const c = card('c', 'n', 't', { suspended: true, lastReview: '2026-10-01T09:00:00.000Z', state: 'relearning', lapses: 2 })
    insertCard(db, c)
    expect(findCard(db, 'c')).toEqual(c)
    updateCardRow(db, { ...c, suspended: false, stability: 30 })
    expect(findCard(db, 'c')).toMatchObject({ suspended: false, stability: 30 })
    expect(findCards(db, ['c', 'missing']).map((x) => x.id)).toEqual(['c'])
    expect(findCards(db, [])).toEqual([])
  })

  it('lists due cards most overdue first, skipping suspended and archived', () => {
    insertCard(db, card('late', 'n', 't', { due: '2026-09-01T00:00:00.000Z' }))
    insertCard(db, card('later', 'n', 't', { due: '2026-09-15T00:00:00.000Z', stability: 40 }))
    insertCard(db, card('future', 'n', 't', { due: '2026-12-01T00:00:00.000Z' }))
    insertCard(db, card('suspended', 'n', 't', { due: '2026-09-01T00:00:00.000Z', suspended: true }))
    insertCard(db, card('archived', 'archived', null, { due: '2026-09-01T00:00:00.000Z' }))
    const now = '2026-10-04T00:00:00.000Z'
    expect(listDueCards(db, now).map((c) => c.id)).toEqual(['late', 'later'])
    expect(listDueCards(db, now, 'archived').map((c) => c.id)).toEqual(['archived'])
    expect(countDueCardsByNotebook(db, now).get('n')).toBe(2)
    expect(countLongTermCards(db, 21)).toBe(1)
  })

  it('stores review logs per notebook', () => {
    insertCard(db, card('c', 'n', 't'))
    const log: ReviewLog = {
      id: 'r',
      cardId: 'c',
      rating: 3,
      confidence: null,
      stateBefore: 'new',
      scheduledDays: 1,
      elapsedDays: 0,
      reviewedAt: '2026-10-03T10:00:00.000Z'
    }
    insertReviewLog(db, log, 'n')
    expect(listReviewLogs(db, 'n')).toEqual([log])
    expect(listReviewLogs(db, null)).toEqual([log])
  })
})

describe('answers', () => {
  it('maps booleans and nullable links and lists recent mistakes newest first', () => {
    insertNotebook(db, notebook('n'))
    insertTopic(db, topic('t', 'n', 0))
    const wrongOld = answer('a1', 'n', 't', { answeredAt: '2026-10-01T00:00:00.000Z' })
    const right = answer('a2', 'n', 't', { correct: true, confidence: null, answeredAt: '2026-10-02T00:00:00.000Z' })
    const wrongNew = answer('a3', 'n', null, { source: 'review', questionType: 'recall', answeredAt: '2026-10-03T00:00:00.000Z' })
    for (const a of [wrongOld, right, wrongNew]) insertAnswer(db, a)
    expect(listTopicAnswers(db, 'n')).toEqual([wrongOld, right])
    expect(listRecentMistakes(db, 10).map((a) => a.id)).toEqual(['a3', 'a1'])
  })
})

describe('notes, exams, focus, settings, activity', () => {
  beforeEach(() => {
    insertNotebook(db, notebook('n'))
    insertTopic(db, topic('t', 'n', 0))
  })

  it('notes: newest edit first and lookup by kind', () => {
    const note = (id: string, updatedAt: string, kind: Note['kind'] = 'note'): Note => ({
      id,
      notebookId: 'n',
      topicId: 't',
      sourceId: null,
      kind,
      title: id,
      body: 'b',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt
    })
    insertNote(db, note('old', '2026-10-01T00:00:00.000Z'))
    insertNote(db, note('new', '2026-10-03T00:00:00.000Z', 'explanation'))
    expect(listNoteRows(db, 'n').map((n) => n.id)).toEqual(['new', 'old'])
    expect(findTopicNoteByKind(db, 't', 'explanation')?.id).toBe('new')
  })

  it('exams: sorted by date, upcoming filter and JSON topic ids', () => {
    const exam = (id: string, examDate: string): Exam => ({ id, notebookId: 'n', name: id, examDate, topicIds: ['t'], createdAt: '2026-10-01T00:00:00.000Z' })
    insertExam(db, exam('final', '2026-12-10'))
    insertExam(db, exam('past', '2026-09-01'))
    insertExam(db, exam('midterm', '2026-10-20'))
    expect(listExamRows(db, 'n').map((e) => e.id)).toEqual(['past', 'midterm', 'final'])
    expect(listUpcomingExamRows(db, '2026-10-04').map((e) => e.id)).toEqual(['midterm', 'final'])
    expect(listExamRows(db)[0].topicIds).toEqual(['t'])
  })

  it('focus sessions and last-studied times', () => {
    insertFocusSession(db, { id: 'f1', notebookId: 'n', kind: 'focus', startedAt: '2026-10-03T09:00:00.000Z', endedAt: '2026-10-03T09:25:00.000Z', minutes: 25 })
    insertFocusSession(db, { id: 'f2', notebookId: null, kind: 'break', startedAt: '2026-10-03T09:25:00.000Z', endedAt: '2026-10-03T09:30:00.000Z', minutes: 5 })
    expect(listFocusSessionsSince(db, '2026-10-01T00:00:00.000Z', 'focus').map((s) => s.id)).toEqual(['f1'])
    expect(listFocusSessionsSince(db, '2026-10-01T00:00:00.000Z')).toHaveLength(2)
    insertAnswer(db, answer('a', 'n', 't', { answeredAt: '2026-10-02T00:00:00.000Z' }))
    expect(lastStudiedByNotebook(db).get('n')).toBe('2026-10-03T09:25:00.000Z')
  })

  it('settings: JSON values with upsert and delete', () => {
    writeSetting(db, 'focusMinutes', 30)
    writeSetting(db, 'focusMinutes', 45)
    writeSetting(db, 'theme', 'dark')
    expect(readSetting(db, 'focusMinutes')).toBe(45)
    expect(readSettingRows(db)).toEqual(new Map<string, unknown>([['focusMinutes', 45], ['theme', 'dark']]))
    deleteSetting(db, 'theme')
    expect(readSetting(db, 'theme')).toBeUndefined()
    db.prepare("INSERT INTO settings (key, value) VALUES ('broken', '{')").run()
    expect(readSettingRows(db).has('broken')).toBe(false)
  })
})

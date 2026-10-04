import { describe, expect, it } from 'vitest'
import type { Question, Quiz, QuizAnswer } from '@shared/types'
import {
  answerFeedback,
  countAnswered,
  DEFAULT_PRACTICE_SETTINGS,
  describeQuestionNumbers,
  draftsFromQuiz,
  examDeadline,
  isAnswered,
  isChoiceQuestion,
  latestTopicQuiz,
  missingConfidenceCount,
  navigatorItems,
  navigatorLabel,
  optionHotkeys,
  optionIndexForKey,
  optionLetter,
  questionTopicLabel,
  remainingMs,
  sameDraft,
  scoreKicker,
  scorePercent,
  timerAnnouncement,
  timerTone,
  unansweredNumbers
} from './quizModel'

function question(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    type: 'mc',
    prompt: `Prompt ${id}`,
    options: ['O(1)', 'O(log n)', 'O(n)'],
    answer: 'O(n)',
    acceptable: [],
    explanation: '',
    topicId: 't1',
    difficulty: 'medium',
    sourceRef: '',
    ...overrides
  }
}

function quiz(overrides: Partial<Quiz> = {}): Quiz {
  return {
    id: 'q',
    notebookId: 'n',
    topicId: 't1',
    kind: 'practice',
    title: 'Practice',
    settings: DEFAULT_PRACTICE_SETTINGS,
    questions: [],
    createdAt: '2026-10-04T10:00:00.000Z',
    startedAt: null,
    submittedAt: null,
    answers: [],
    score: null,
    ...overrides
  }
}

describe('options', () => {
  it('letters options A, B, C', () => {
    expect([0, 1, 2, 3].map(optionLetter)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('maps 1-5 and a-e to option indexes within range', () => {
    expect(optionIndexForKey('1', 4)).toBe(0)
    expect(optionIndexForKey('4', 4)).toBe(3)
    expect(optionIndexForKey('5', 4)).toBeNull()
    expect(optionIndexForKey('b', 2)).toBe(1)
    expect(optionIndexForKey('B', 2)).toBe(1)
    expect(optionIndexForKey('c', 2)).toBeNull()
    expect(optionIndexForKey('6', 8)).toBeNull()
    expect(optionIndexForKey('enter', 4)).toBeNull()
  })

  it('builds one hotkey per option, up to five', () => {
    expect(optionHotkeys(2)).toEqual(['1, a', '2, b'])
    expect(optionHotkeys(7)).toHaveLength(5)
  })

  it('treats mc/tf with options as choice questions', () => {
    expect(isChoiceQuestion(question('a'))).toBe(true)
    expect(isChoiceQuestion(question('a', { type: 'tf', options: ['True', 'False'] }))).toBe(true)
    expect(isChoiceQuestion(question('a', { type: 'fill', options: [] }))).toBe(false)
    expect(isChoiceQuestion(question('a', { type: 'mc', options: [] }))).toBe(false)
  })
})

describe('drafts', () => {
  const qs = [question('a'), question('b'), question('c')]

  it('restores saved answers from the quiz', () => {
    const answers: QuizAnswer[] = [{ questionId: 'b', response: 'O(n)', confidence: 'sure', correct: false }]
    expect(draftsFromQuiz(quiz({ answers }))).toEqual({ b: { response: 'O(n)', confidence: 'sure' } })
  })

  it('counts answered questions and lists unanswered numbers', () => {
    const drafts = { a: { response: 'x', confidence: null }, c: { response: '   ', confidence: 'sure' as const } }
    expect(isAnswered(drafts.a)).toBe(true)
    expect(isAnswered(drafts.c)).toBe(false)
    expect(countAnswered(qs, drafts)).toBe(1)
    expect(unansweredNumbers(qs, drafts)).toEqual([2, 3])
    expect(missingConfidenceCount(qs, drafts)).toBe(1)
  })

  it('compares drafts including missing ones', () => {
    expect(sameDraft(undefined, { response: '', confidence: null })).toBe(true)
    expect(sameDraft({ response: 'a', confidence: null }, { response: 'a', confidence: 'guess' })).toBe(false)
  })
})

describe('mock exam timer', () => {
  it('computes the deadline from the start time so it survives reloads', () => {
    expect(examDeadline('2026-10-04T10:00:00.000Z', 30)).toBe(Date.parse('2026-10-04T10:30:00.000Z'))
    expect(examDeadline(null, 30)).toBeNull()
    expect(examDeadline('2026-10-04T10:00:00.000Z', null)).toBeNull()
    expect(examDeadline('not a date', 30)).toBeNull()
  })

  it('never goes below zero', () => {
    const deadline = Date.parse('2026-10-04T10:30:00.000Z')
    expect(remainingMs(deadline, deadline - 5000)).toBe(5000)
    expect(remainingMs(deadline, deadline + 5000)).toBe(0)
    expect(remainingMs(null, 0)).toBeNull()
  })

  it('changes tone near the end', () => {
    expect(timerTone(null)).toBe('normal')
    expect(timerTone(10 * 60_000)).toBe('normal')
    expect(timerTone(5 * 60_000)).toBe('low')
    expect(timerTone(60_000)).toBe('critical')
  })

  it('announces only 10, 5 and 1 minutes left', () => {
    expect(timerAnnouncement(9 * 60_000 + 30_000)).toBe('10 minutes left')
    expect(timerAnnouncement(4 * 60_000 + 1)).toBe('5 minutes left')
    expect(timerAnnouncement(30_000)).toBe('1 minute left')
    expect(timerAnnouncement(7 * 60_000)).toBeNull()
    expect(timerAnnouncement(null)).toBeNull()
  })
})

describe('navigator', () => {
  it('marks answered, flagged and current questions', () => {
    const items = navigatorItems([question('a'), question('b')], { a: { response: 'x', confidence: null } }, new Set(['b']), 1)
    expect(items).toEqual([
      { questionId: 'a', number: 1, answered: true, flagged: false, current: false },
      { questionId: 'b', number: 2, answered: false, flagged: true, current: true }
    ])
    expect(navigatorLabel(items[1]!)).toBe('Question 2, not answered, flagged for review')
  })
})

describe('feedback', () => {
  const q = question('a')
  it('says correct, not answered, overconfident or not quite', () => {
    expect(answerFeedback(q, { questionId: 'a', response: 'O(n)', confidence: 'sure', correct: true }).kind).toBe('correct')
    expect(answerFeedback(q, undefined)).toEqual({ kind: 'unanswered', title: 'Not answered. The answer is O(n).' })
    expect(answerFeedback(q, { questionId: 'a', response: 'O(1)', confidence: 'sure', correct: false })).toEqual({
      kind: 'overconfident',
      title: 'You were sure, but the answer is O(n). Flagged for review.'
    })
    expect(answerFeedback(q, { questionId: 'a', response: 'O(1)', confidence: 'guess', correct: false }).title).toBe(
      'Not quite. The answer is O(n).'
    )
  })

  it('scores and encourages', () => {
    expect(scorePercent(3, 4)).toBe(75)
    expect(scorePercent(0, 0)).toBe(0)
    expect(scoreKicker(4, 4)).toBe('every single one!')
    expect(scoreKicker(1, 4)).toBe('mistakes now mean fewer later')
  })
})

describe('latestTopicQuiz', () => {
  it('picks the newest practice quiz of the topic', () => {
    const older = quiz({ id: 'old', createdAt: '2026-10-01T00:00:00.000Z' })
    const newer = quiz({ id: 'new', createdAt: '2026-10-03T00:00:00.000Z' })
    const otherTopic = quiz({ id: 'other', topicId: 't2', createdAt: '2026-10-04T00:00:00.000Z' })
    const weak = quiz({ id: 'weak', kind: 'weak_spots', createdAt: '2026-10-05T00:00:00.000Z' })
    expect(latestTopicQuiz([older, newer, otherTopic, weak], 't1')?.id).toBe('new')
    expect(latestTopicQuiz([], 't1')).toBeNull()
  })
})

describe('questionTopicLabel', () => {
  const topics = new Map([
    ['t1', { title: 'Binary search trees', unitLabel: 'Week 4' }],
    ['t2', { title: 'Heaps', unitLabel: 'Week 5' }],
    ['t3', { title: 'Hashing', unitLabel: '' }]
  ])
  it('names the topic and flags earlier topics in a practice quiz', () => {
    expect(questionTopicLabel({ topicId: 't1' }, 't1', topics)).toBe('Binary search trees')
    expect(questionTopicLabel({ topicId: 't2' }, 't1', topics)).toBe('Heaps, from Week 5')
    expect(questionTopicLabel({ topicId: 't3' }, 't1', topics)).toBe('Hashing, an earlier topic')
    expect(questionTopicLabel({ topicId: 't2' }, null, topics)).toBe('Heaps')
    expect(questionTopicLabel({ topicId: null }, 't1', topics)).toBeNull()
    expect(questionTopicLabel({ topicId: 'gone' }, 't1', topics)).toBeNull()
  })
})

describe('describeQuestionNumbers', () => {
  it('lists a few numbers and summarises many', () => {
    expect(describeQuestionNumbers([])).toBe('')
    expect(describeQuestionNumbers([4])).toBe('question 4')
    expect(describeQuestionNumbers([2, 5, 9])).toBe('questions 2, 5 and 9')
    expect(describeQuestionNumbers([1, 2, 3, 4, 5, 6, 7])).toBe('questions 1, 2, 3, 4, 5 and 2 more')
  })
})

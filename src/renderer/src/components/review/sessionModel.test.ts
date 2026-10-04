import { describe, expect, it } from 'vitest'
import type { PlanBlock } from '@shared/types'
import {
  groupTopicsByNotebook,
  nextSessionPart,
  parseSessionPart,
  partNumber,
  planLearnTopicIds,
  planReviewCardIds,
  planWeakTopicIds,
  sessionProgress,
  stillDue,
  weakQuizCount,
  weakQuizSettings,
  weakQuizStorageKey,
  weakTopicNote
} from './sessionModel'

function block(kind: PlanBlock['kind'], overrides: Partial<PlanBlock> = {}): PlanBlock {
  return { kind, title: '', detail: '', reason: '', estMinutes: 10, cardIds: [], topicIds: [], notebookIds: [], ...overrides }
}

describe('session parts', () => {
  it('parses ?part= with review as the default', () => {
    expect(parseSessionPart('weak')).toBe('weak')
    expect(parseSessionPart('learn')).toBe('learn')
    expect(parseSessionPart('nonsense')).toBe('review')
    expect(parseSessionPart(null)).toBe('review')
  })

  it('walks review -> weak -> learn', () => {
    expect(nextSessionPart('review')).toBe('weak')
    expect(nextSessionPart('weak')).toBe('learn')
    expect(nextSessionPart('learn')).toBeNull()
    expect(partNumber('weak')).toBe(2)
  })

  it('reports whole-session progress', () => {
    expect(sessionProgress('review', 0)).toBe(0)
    expect(sessionProgress('review', 0.5)).toBe(17)
    expect(sessionProgress('weak', 0)).toBe(33)
    expect(sessionProgress('learn', 1)).toBe(100)
    expect(sessionProgress('learn', 7)).toBe(100)
  })
})

describe('plan blocks', () => {
  const plan = {
    blocks: [
      block('review', { cardIds: ['c1', 'c2'] }),
      block('weak', { topicIds: ['t1', 't2'] }),
      block('learn', { topicIds: ['t9'] }),
      block('learn', { topicIds: ['t10'] }),
      block('exam_prep', { topicIds: ['t1'] })
    ]
  }

  it('reads cards, weak topics and the learn topic', () => {
    expect(planReviewCardIds(plan)).toEqual(['c1', 'c2'])
    expect(planWeakTopicIds(plan)).toEqual(['t1', 't2'])
    expect(planLearnTopicIds(plan)).toEqual(['t9', 't10'])
    expect(planLearnTopicIds({ blocks: [] })).toEqual([])
  })

  it('drops cards that are no longer due', () => {
    const now = Date.parse('2026-10-04T10:00:00.000Z')
    const cards = [
      { id: 'a', due: '2026-10-04T09:00:00.000Z' },
      { id: 'b', due: '2026-10-05T09:00:00.000Z' },
      { id: 'c', due: '2026-10-04T10:00:00.000Z' }
    ]
    expect(stillDue(cards, now).map((c) => c.id)).toEqual(['a', 'c'])
  })
})

describe('weak spot quizzes', () => {
  it('groups topics by notebook in plan order and skips unknown topics', () => {
    const topics = [
      { id: 't1', notebookId: 'os' },
      { id: 't2', notebookId: 'dsa' },
      { id: 't3', notebookId: 'os' }
    ]
    expect(groupTopicsByNotebook(['t1', 't2', 't3', 'gone'], topics)).toEqual([
      { notebookId: 'os', topicIds: ['t1', 't3'] },
      { notebookId: 'dsa', topicIds: ['t2'] }
    ])
  })

  it('asks for 8 questions, split across notebooks but at least 4 each', () => {
    expect(weakQuizCount(1)).toBe(8)
    expect(weakQuizCount(2)).toBe(4)
    expect(weakQuizCount(3)).toBe(4)
  })

  it('uses every question type, mixed difficulty and weak focus', () => {
    expect(weakQuizSettings(8)).toEqual({
      types: ['mc', 'tf', 'fill', 'identification'],
      count: 8,
      difficulty: 'mixed',
      focusWeak: true,
      interleave: false,
      timeLimitMin: null
    })
    expect(weakQuizStorageKey('2026-10-04', 'os')).toBe('study:session:2026-10-04:weak:os')
  })
})

describe('weakTopicNote', () => {
  it('leads with overconfidence, then misses, then mastery', () => {
    expect(weakTopicNote({ overconfidentCount: 1, missedCount: 4, answeredCount: 9, mastery: 40 })).toBe('sure but wrong 1 time')
    expect(weakTopicNote({ overconfidentCount: 0, missedCount: 4, answeredCount: 9, mastery: 40 })).toBe('missed 4 of 9')
    expect(weakTopicNote({ overconfidentCount: 0, missedCount: 0, answeredCount: 0, mastery: 39.6 })).toBe('40% mastery')
  })
})

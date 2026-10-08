import { describe, expect, it } from 'vitest'
import { NOTEBOOK_COLORS, type PlanBlock, type TodayPlan } from '@shared/types'
import {
  examNote,
  examUrgency,
  nothingDueTarget,
  planBlockLink,
  planTotals,
  sessionTimerAction,
  shelfFooter,
  todayState
} from './todayModel'
import { cleanNotebookDraft, hasErrors, suggestNotebookColor, tidyText, validateNotebookDraft } from './notebookForm'

function block(kind: PlanBlock['kind'], extra: Partial<PlanBlock> = {}): PlanBlock {
  return {
    kind,
    title: 't',
    detail: 'd',
    reason: 'r',
    estMinutes: 10,
    cardIds: [],
    topicIds: [],
    notebookIds: [],
    ...extra
  }
}

const emptyPlan: TodayPlan = { date: '2026-10-04', blocks: [], totalMinutes: 0, dueCount: 0 }

describe('planBlockLink', () => {
  it('sends reviews and weak spots to the matching session part', () => {
    expect(planBlockLink(block('review', { cardIds: ['c1'] }))).toBe('/session?part=review')
    expect(planBlockLink(block('weak', { topicIds: ['t1', 't2'] }))).toBe('/session?part=weak')
  })

  it('opens the topic for learn blocks and the notebook for mock exams', () => {
    expect(planBlockLink(block('learn', { topicIds: ['t9'], notebookIds: ['n1'] }))).toBe('/topics/t9')
    expect(planBlockLink(block('exam_prep', { topicIds: ['t1'], notebookIds: ['n3'] }))).toBe('/notebooks/n3')
  })

  it('returns null when the block has no target id', () => {
    expect(planBlockLink(block('learn'))).toBeNull()
    expect(planBlockLink(block('exam_prep'))).toBeNull()
  })
})

describe('planTotals', () => {
  it('formats minutes and counts Pomodoros', () => {
    expect(planTotals(45, 25)).toEqual({ minutes: '45 min', pomodoros: '2 Pomodoros' })
    expect(planTotals(20, 25)).toEqual({ minutes: '20 min', pomodoros: '1 Pomodoro' })
    expect(planTotals(80, 25)).toEqual({ minutes: '1 h 20 min', pomodoros: '4 Pomodoros' })
  })

  it('has no Pomodoro count for an empty plan', () => {
    expect(planTotals(0, 25)).toEqual({ minutes: '0 min', pomodoros: null })
  })
})

describe('todayState', () => {
  const notebook = { id: 'n1' } as never
  it('asks for a first notebook before anything else', () => {
    expect(todayState({ plan: { ...emptyPlan, blocks: [block('review')] }, notebooks: [] })).toBe('no_notebooks')
  })
  it('reports an empty plan as nothing due', () => {
    expect(todayState({ plan: emptyPlan, notebooks: [notebook] })).toBe('nothing_due')
  })
  it('shows the plan when it has blocks', () => {
    expect(todayState({ plan: { ...emptyPlan, blocks: [block('learn')] }, notebooks: [notebook] })).toBe('plan')
  })
})

describe('nothingDueTarget', () => {
  it('falls back to the shelf without active notebooks', () => {
    expect(nothingDueTarget([])).toBe('/notebooks')
    expect(nothingDueTarget([{ id: 'a', mastery: 10, archived: true }])).toBe('/notebooks')
  })
  it('opens the least-mastered active notebook', () => {
    const notebooks = [
      { id: 'a', mastery: 70, archived: false },
      { id: 'b', mastery: 20, archived: false },
      { id: 'c', mastery: 5, archived: true }
    ]
    expect(nothingDueTarget(notebooks)).toBe('/notebooks/b')
  })
})

describe('examNote', () => {
  it('names the weakest topics and the not-started count', () => {
    expect(
      examNote({
        weakestTopics: [
          { topicId: '1', title: 'Deadlock avoidance', mastery: 30 },
          { topicId: '2', title: 'Paging', mastery: 40 }
        ],
        notStartedCount: 2
      })
    ).toBe('Weakest: Deadlock avoidance and Paging · 2 topics not started yet')
  })
  it('handles single facts and the all-clear', () => {
    expect(examNote({ weakestTopics: [], notStartedCount: 1 })).toBe('1 topic not started yet')
    expect(examNote({ weakestTopics: [], notStartedCount: 0 })).toBe('Every covered topic is under way')
  })
})

describe('examUrgency', () => {
  it('treats the coming week as soon', () => {
    expect(examUrgency(0)).toBe('soon')
    expect(examUrgency(7)).toBe('soon')
    expect(examUrgency(8)).toBe('later')
  })
})

describe('sessionTimerAction', () => {
  it('leaves a running timer alone', () => {
    expect(sessionTimerAction('focus', 'running')).toBe('none')
    expect(sessionTimerAction('break', 'running')).toBe('none')
  })
  it('starts or resumes focus', () => {
    expect(sessionTimerAction('focus', 'idle')).toBe('start')
    expect(sessionTimerAction('focus', 'paused')).toBe('start')
  })
  it('skips a stopped break so the session begins with focus', () => {
    expect(sessionTimerAction('break', 'paused')).toBe('skip_break_and_start')
    expect(sessionTimerAction('break', 'idle')).toBe('skip_break_and_start')
  })
})

describe('notebook form', () => {
  it('requires a name and tidies whitespace', () => {
    expect(validateNotebookDraft({ name: '   ', code: '', color: 'blue' }).name).toMatch(/name/)
    expect(hasErrors(validateNotebookDraft({ name: 'OS', code: '', color: 'blue' }))).toBe(false)
    expect(tidyText('  Data   Structures ')).toBe('Data Structures')
    expect(cleanNotebookDraft({ name: ' Algo  rithms ', code: ' CS  201 ', color: 'teal' })).toEqual({
      name: 'Algo rithms',
      code: 'CS 201',
      color: 'teal'
    })
  })

  it('enforces the backend length limits', () => {
    expect(validateNotebookDraft({ name: 'x'.repeat(121), code: '', color: 'blue' }).name).toMatch(/120/)
    expect(validateNotebookDraft({ name: 'ok', code: 'y'.repeat(41), color: 'blue' }).code).toMatch(/40/)
    expect(validateNotebookDraft({ name: 'x'.repeat(120), code: 'y'.repeat(40), color: 'blue' })).toEqual({})
  })

  it('suggests an unused cover color, cycling when all are taken', () => {
    expect(suggestNotebookColor([], NOTEBOOK_COLORS)).toBe('blue')
    expect(suggestNotebookColor(['blue', 'orange'], NOTEBOOK_COLORS)).toBe('teal')
    expect(suggestNotebookColor([...NOTEBOOK_COLORS], NOTEBOOK_COLORS)).toBe('blue')
    expect(suggestNotebookColor([...NOTEBOOK_COLORS, 'blue'], NOTEBOOK_COLORS)).toBe('orange')
  })
})

describe('shelfFooter', () => {
  const now = new Date(2026, 9, 4, 10)
  const base = { dueCards: 0, nextExam: null, topicCount: 5, sourceCount: 2, archived: false }
  const exam = { id: 'e', notebookId: 'n', name: 'Midterm', examDate: '2026-10-13', topicIds: [], createdAt: '' }

  it('lists due cards and the next exam', () => {
    expect(shelfFooter({ ...base, dueCards: 12, nextExam: exam }, now)).toBe('12 cards due · Midterm in 9 days')
    expect(shelfFooter({ ...base, nextExam: { ...exam, examDate: '2026-10-05' } }, now)).toBe('Midterm tomorrow')
  })

  it('says what to do next in a fresh notebook', () => {
    expect(shelfFooter({ ...base, sourceCount: 0, topicCount: 0 }, now)).toBe('Add your course files')
    expect(shelfFooter({ ...base, topicCount: 0 }, now)).toBe('No topics yet')
    expect(shelfFooter(base, now)).toBe('Nothing due')
  })

  it('marks archived notebooks', () => {
    expect(shelfFooter({ ...base, dueCards: 3, archived: true }, now)).toBe('Archived')
  })
})

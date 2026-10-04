import { describe, expect, it } from 'vitest'
import type { Source } from '@shared/types'
import {
  defaultStep,
  furthestIndex,
  initialChunk,
  lessonSourcesPreview,
  linkConnections,
  parseInstantAnswers,
  parseStep,
  passedChunks,
  questionKey,
  resolveStep,
  shortNote,
  shouldPersistChunk,
  shouldPersistStep,
  stepViews,
  termsInText
} from './topicModel'

describe('steps', () => {
  it('parses the ?step= value', () => {
    expect(parseStep('learn')).toBe('learn')
    expect(parseStep('schedule')).toBeNull()
    expect(parseStep(null)).toBeNull()
  })

  it('opens where the learner left off when the URL names no step', () => {
    expect(defaultStep(null)).toBe('warmup')
    expect(defaultStep('explain')).toBe('explain')
    expect(defaultStep('done')).toBe('remember')
    expect(resolveStep('practice', 'learn')).toBe('practice')
    expect(resolveStep('bogus', 'learn')).toBe('learn')
  })

  it('tracks the furthest step', () => {
    expect(furthestIndex(null)).toBe(-1)
    expect(furthestIndex('warmup')).toBe(0)
    expect(furthestIndex('remember')).toBe(4)
    expect(furthestIndex('done')).toBe(5)
  })

  it('marks done, current and the recommended next step', () => {
    const views = stepViews('warmup', 'explain')
    expect(views.map((v) => v.status)).toEqual(['current', 'done', 'upcoming', 'upcoming', 'upcoming'])
    expect(views.find((v) => v.recommended)?.step).toBe('explain')
    expect(stepViews('explain', 'explain').some((v) => v.recommended)).toBe(false)
    expect(stepViews('learn', 'done').map((v) => v.status)).toEqual(['done', 'current', 'done', 'done', 'done'])
    expect(stepViews('learn', 'done').some((v) => v.recommended)).toBe(false)
    expect(stepViews('learn', null).find((v) => v.recommended)?.step).toBe('warmup')
  })

  it('persists steps forward only and never undoes a finished topic', () => {
    expect(shouldPersistStep('warmup', null)).toBe(true)
    expect(shouldPersistStep('learn', 'warmup')).toBe(true)
    expect(shouldPersistStep('warmup', 'learn')).toBe(false)
    expect(shouldPersistStep('learn', 'learn')).toBe(false)
    expect(shouldPersistStep('remember', 'done')).toBe(false)
    expect(shouldPersistChunk('learn')).toBe(true)
    expect(shouldPersistChunk('warmup')).toBe(true)
    expect(shouldPersistChunk(null)).toBe(true)
    expect(shouldPersistChunk('explain')).toBe(false)
    expect(shouldPersistChunk('done')).toBe(false)
  })
})

describe('lesson parts', () => {
  it('resumes the saved part while learning and rereads from the start later', () => {
    expect(initialChunk('learn', 2, 4)).toBe(2)
    expect(initialChunk('learn', 9, 4)).toBe(3)
    expect(initialChunk('practice', 2, 4)).toBe(0)
    expect(initialChunk('learn', 2, 0)).toBe(0)
  })

  it('knows which parts were already passed', () => {
    expect(passedChunks('warmup', 0, 4)).toBe(0)
    expect(passedChunks('learn', 2, 4)).toBe(2)
    expect(passedChunks('explain', 0, 4)).toBe(4)
    expect(passedChunks('done', 0, 4)).toBe(4)
  })

  it('finds key terms used in a part', () => {
    const terms = [
      { term: 'root', definition: 'top node' },
      { term: 'subtree', definition: 'a node and its descendants' },
      { term: 'heap', definition: '...' }
    ]
    expect(termsInText(terms, 'The ROOT of every subtree...').map((t) => t.term)).toEqual(['root', 'subtree'])
    expect(termsInText(terms, 'root subtree', 1)).toHaveLength(1)
  })

  it('shortens notes at a word boundary', () => {
    expect(shortNote('short')).toBe('short')
    expect(shortNote('one two three four five six seven', 20)).toBe('one two three four…')
  })

  it('links connections to topics they name', () => {
    const topics = [
      { id: 't1', title: 'AVL tree rotations' },
      { id: 't2', title: 'Linked lists' },
      { id: 'self', title: 'Binary search trees' }
    ]
    const linked = linkConnections(['Builds on linked lists (week 2).', 'See binary search trees'], topics, 'self')
    expect(linked[0]?.topics).toEqual([{ id: 't2', title: 'Linked lists' }])
    expect(linked[1]?.topics).toEqual([])
  })
})

describe('lesson sources', () => {
  function source(id: string, kind: Source['kind'], status: Source['status'] = 'ready'): Source {
    return {
      id,
      notebookId: 'n',
      fileName: `${id}.pdf`,
      ext: 'pdf',
      kind,
      sizeBytes: 1,
      storedPath: '',
      status,
      error: null,
      charCount: 1,
      pageCount: 1,
      summary: null,
      addedAt: ''
    }
  }
  const sources = [source('lec', 'lecture'), source('exam', 'exam'), source('quiz', 'quiz'), source('broken', 'slides', 'error')]

  it('uses the topic files when set, otherwise ready non-exam files', () => {
    expect(lessonSourcesPreview({ sourceIds: [] }, sources).map((s) => s.id)).toEqual(['lec'])
    expect(lessonSourcesPreview({ sourceIds: ['exam', 'broken'] }, sources).map((s) => s.id)).toEqual(['exam'])
  })
})

describe('stored answers', () => {
  it('keeps only well-formed entries', () => {
    expect(parseInstantAnswers({ a: { response: 'x', correct: true }, b: { response: 1 }, c: null })).toEqual({
      a: { response: 'x', correct: true }
    })
    expect(parseInstantAnswers('nope')).toEqual({})
  })

  it('keys questions by id, falling back to the prompt', () => {
    expect(questionKey({ id: 'q1', prompt: 'P' })).toBe('q1')
    expect(questionKey({ id: '', prompt: 'P' })).toBe('P')
  })
})

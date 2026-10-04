import { describe, expect, it } from 'vitest'
import type { TopicBrief } from './index'
import {
  EXPLANATION_JSON_SCHEMA,
  finalizeQuestion,
  FLASHCARDS_JSON_SCHEMA,
  type JsonSchema,
  LESSON_JSON_SCHEMA,
  OutputError,
  parseExplanationOutput,
  parseFlashcardsOutput,
  parseLessonOutput,
  parseQuestionsOutput,
  parseSyllabusOutput,
  QUESTIONS_JSON_SCHEMA,
  SUMMARY_JSON_SCHEMA,
  SYLLABUS_JSON_SCHEMA,
  topicIdForIndex
} from './schemas'

const SCHEMAS: Record<string, JsonSchema> = {
  lesson: LESSON_JSON_SCHEMA,
  questions: QUESTIONS_JSON_SCHEMA,
  flashcards: FLASHCARDS_JSON_SCHEMA,
  explanation: EXPLANATION_JSON_SCHEMA,
  syllabus: SYLLABUS_JSON_SCHEMA,
  summary: SUMMARY_JSON_SCHEMA
}

// Keywords structured outputs rejects or ignores; they belong in zod instead.
const UNSUPPORTED = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'maxItems', 'pattern']

function walk(schema: unknown, path: string, visit: (node: Record<string, unknown>, path: string) => void): void {
  if (Array.isArray(schema)) {
    schema.forEach((item, i) => walk(item, `${path}[${i}]`, visit))
    return
  }
  if (typeof schema !== 'object' || schema === null) return
  const node = schema as Record<string, unknown>
  visit(node, path)
  for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`, visit)
}

describe('JSON schemas sent as output_config.format', () => {
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    it(`${name}: every object is closed and requires all its properties`, () => {
      expect(schema.type).toBe('object')
      let objects = 0
      walk(schema, name, (node, path) => {
        if (node.type === 'object') {
          objects++
          const properties = node.properties as Record<string, unknown>
          expect(node.additionalProperties, path).toBe(false)
          expect([...(node.required as string[])].sort(), path).toEqual(Object.keys(properties).sort())
        }
        for (const keyword of UNSUPPORTED) expect(node[keyword], `${path}.${keyword}`).toBeUndefined()
        if (node.minItems !== undefined) expect([0, 1]).toContain(node.minItems)
      })
      expect(objects).toBeGreaterThan(0)
    })
  }

  it('is plain JSON (serialises without loss)', () => {
    for (const schema of Object.values(SCHEMAS)) expect(JSON.parse(JSON.stringify(schema))).toEqual(schema)
  })
})

const draft = {
  prompt: 'Which traversal visits the root first?',
  options: ['Preorder', 'Inorder', 'Postorder', 'Level order'],
  answer: 'Preorder',
  acceptable: [],
  explanation: 'Preorder visits root, left, right.',
  difficulty: 'easy' as const,
  sourceRef: 'Trees.pdf, page 4'
}

describe('finalizeQuestion', () => {
  it('assigns a fresh id and the given topic', () => {
    const a = finalizeQuestion({ ...draft, type: 'mc' }, 't1')
    const b = finalizeQuestion({ ...draft, type: 'mc' }, 't1')
    if (typeof a === 'string' || typeof b === 'string') throw new Error('expected questions')
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(a.id).not.toBe(b.id)
    expect(a.topicId).toBe('t1')
  })

  it('forces true/false options and normalises the answer', () => {
    const q = finalizeQuestion({ ...draft, type: 'tf', options: ['true', 'false', 'maybe'], answer: 'false' }, null)
    expect(q).toMatchObject({ options: ['True', 'False'], answer: 'False', acceptable: [] })
    expect(finalizeQuestion({ ...draft, type: 'tf', answer: 'Sometimes' }, null)).toMatch(/True.*False/)
  })

  it('resolves a multiple-choice answer given by letter or different case', () => {
    expect(finalizeQuestion({ ...draft, type: 'mc', answer: 'C' }, null)).toMatchObject({ answer: 'Postorder' })
    expect(finalizeQuestion({ ...draft, type: 'mc', answer: 'inorder' }, null)).toMatchObject({ answer: 'Inorder' })
  })

  it('rejects a multiple-choice answer that is not an option, and too few options', () => {
    expect(typeof finalizeQuestion({ ...draft, type: 'mc', answer: 'Breadth first' }, null)).toBe('string')
    expect(typeof finalizeQuestion({ ...draft, type: 'mc', options: ['Preorder', 'Inorder'] }, null)).toBe('string')
  })

  it('normalises fill-in-the-blank blanks and rejects prompts without one', () => {
    const q = finalizeQuestion({ ...draft, type: 'fill', prompt: 'A heap is a complete ________ tree.', answer: 'binary', acceptable: ['Binary', '2-ary'] }, null)
    expect(q).toMatchObject({ prompt: 'A heap is a complete ____ tree.', options: [], acceptable: ['2-ary'] })
    expect(typeof finalizeQuestion({ ...draft, type: 'fill', prompt: 'A heap is a complete tree.' }, null)).toBe('string')
  })

  it('clears options for identification questions', () => {
    expect(finalizeQuestion({ ...draft, type: 'identification', answer: 'Preorder traversal' }, null)).toMatchObject({ options: [], answer: 'Preorder traversal' })
  })
})

const topics: TopicBrief[] = [
  { id: 'id-stacks', title: 'Stacks', description: '', unitLabel: 'Week 1' },
  { id: 'id-queues', title: 'Queues', description: '', unitLabel: 'Week 2' },
  { id: 'id-trees', title: 'Trees', description: '', unitLabel: 'Week 3' }
]

function rawQuestion(overrides: Record<string, unknown>): Record<string, unknown> {
  return { topicIndex: 1, type: 'mc', ...draft, ...overrides }
}

describe('parseQuestionsOutput', () => {
  it('maps the 1-based topicIndex to the input topic ids', () => {
    const { questions } = parseQuestionsOutput(
      { questions: [rawQuestion({ topicIndex: 1 }), rawQuestion({ topicIndex: 3, prompt: 'Q2' })] },
      { topics, primaryTopicId: null, types: ['mc'], difficulty: 'mixed' }
    )
    expect(questions.map((q) => q.topicId)).toEqual(['id-stacks', 'id-trees'])
  })

  it('falls back to the primary topic for an out-of-range index, or null across topics', () => {
    expect(topicIdForIndex(9, { topics, primaryTopicId: 'id-queues' })).toBe('id-queues')
    expect(topicIdForIndex(0, { topics, primaryTopicId: null })).toBeNull()
    expect(topicIdForIndex(5, { topics: [topics[2]], primaryTopicId: null })).toBe('id-trees')
  })

  it('drops disallowed types and broken items but keeps the rest', () => {
    const result = parseQuestionsOutput(
      {
        questions: [
          rawQuestion({}),
          rawQuestion({ type: 'tf', prompt: 'Stacks are LIFO.', answer: 'True' }),
          rawQuestion({ prompt: 'bad', answer: 'Nope' }),
          { prompt: 'missing fields' }
        ]
      },
      { topics, primaryTopicId: null, types: ['mc'], difficulty: 'mixed' }
    )
    expect(result.questions).toHaveLength(1)
    expect(result.rejected).toHaveLength(3)
  })

  it('applies a fixed difficulty to every question', () => {
    const { questions } = parseQuestionsOutput({ questions: [rawQuestion({ difficulty: 'easy' })] }, { topics, primaryTopicId: null, types: ['mc'], difficulty: 'hard' })
    expect(questions[0].difficulty).toBe('hard')
  })

  it('throws OutputError when the envelope is wrong', () => {
    expect(() => parseQuestionsOutput({ items: [] }, { topics, primaryTopicId: null, types: ['mc'], difficulty: 'mixed' })).toThrow(OutputError)
  })
})

describe('parseLessonOutput', () => {
  const check = { type: 'tf', prompt: 'Stacks are LIFO.', options: ['True', 'False'], answer: 'True', explanation: 'Last in, first out.', difficulty: 'easy', sourceRef: '' }
  const lesson = {
    title: 'Stacks',
    overview: 'Stacks are everywhere.',
    estMinutes: 500,
    warmup: [check, check, check],
    chunks: [1, 2, 3].map((i) => ({ heading: `Part ${i}`, body: 'Body', example: '', check })),
    keyTerms: [
      { term: 'push', definition: 'Add on top.' },
      { term: 'Push', definition: 'Duplicate.' },
      { term: 'pop', definition: 'Remove the top.' },
      { term: 'peek', definition: 'Read the top.' }
    ],
    connections: ['Queues are the FIFO cousin.'],
    explainPrompt: 'Explain stacks.',
    explainRubric: ['LIFO', 'push/pop', 'O(1) operations', 'call stack example']
  }

  it('assigns ids and the topic, keeps 2 warm-ups, dedupes terms and clamps minutes', () => {
    const content = parseLessonOutput(lesson, { topic: topics[0], sourceNames: ['Stacks.pdf'] })
    expect(content.warmup).toHaveLength(2)
    expect(content.chunks.every((c) => c.check.topicId === 'id-stacks')).toBe(true)
    expect(new Set([...content.warmup, ...content.chunks.map((c) => c.check)].map((q) => q.id)).size).toBe(5)
    expect(content.keyTerms.map((k) => k.term)).toEqual(['push', 'pop', 'peek'])
    expect(content.estMinutes).toBe(180)
    expect(content.sourcesUsed).toEqual(['Stacks.pdf'])
  })

  it('says when the lesson is based on the description alone', () => {
    expect(parseLessonOutput(lesson, { topic: topics[0], sourceNames: [] }).sourcesUsed).toEqual(['No files: based on the topic description'])
  })

  it('rejects lessons with too few parts or an invalid check question', () => {
    expect(() => parseLessonOutput({ ...lesson, chunks: lesson.chunks.slice(0, 2) }, { topic: topics[0], sourceNames: [] })).toThrow(OutputError)
    const badCheck = { ...check, type: 'mc', options: ['A', 'B', 'C'], answer: 'D' }
    expect(() =>
      parseLessonOutput({ ...lesson, chunks: [...lesson.chunks.slice(0, 2), { heading: 'x', body: 'y', example: '', check: badCheck }] }, { topic: topics[0], sourceNames: [] })
    ).toThrow(/chunk 3 check/)
  })
})

describe('parseFlashcardsOutput', () => {
  it('removes duplicate fronts and trims to the requested count', () => {
    const cards = parseFlashcardsOutput(
      {
        cards: [
          { front: 'What is a stack?', back: 'A LIFO list.', sourceRef: '' },
          { front: 'what is a STACK', back: 'Duplicate.', sourceRef: '' },
          { front: 'What does pop return?', back: 'The top item.', sourceRef: 'Stacks.pdf, page 2' },
          { front: 'What is push?', back: 'Adds on top.', sourceRef: '' }
        ]
      },
      { count: 2 }
    )
    expect(cards.map((c) => c.front)).toEqual(['What is a stack?', 'What does pop return?'])
  })

  it('rejects a nearly empty deck', () => {
    expect(() => parseFlashcardsOutput({ cards: [{ front: 'Q', back: 'A', sourceRef: '' }] }, { count: 10 })).toThrow(OutputError)
  })
})

describe('parseExplanationOutput', () => {
  it('clamps the score and trims lists', () => {
    expect(parseExplanationOutput({ score: 140.4, covered: [' LIFO ', 'LIFO'], missing: [], misconceptions: [''], suggestion: ' Add an example. ' })).toEqual({
      score: 100,
      covered: ['LIFO'],
      missing: [],
      misconceptions: [],
      suggestion: 'Add an example.'
    })
  })
})

describe('parseSyllabusOutput', () => {
  it('skips existing topics, validates dates and keeps only known covered titles', () => {
    const result = parseSyllabusOutput(
      {
        courseCode: ' CS 201 ',
        topics: [
          { title: 'Stacks', description: '', unitLabel: 'Week 1' },
          { title: 'Hash tables', description: 'Hashing and collisions.', unitLabel: 'Week 4' },
          { title: 'hash  tables', description: 'dup', unitLabel: 'Week 4' }
        ],
        exams: [
          { name: 'Midterm', examDate: '2026-02-30', coversTopicTitles: ['stacks', 'HASH TABLES', 'Graphs'] },
          { name: 'Final', examDate: '2026-12-10', coversTopicTitles: [] }
        ]
      },
      { existingTopicTitles: ['Stacks'] }
    )
    expect(result.courseCode).toBe('CS 201')
    expect(result.topics.map((t) => t.title)).toEqual(['Hash tables'])
    expect(result.exams[0]).toEqual({ name: 'Midterm', examDate: null, coversTopicTitles: ['Stacks', 'Hash tables'] })
    expect(result.exams[1].examDate).toBe('2026-12-10')
  })
})

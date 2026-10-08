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
  parseWrittenDate,
  QUESTIONS_JSON_SCHEMA,
  questionsJsonSchema,
  repairChoiceQuestion,
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

  it('accepts enum values in any casing (structured outputs do not guarantee it)', () => {
    const result = parseQuestionsOutput(
      { questions: [rawQuestion({ type: 'MC', difficulty: 'Hard' }), rawQuestion({ type: ' Tf ', prompt: 'Stacks are LIFO.', answer: 'True' })] },
      { topics, primaryTopicId: null, types: ['mc', 'tf'], difficulty: 'mixed' }
    )
    expect(result.rejected).toEqual([])
    expect(result.questions.map((q) => [q.type, q.difficulty])).toEqual([
      ['mc', 'hard'],
      ['tf', rawQuestion({}).difficulty]
    ])
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

  it('accepts check and warm-up enum values in any casing', () => {
    const shouting = { ...check, type: 'TF', difficulty: 'Easy' }
    const content = parseLessonOutput({ ...lesson, warmup: [shouting, shouting] }, { topic: topics[0], sourceNames: [] })
    expect(content.warmup.map((q) => [q.type, q.difficulty])).toEqual([
      ['tf', 'easy'],
      ['tf', 'easy']
    ])
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

describe('repairs for local models (lenient)', () => {
  const mc = (answer: string, options: string[]) => ({ type: 'mc' as const, options, answer })
  const complexities = ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)']

  it('limits the quiz schema to the chosen types, and the full schema is the one Claude gets', () => {
    expect(questionsJsonSchema(['mc', 'tf', 'fill', 'identification'])).toEqual(QUESTIONS_JSON_SCHEMA)
    const narrow = questionsJsonSchema(['tf']) as { properties: { questions: { items: { properties: { type: { enum: string[] } } } } } }
    expect(narrow.properties.questions.items.properties.type.enum).toEqual(['tf'])
  })

  it('matches an answer given with its letter, a final period or different spacing', () => {
    expect(repairChoiceQuestion(mc('C) O(n)', complexities), false)).toMatchObject({ answer: 'O(n)' })
    expect(repairChoiceQuestion(mc('O(n).', complexities), false)).toMatchObject({ answer: 'O(n)' })
    expect(repairChoiceQuestion(mc(' o(n) ', complexities), false)).toMatchObject({ answer: 'O(n)' })
    // Letter and text disagree, or the text names no option: left for the check to reject.
    expect(repairChoiceQuestion(mc('A) O(n)', complexities), false).answer).toBe('A) O(n)')
    expect(repairChoiceQuestion(mc('O(n^2)', complexities), false).answer).toBe('O(n^2)')
  })

  it('takes the letters off lettered options', () => {
    const lettered = ['A) O(1)', 'B) O(log n)', 'C) O(n)', 'D) O(n log n)']
    expect(repairChoiceQuestion(mc('O(log n)', lettered), false)).toMatchObject({ options: complexities, answer: 'O(log n)' })
    expect(repairChoiceQuestion(mc('(D) O(n log n)', lettered), false)).toMatchObject({ options: complexities, answer: 'O(n log n)' })
    // Letters out of order are part of the options.
    const odd = ['B) one', 'A) two', 'C) three']
    expect(repairChoiceQuestion(mc('B) one', odd), false).options).toEqual(odd)
  })

  it('turns a true/false statement written as multiple choice into a true/false question when that type is allowed', () => {
    expect(repairChoiceQuestion(mc('B', ['True', 'False']), true)).toMatchObject({ type: 'tf', options: ['True', 'False'], answer: 'False' })
    expect(repairChoiceQuestion(mc('true', ['true', 'false']), false)).toMatchObject({ type: 'mc' })
  })

  it('applies only when asked: Claude answers are checked strictly as before', () => {
    const item = rawQuestion({ answer: 'A) Preorder', options: ['A) Preorder', 'B) Inorder', 'C) Postorder'] })
    const context = { topics, primaryTopicId: null, types: ['mc' as const], difficulty: 'mixed' as const }
    expect(parseQuestionsOutput({ questions: [item] }, context).questions[0]).toMatchObject({ options: ['A) Preorder', 'B) Inorder', 'C) Postorder'], answer: 'A) Preorder' })
    expect(parseQuestionsOutput({ questions: [rawQuestion({ answer: 'Preorder.' })] }, context).questions).toHaveLength(0)
    expect(parseQuestionsOutput({ questions: [rawQuestion({ answer: 'Preorder.' })] }, { ...context, lenient: true }).questions[0].answer).toBe('Preorder')
    // A multiple-choice true/false becomes "tf" only when that type is allowed.
    const tfItem = rawQuestion({ options: ['True', 'False'], answer: 'True' })
    expect(parseQuestionsOutput({ questions: [tfItem] }, { ...context, lenient: true }).questions).toHaveLength(0)
    expect(parseQuestionsOutput({ questions: [tfItem] }, { ...context, types: ['mc', 'tf'], lenient: true }).questions[0].type).toBe('tf')
  })

  it("keeps a lesson whose check has lettered options, or whose lists end in a blank entry", () => {
    const check = { type: 'mc', prompt: 'Which is LIFO?', options: ['A) Stack', 'B) Queue', 'C) Heap'], answer: 'A) Stack', explanation: 'Last in, first out.', difficulty: 'easy', sourceRef: '' }
    const tfCheck = { ...check, type: 'tf', options: ['True', 'False'], answer: 'True' }
    const lesson = {
      title: 'Stacks',
      overview: 'Stacks.',
      estMinutes: 15,
      warmup: [tfCheck, { ...check, answer: 'Stack.' }],
      chunks: [1, 2, 3].map((i) => ({ heading: `Part ${i}`, body: 'Body', example: '', check })),
      keyTerms: [
        { term: 'push', definition: 'Add on top.' },
        { term: 'pop', definition: 'Remove the top.' },
        { term: 'peek', definition: 'Read the top.' },
        { term: 'top', definition: ' ' }
      ],
      connections: ['', 'Queues are the FIFO cousin.'],
      explainPrompt: 'Explain stacks.',
      explainRubric: ['LIFO', 'push/pop', 'O(1) operations', '']
    }
    expect(() => parseLessonOutput(lesson, { topic: topics[0], sourceNames: [] })).toThrow(OutputError)
    const content = parseLessonOutput(lesson, { topic: topics[0], sourceNames: [], lenient: true })
    expect(content.chunks[0].check).toMatchObject({ options: ['Stack', 'Queue', 'Heap'], answer: 'Stack' })
    expect(content.warmup[1].answer).toBe('Stack')
    expect(content.keyTerms.map((k) => k.term)).toEqual(['push', 'pop', 'peek'])
    expect(content.connections).toEqual(['Queues are the FIFO cousin.'])
    expect(content.explainRubric).toEqual(['LIFO', 'push/pop', 'O(1) operations'])
  })

  it('drops a blank flashcard instead of the deck', () => {
    const deck = {
      cards: [
        { front: 'What is a stack?', back: 'A LIFO list.', sourceRef: '' },
        { front: 'What does pop return?', back: '', sourceRef: '' },
        { front: 'What is push?', back: 'Adds on top.', sourceRef: '' }
      ]
    }
    expect(() => parseFlashcardsOutput(deck, { count: 3 })).toThrow(OutputError)
    expect(parseFlashcardsOutput(deck, { count: 3, lenient: true }).map((c) => c.front)).toEqual(['What is a stack?', 'What is push?'])
  })

  it('leaves out "None" placeholders in explanation feedback', () => {
    const feedback = { score: 60, covered: ['LIFO'], missing: ['N/A'], misconceptions: ['None.', 'No misconceptions found', 'Says pop is O(n): it is O(1)'], suggestion: 'Trace it.' }
    expect(parseExplanationOutput(feedback).misconceptions).toHaveLength(3)
    expect(parseExplanationOutput(feedback, { lenient: true })).toMatchObject({ missing: [], misconceptions: ['Says pop is O(n): it is O(1)'] })
  })

  it('reads written-out exam dates and topic titles reworded with "&"', () => {
    expect(parseWrittenDate('October 20, 2026')).toBe('2026-10-20')
    expect(parseWrittenDate('Tue, Oct. 6 2026')).toBe('2026-10-06')
    expect(parseWrittenDate('3rd December 2026')).toBe('2026-12-03')
    expect(parseWrittenDate('Sept 31, 2026')).toBeNull()
    expect(parseWrittenDate('Ju 4, 2026')).toBeNull()
    expect(parseWrittenDate('next Tuesday')).toBeNull()
    const output = {
      courseCode: '',
      topics: [{ title: 'Arrays and linked lists', description: '', unitLabel: '' }],
      exams: [{ name: 'Midterm', examDate: 'October 20, 2026', coversTopicTitles: ['Arrays & Linked Lists', 'Stacks.'] }]
    }
    expect(parseSyllabusOutput(output, { existingTopicTitles: ['Stacks'] }).exams[0]).toEqual({ name: 'Midterm', examDate: null, coversTopicTitles: [] })
    expect(parseSyllabusOutput(output, { existingTopicTitles: ['Stacks'], lenient: true }).exams[0]).toEqual({
      name: 'Midterm',
      examDate: '2026-10-20',
      coversTopicTitles: ['Arrays and linked lists', 'Stacks']
    })
  })
})

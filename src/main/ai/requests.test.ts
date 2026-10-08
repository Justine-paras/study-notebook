// The exact request body every AI task sends, for every model the learner can
// pick. These requests have to be right the first time they reach the real
// API (a wrong field is a 400 on every call), so each task's captured params
// are checked against the documented shape: model ids, max_tokens within the
// model's output limit, effort and fallbacks only where the model supports
// them, no thinking/sampling/prefill, structured output format, and the
// cache-friendly layout (system breakpoint, documents with one breakpoint on
// the last, the instruction last).

import Anthropic from '@anthropic-ai/sdk'
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { describe, expect, it } from 'vitest'
import { AI_MODELS, type AiModelId, type AiTask } from '@shared/types'
import { MODEL_MAX_OUTPUT_TOKENS, runStructured, TASK_EFFORT, TASK_MAX_TOKENS, type StructuredCall } from './client'
import { demoLesson } from './demo'
import type { AiSourceDoc, GenerateQuestionsInput, TopicBrief } from './index'
import { SYSTEM_PROMPT } from './prompts'
import {
  EXPLANATION_JSON_SCHEMA,
  FLASHCARDS_JSON_SCHEMA,
  type JsonSchema,
  LESSON_JSON_SCHEMA,
  OutputError,
  QUESTIONS_JSON_SCHEMA,
  SUMMARY_JSON_SCHEMA,
  SYLLABUS_JSON_SCHEMA
} from './schemas'
import { FakeClient, TestStudyAi } from './testkit'

const MODELS: AiModelId[] = AI_MODELS.map((m) => m.id)

const topic: TopicBrief = { id: 'topic-bst', title: 'Binary search trees', description: 'Insert, search and delete in a BST.', unitLabel: 'Week 5' }
const other: TopicBrief = { id: 'topic-heaps', title: 'Heaps', description: 'Binary heaps and heapsort.', unitLabel: 'Week 6' }
const sources: AiSourceDoc[] = [
  { name: 'Week 5 - Trees.pdf', kind: 'lecture', text: '[Page 1]\nA binary search tree keeps smaller keys in the left subtree.\n\n[Page 2]\nSearch takes O(h) time.' },
  { name: 'BST slides.pptx', kind: 'slides', text: '[Slide 1]\nDeleting a node with two children uses its in-order successor.' }
]
const syllabus: AiSourceDoc = { name: 'Syllabus.pdf', kind: 'syllabus', text: '[Page 1]\nWeek 5: Binary search trees\nMidterm: Oct 20' }

const lessonInput = { notebookName: 'Data Structures', topic, sources, otherTopics: [other] }
const lessonJson = JSON.stringify(demoLesson(lessonInput))

function quizInput(overrides: Partial<GenerateQuestionsInput> = {}): GenerateQuestionsInput {
  return {
    notebookName: 'Data Structures',
    topics: [topic, other],
    primaryTopicId: topic.id,
    sources,
    types: ['mc', 'tf', 'fill', 'identification'],
    count: 4,
    difficulty: 'mixed',
    mode: 'practice',
    weakFocus: [],
    avoidPrompts: [],
    ...overrides
  }
}

const question = (prompt: string, type: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  topicIndex: 1,
  type,
  prompt,
  options: [],
  answer: 'successor',
  acceptable: [],
  explanation: 'Because the in-order successor keeps the BST order.',
  difficulty: 'medium',
  sourceRef: 'BST slides.pptx, slide 1',
  ...extra
})
const questionsJson = JSON.stringify({
  questions: [
    question('Which node replaces a deleted node with two children?', 'mc', { options: ['Successor', 'Parent', 'Root', 'Leaf'], answer: 'Successor' }),
    question('Search in a BST takes O(h) time.', 'tf', { options: ['True', 'False'], answer: 'True' }),
    question('A node with two children is replaced by its in-order ____.', 'fill'),
    question('Name the node that comes next in an in-order traversal.', 'identification')
  ]
})
const cardsJson = JSON.stringify({
  cards: [
    { front: 'Why does BST search take O(h)?', back: 'Each comparison moves one level down.', sourceRef: 'Week 5 - Trees.pdf, page 2' },
    { front: 'What replaces a deleted node with two children?', back: 'Its in-order successor.', sourceRef: 'BST slides.pptx, slide 1' }
  ]
})
const explanationJson = JSON.stringify({ score: 60, covered: ['Ordering'], missing: ["Doesn't say why search is O(h)"], misconceptions: [], suggestion: 'Trace a search.' })
const syllabusJson = JSON.stringify({
  courseCode: 'CS 201',
  topics: [{ title: 'Binary search trees', description: 'Insert, search, delete.', unitLabel: 'Week 5' }],
  exams: [{ name: 'Midterm', examDate: '2026-10-20', coversTopicTitles: ['Binary search trees'] }]
})
const summaryJson = JSON.stringify({ title: 'Summary: Trees', summary: '## Key ideas\n- Smaller keys go left.' })

/** Runs one task on a fake transport and returns the single request it sent. */
type TaskRun = { task: AiTask; schema: JsonSchema; documents: number; run: (ai: TestStudyAi) => Promise<unknown>; response: string }

const TASKS: TaskRun[] = [
  {
    task: 'syllabus',
    schema: SYLLABUS_JSON_SCHEMA,
    documents: 1,
    response: syllabusJson,
    run: (ai) => ai.extractSyllabus({ notebookName: 'Data Structures', syllabus, existingTopicTitles: [], todayDate: '2026-10-04' })
  },
  { task: 'lesson', schema: LESSON_JSON_SCHEMA, documents: 2, response: lessonJson, run: (ai) => ai.generateLesson(lessonInput) },
  { task: 'quiz', schema: QUESTIONS_JSON_SCHEMA, documents: 2, response: questionsJson, run: (ai) => ai.generateQuestions(quizInput()) },
  {
    task: 'flashcards',
    schema: FLASHCARDS_JSON_SCHEMA,
    documents: 2,
    response: cardsJson,
    run: async (ai) => {
      const lesson = await new TestStudyAi([{ text: lessonJson }]).generateLesson(lessonInput)
      return ai.generateFlashcards({ notebookName: 'Data Structures', topic, lesson, sources, count: 2 })
    }
  },
  {
    task: 'explanation',
    schema: EXPLANATION_JSON_SCHEMA,
    documents: 2,
    response: explanationJson,
    run: (ai) => ai.gradeExplanation({ topic, prompt: 'Explain BST search.', rubric: ['Ordering', 'O(h) search'], explanation: 'Smaller keys go left.', sources })
  },
  {
    task: 'summary',
    schema: SUMMARY_JSON_SCHEMA,
    documents: 1,
    response: summaryJson,
    run: (ai) => ai.summarizeSource({ notebookName: 'Data Structures', source: sources[0] })
  }
]

function cacheBreakpoints(params: BetaMessageStreamParams): number {
  let count = 0
  const system = Array.isArray(params.system) ? params.system : []
  for (const block of system) if (block.cache_control) count++
  for (const message of params.messages) {
    if (typeof message.content === 'string') continue
    for (const block of message.content) if ('cache_control' in block && block.cache_control) count++
  }
  return count
}

/** Everything the docs require of one structured request to `model` for `task`. */
function expectDocumentedRequest(params: BetaMessageStreamParams, model: AiModelId, task: AiTask, schema: JsonSchema, documents: number): void {
  const haiku = model === 'claude-haiku-4-5'

  // Only these top-level fields: no thinking (Opus 5.5 always thinks; budget_tokens / disabled are 400s),
  // no temperature/top_p/top_k (400 on Opus 5.5), no tools or tool_choice, no stop sequences.
  const expectedKeys = ['max_tokens', 'messages', 'model', 'output_config', 'system', ...(haiku ? [] : ['betas', 'fallbacks'])]
  expect(Object.keys(params).sort()).toEqual(expectedKeys.sort())

  expect(params.model).toBe(model)
  expect(params.max_tokens).toBe(TASK_MAX_TOKENS[task][0])
  expect(params.max_tokens).toBeLessThanOrEqual(MODEL_MAX_OUTPUT_TOKENS[model])

  const format = { type: 'json_schema', schema }
  if (haiku) {
    // Haiku 4.5 rejects effort; it has no server-side fallback either.
    expect(params.output_config).toEqual({ format })
  } else {
    expect(params.output_config).toEqual({ effort: TASK_EFFORT[task], format })
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01'])
    expect(params.fallbacks).toBe('default')
  }

  expect(params.system).toEqual([{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }])

  // One user turn (no assistant prefill): documents first, the instruction last.
  expect(params.messages).toHaveLength(1)
  const [message] = params.messages
  expect(message.role).toBe('user')
  if (typeof message.content === 'string') throw new Error('expected content blocks')
  const blocks = message.content
  expect(blocks).toHaveLength(documents + 1)
  blocks.slice(0, -1).forEach((block, i) => {
    if (block.type !== 'document') throw new Error(`block ${i} is ${block.type}, expected a document`)
    for (const key of Object.keys(block)) expect(['type', 'source', 'title', 'context', 'cache_control']).toContain(key)
    expect(block.source).toEqual({ type: 'text', media_type: 'text/plain', data: expect.stringMatching(/\S/) })
    expect(block.title).toEqual(expect.stringMatching(/\S/))
    if (i === documents - 1) expect(block.cache_control).toEqual({ type: 'ephemeral' })
    else expect(block).not.toHaveProperty('cache_control')
  })
  const instruction = blocks[blocks.length - 1]
  expect(Object.keys(instruction).sort()).toEqual(['text', 'type'])
  expect(instruction.type).toBe('text')

  expect(cacheBreakpoints(params)).toBe(documents > 0 ? 2 : 1)
  // The body is plain JSON: nothing the SDK would drop or mangle on the wire.
  expect(JSON.parse(JSON.stringify(params))).toEqual(params)
}

describe('request body sent for each task', () => {
  for (const { task, schema, documents, run, response } of TASKS) {
    for (const model of MODELS) {
      it(`${task} on ${model}`, async () => {
        const ai = new TestStudyAi([{ text: response }], model)
        await run(ai)
        expect(ai.client.requests).toHaveLength(1)
        expectDocumentedRequest(ai.client.requests[0].params, model, task, schema, documents)
      })
    }
  }

  it('grading an explanation without files sends only the instruction, keeping the system breakpoint', async () => {
    const ai = new TestStudyAi([{ text: explanationJson }])
    await ai.gradeExplanation({ topic, prompt: 'Explain BST search.', rubric: ['Ordering'], explanation: 'Smaller keys go left.', sources: [] })
    expectDocumentedRequest(ai.client.requests[0].params, 'claude-opus-5-5', 'explanation', EXPLANATION_JSON_SCHEMA, 0)
  })

  it('the quiz top-up request has the same documented shape', async () => {
    const first = JSON.stringify({ questions: [JSON.parse(questionsJson).questions[0]] })
    const ai = new TestStudyAi([{ text: first }, { text: questionsJson }])
    await ai.generateQuestions(quizInput({ count: 3 }))
    expect(ai.client.requests).toHaveLength(2)
    for (const { params } of ai.client.requests) expectDocumentedRequest(params, 'claude-opus-5-5', 'quiz', QUESTIONS_JSON_SCHEMA, 2)
  })

  it('a lesson and its flashcards share a byte-identical cached prefix', async () => {
    const lessonAi = new TestStudyAi([{ text: lessonJson }])
    const lesson = await lessonAi.generateLesson(lessonInput)
    const cardsAi = new TestStudyAi([{ text: cardsJson }])
    await cardsAi.generateFlashcards({ notebookName: 'Data Structures', topic, lesson, sources: [...sources].reverse(), count: 2 })
    const prefix = (params: BetaMessageStreamParams): string => {
      const content = params.messages[0].content
      return JSON.stringify([params.system, typeof content === 'string' ? content : content.slice(0, -1)])
    }
    expect(prefix(cardsAi.client.requests[0].params)).toBe(prefix(lessonAi.client.requests[0].params))
  })

  it('the same lesson request is byte-identical every time (no timestamps or random ids)', async () => {
    const a = new TestStudyAi([{ text: lessonJson }])
    const b = new TestStudyAi([{ text: lessonJson }])
    await a.generateLesson(lessonInput)
    await b.generateLesson(lessonInput)
    expect(JSON.stringify(b.client.requests[0].params)).toBe(JSON.stringify(a.client.requests[0].params))
  })

  it('testConnection only reads the model (exact id) and sends no message', async () => {
    for (const model of MODELS) {
      const ai = new TestStudyAi([], model)
      await expect(ai.testConnection()).resolves.toMatchObject({ ok: true })
      expect(ai.client.retrieved).toEqual([model])
      expect(ai.client.requests).toHaveLength(0)
    }
  })
})

describe('output limits', () => {
  it('every task limit fits every model it can run on', () => {
    for (const [task, limits] of Object.entries(TASK_MAX_TOKENS)) {
      for (const model of MODELS) {
        for (const limit of limits) expect(limit, `${task} on ${model}`).toBeLessThanOrEqual(MODEL_MAX_OUTPUT_TOKENS[model])
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Failure handling on the wire
// ---------------------------------------------------------------------------

const summaryCall: StructuredCall<string> = {
  task: 'summary',
  model: 'claude-opus-5-5',
  instruction: 'Summarise.',
  sources,
  schema: SUMMARY_JSON_SCHEMA,
  validate: (json) => {
    const title = (json as { title?: unknown }).title
    if (typeof title !== 'string') throw new OutputError('title missing')
    return title
  },
  progress: { expectedChars: 100, startMessage: 'Reading', thinkingMessage: 'Thinking', describe: () => 'Writing' }
}

const badRequest = (message = 'Unexpected value(s) for the `anthropic-beta` header.'): InstanceType<typeof Anthropic.BadRequestError> =>
  new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message } }, undefined, new Headers())

describe('server-side fallback opt-in', () => {
  it('retries once without the opt-in when the request with it is rejected, then stops sending it', async () => {
    const client = new FakeClient([{ error: badRequest() }, { text: summaryJson }, { text: summaryJson }])
    await expect(runStructured(client, summaryCall)).resolves.toBe('Summary: Trees')
    const [first, retry] = client.requests.map((r) => r.params)
    expect(first.fallbacks).toBe('default')
    expect(retry).not.toHaveProperty('fallbacks')
    expect(retry).not.toHaveProperty('betas')
    // Everything else is unchanged.
    const { betas: _b, fallbacks: _f, ...rest } = first
    expect(retry).toEqual(rest)

    await runStructured(client, summaryCall)
    expect(client.requests[2].params).not.toHaveProperty('fallbacks')
  })

  it('reports a 400 the plain request shares, and keeps opting in next time', async () => {
    const client = new FakeClient([{ error: badRequest('prompt is too long') }, { error: badRequest('prompt is too long') }, { text: summaryJson }])
    await expect(runStructured(client, summaryCall)).rejects.toMatchObject({
      code: 'AI_BAD_OUTPUT',
      message: 'The AI service rejected the request: prompt is too long'
    })
    expect(client.requests).toHaveLength(2)
    await runStructured(client, summaryCall)
    expect(client.requests[2].params.fallbacks).toBe('default')
  })

  it('does not retry a 400 from Haiku, which never opts in', async () => {
    const client = new FakeClient([{ error: badRequest() }])
    await expect(runStructured(client, { ...summaryCall, model: 'claude-haiku-4-5' })).rejects.toMatchObject({ code: 'AI_BAD_OUTPUT' })
    expect(client.requests).toHaveLength(1)
  })

  it('does not retry other errors without the opt-in', async () => {
    const overloaded = new Anthropic.InternalServerError(529, { type: 'error', error: { type: 'overloaded_error', message: 'x' } }, undefined, new Headers())
    const client = new FakeClient([{ error: overloaded }])
    await expect(runStructured(client, summaryCall)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' })
    expect(client.requests).toHaveLength(1)
  })
})

describe('stop reasons', () => {
  it('model_context_window_exceeded fails at once as SOURCE_TOO_LARGE instead of retrying with more output room', async () => {
    const client = new FakeClient([{ text: '{"title": "Sum', stopReason: 'model_context_window_exceeded' }])
    await expect(runStructured(client, summaryCall)).rejects.toMatchObject({ code: 'SOURCE_TOO_LARGE' })
    expect(client.requests).toHaveLength(1)
  })

  it('a refusal names the flagged area when the API reports one', async () => {
    const client = new FakeClient([
      { stopReason: 'refusal', stopDetails: { type: 'refusal', category: 'cyber', explanation: null, recommended_model: null, fallback_credit_token: null, fallback_has_prefill_claim: false } }
    ])
    const error = await runStructured(client, summaryCall).catch((err: unknown) => err)
    expect(error).toMatchObject({ code: 'AI_REFUSED' })
    expect((error as Error).message).toMatch(/security/)
  })

  it('a refusal without a category gets the general message', async () => {
    const client = new FakeClient([{ stopReason: 'refusal' }])
    await expect(runStructured(client, summaryCall)).rejects.toMatchObject({
      code: 'AI_REFUSED',
      message: 'The AI declined to write this. Try different files or rephrase the topic.'
    })
  })
})

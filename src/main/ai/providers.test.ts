// StudyAi sends every task to the provider chosen in Settings: Claude, or a
// local model through Ollama (here a FakeOllama on 127.0.0.1). Demo mode
// wins over both, and a Claude client is never touched on the Ollama path.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LessonContent, OllamaContextSize } from '@shared/types'
import type { AiClient } from './client'
import { demoLesson } from './demo'
import { StudyAi, type AiConfig, type AiSourceDoc, type GenerateQuestionsInput, type TopicBrief } from './index'
import { forgetOllamaModelFacts, ollamaOutputTokens, ollamaQuestionsPerCall } from './ollama'
import { answer, FakeOllama } from './ollamaTestkit'
import {
  EXPLANATION_JSON_SCHEMA,
  FLASHCARDS_JSON_SCHEMA,
  LESSON_JSON_SCHEMA,
  questionsJsonSchema,
  SUMMARY_JSON_SCHEMA,
  SYLLABUS_JSON_SCHEMA
} from './schemas'

let fake: FakeOllama

beforeEach(async () => {
  fake = await FakeOllama.start()
})
afterEach(async () => {
  await fake.close()
  forgetOllamaModelFacts()
})

/** StudyAi whose Claude client must never be used. */
class OllamaOnlyAi extends StudyAi {
  constructor(config: () => AiConfig) {
    super(config)
  }

  protected override clientFor(): AiClient {
    throw new Error('The Claude client must not be used on the Ollama path')
  }
}

function ollamaAi(overrides: { model?: string | null; contextTokens?: OllamaContextSize; demo?: boolean } = {}): OllamaOnlyAi {
  return new OllamaOnlyAi(() => ({
    provider: 'ollama',
    baseUrl: fake.url,
    model: overrides.model === undefined ? 'qwen3:8b' : overrides.model,
    contextTokens: overrides.contextTokens ?? 16_384,
    demo: overrides.demo ?? false
  }))
}

const topic: TopicBrief = { id: 'topic-bst', title: 'Binary search trees', description: 'Insert, search and delete.', unitLabel: 'Week 5' }
const other: TopicBrief = { id: 'topic-heaps', title: 'Heaps', description: 'Binary heaps.', unitLabel: 'Week 6' }
const sources: AiSourceDoc[] = [{ name: 'Week 5 - Trees.pdf', kind: 'lecture', text: '[Page 1]\nA binary search tree keeps smaller keys on the left.' }]
const lessonInput = { notebookName: 'Data Structures', topic, sources, otherTopics: [other] }
const lessonJson = JSON.stringify(demoLesson(lessonInput))

function quizInput(overrides: Partial<GenerateQuestionsInput> = {}): GenerateQuestionsInput {
  return {
    notebookName: 'Data Structures',
    topics: [topic, other],
    primaryTopicId: topic.id,
    sources,
    types: ['tf'],
    count: 4,
    difficulty: 'mixed',
    mode: 'practice',
    weakFocus: [],
    avoidPrompts: [],
    ...overrides
  }
}

const tf = (prompt: string): Record<string, unknown> => ({
  topicIndex: 1,
  type: 'tf',
  prompt,
  options: ['True', 'False'],
  answer: 'True',
  acceptable: [],
  explanation: 'Smaller keys go left.',
  difficulty: 'easy',
  sourceRef: 'Week 5 - Trees.pdf, page 1'
})
const questions = (from: number, count: number): string => JSON.stringify({ questions: Array.from({ length: count }, (_, i) => tf(`Statement ${from + i}`)) })

function userContent(index: number): string {
  return fake.chatBodies()[index].messages[1].content
}

describe('StudyAi with Ollama', () => {
  it('extracts a syllabus', async () => {
    fake.chats.push(
      answer(
        JSON.stringify({
          courseCode: 'CS 201',
          topics: [{ title: 'Binary search trees', description: 'Insert and delete.', unitLabel: 'Week 5' }],
          exams: [{ name: 'Midterm', examDate: '2026-10-20', coversTopicTitles: ['Binary search trees'] }]
        })
      )
    )
    const result = await ollamaAi().extractSyllabus({ notebookName: 'DS', syllabus: { name: 'Syllabus.pdf', kind: 'syllabus', text: 'Week 5: BSTs' }, existingTopicTitles: [], todayDate: '2026-10-04' })
    expect(result.exams[0].examDate).toBe('2026-10-20')
    const body = fake.chatBodies()[0]
    expect(body.format).toEqual(SYLLABUS_JSON_SCHEMA)
    expect(body.options.temperature).toBe(0)
    expect(userContent(0)).toContain("Today's date is 2026-10-04.")
    expect(userContent(0)).toContain('<title>Syllabus.pdf</title>\n<context>Course syllabus: scope, schedule and exam dates.</context>')
  })

  it('writes a compact lesson', async () => {
    fake.chats.push(answer(lessonJson, { thinking: 'Plan: three parts.' }))
    const progress: string[] = []
    const lesson = await ollamaAi().generateLesson(lessonInput, { onProgress: (task, _p, message) => progress.push(`${task}:${message}`) })
    expect(lesson.chunks.every((c) => c.check.topicId === topic.id)).toBe(true)
    expect(progress).toContain('lesson:Planning your lesson')
    const body = fake.chatBodies()[0]
    expect(body.format).toEqual(LESSON_JSON_SCHEMA)
    expect(body.options.num_predict).toBe(ollamaOutputTokens('lesson')[0])
    expect(userContent(0)).toContain('Task: write a short lesson')
    expect(userContent(0)).toContain('"chunks": exactly 3 parts')
    expect(userContent(0)).toContain('1. Heaps')
    expect(userContent(0)).not.toContain('Binary heaps.')
  })

  it('writes a quiz with the compact instruction in one call when it fits, allowing only the chosen types', async () => {
    fake.chats.push(answer(questions(1, 4)))
    const result = await ollamaAi().generateQuestions(quizInput())
    expect(result.map((q) => q.prompt)).toEqual(['Statement 1', 'Statement 2', 'Statement 3', 'Statement 4'])
    const body = fake.chatBodies()[0]
    // The grammar only allows "tf", the one type asked for, and the outline in the prompt says so too.
    expect(body.format).toEqual(questionsJsonSchema(['tf']))
    expect(userContent(0)).toContain('"type": "tf", "prompt"')
    expect(body.options.num_predict).toBe(ollamaOutputTokens('quiz', 4)[0])
    expect(userContent(0)).toContain('Exactly 4 questions')
  })

  it('keeps topping up a long quiz while each call adds questions', async () => {
    // A 60-question mock exam where every call loses a fifth of what it was asked for to repeats.
    let next = 1
    const reply = (asked: number): string => {
      const fresh = asked - Math.floor(asked / 5)
      const items = [...JSON.parse(questions(next, fresh)).questions, ...Array.from({ length: asked - fresh }, () => tf('Statement 1'))]
      next += fresh
      return JSON.stringify({ questions: items })
    }
    // Six calls give 48 questions; the single top-up there used to be is not enough for the other 12.
    const asked = [10, 10, 10, 10, 10, 10, 10, 4]
    for (const n of asked) fake.chats.push(answer(reply(n)))
    const messages: string[] = []
    const result = await ollamaAi().generateQuestions(quizInput({ count: 60, mode: 'mock_exam' }), { onProgress: (_task, _p, message) => messages.push(message) })
    expect(result.map((q) => q.prompt)).toEqual(Array.from({ length: 60 }, (_, i) => `Statement ${i + 1}`))
    expect(fake.chatBodies().map((b) => b.options.num_predict)).toEqual(asked.map((n) => ollamaOutputTokens('quiz', n)[0]))
    expect(messages).toContain('Writing 4 more questions')
  })

  it('stops topping up when a call adds nothing new, then fills the gap with repeats of older quizzes', async () => {
    const avoidPrompts = Array.from({ length: 30 }, (_, i) => `Old ${i + 1}`)
    const old = (from: number, count: number): Record<string, unknown>[] => Array.from({ length: count }, (_, i) => tf(`Old ${from + i}`))
    fake.chats.push(
      answer(JSON.stringify({ questions: [...JSON.parse(questions(1, 7)).questions, ...old(25, 3)] })),
      answer(JSON.stringify({ questions: [...old(28, 3)] }))
    )
    const result = await ollamaAi().generateQuestions(quizInput({ count: 10, avoidPrompts }))
    expect(result.map((q) => q.prompt)).toEqual([...Array.from({ length: 7 }, (_, i) => `Statement ${i + 1}`), 'Old 25', 'Old 26', 'Old 27'])
    expect(fake.sent('/api/chat')).toHaveLength(2)
  })

  it("repairs a local model's multiple-choice slips instead of dropping the question", async () => {
    const mc = (answerText: string, options: string[]): Record<string, unknown> => ({
      ...tf('What is the cost of a search in a balanced BST?'),
      type: 'mc',
      options,
      answer: answerText
    })
    fake.chats.push(answer(JSON.stringify({ questions: [mc('C) O(log n)', ['A) O(1)', 'B) O(n)', 'C) O(log n)', 'D) O(n log n)'])] })))
    const [question] = await ollamaAi().generateQuestions(quizInput({ count: 1, types: ['mc'] }))
    expect(question).toMatchObject({ type: 'mc', options: ['O(1)', 'O(n)', 'O(log n)', 'O(n log n)'], answer: 'O(log n)' })
    expect(fake.sent('/api/chat')).toHaveLength(1)
  })

  it('writes a big quiz in several calls, each told what was already written, then tops up once', async () => {
    expect(ollamaQuestionsPerCall(16_384)).toBe(10)
    // 25 questions: 10 + 10 + 5, the third call loses one to a repeat, so one top-up asks for 1 more.
    fake.chats.push(answer(questions(1, 10)), answer(questions(11, 10)), answer(JSON.stringify({ questions: [tf('Statement 1'), ...JSON.parse(questions(21, 4)).questions] })), answer(questions(25, 1)))
    const fractions: number[] = []
    const messages: string[] = []
    const result = await ollamaAi().generateQuestions(quizInput({ count: 25 }), {
      onProgress: (_task, p, message) => {
        if (p !== null) fractions.push(p)
        messages.push(message)
      }
    })
    expect(result.map((q) => q.prompt)).toEqual(Array.from({ length: 25 }, (_, i) => `Statement ${i + 1}`))
    expect(fake.chatBodies().map((b) => b.options.num_predict)).toEqual([10, 10, 5, 1].map((n) => ollamaOutputTokens('quiz', n)[0]))
    expect(userContent(0)).toContain('Exactly 10 questions')
    expect(userContent(1)).toContain('"Statement 10"')
    expect(userContent(2)).toContain('Exactly 5 questions')
    expect(userContent(3)).toContain('Exactly 1 questions')
    expect(messages).toContain('Writing 1 more question')
    expect(messages.some((m) => /^Writing question 1[1-9] of 25$/.test(m))).toBe(true)
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b))
  })

  it('writes flashcards from a shortened digest of a long lesson', async () => {
    const long = demoLesson(lessonInput) as unknown as LessonContent
    const lesson: LessonContent = { ...long, chunks: long.chunks.map((c) => ({ ...c, body: `${c.body}\n\n${'More detail about trees. '.repeat(600)}` })) }
    const cards = [
      { front: 'Where do smaller keys go?', back: 'Left.', sourceRef: '' },
      { front: 'What is h?', back: 'The height.', sourceRef: '' },
      { front: 'What is a leaf?', back: ' ', sourceRef: '' }
    ]
    fake.chats.push(answer(JSON.stringify({ cards })))
    // The blank card is dropped, not the deck.
    await expect(ollamaAi().generateFlashcards({ notebookName: 'DS', topic, lesson, sources, count: 2 })).resolves.toHaveLength(2)
    expect(userContent(0)).toContain('- 2 cards, all different.')
    const body = fake.chatBodies()[0]
    expect(body.format).toEqual(FLASHCARDS_JSON_SCHEMA)
    expect(body.options.num_predict).toBe(ollamaOutputTokens('flashcards', 2)[0])
    const lessonPart = userContent(0).slice(userContent(0).indexOf('<lesson>'), userContent(0).indexOf('</lesson>'))
    expect(lessonPart.length).toBeLessThan(6_500)
    expect(lessonPart).toContain('## Key terms')
  })

  it('grades an explanation', async () => {
    fake.chats.push(answer(JSON.stringify({ score: 70, covered: ['Ordering'], missing: [], misconceptions: ['None'], suggestion: 'Trace a search.' })))
    const feedback = await ollamaAi().gradeExplanation({ topic, prompt: 'Explain BSTs.', rubric: ['Ordering'], explanation: 'Smaller keys go left.', sources })
    expect(feedback.score).toBe(70)
    // A placeholder isn't shown as a misconception.
    expect(feedback.misconceptions).toEqual([])
    expect(fake.chatBodies()[0].format).toEqual(EXPLANATION_JSON_SCHEMA)
    expect(fake.chatBodies()[0].options.temperature).toBe(0)
  })

  it('summarises a source in fewer words', async () => {
    fake.chats.push(answer(JSON.stringify({ title: 'Summary: Trees', summary: '## Key ideas\n- Left is smaller.' })))
    await expect(ollamaAi().summarizeSource({ notebookName: 'DS', source: sources[0] })).resolves.toMatchObject({ title: 'Summary: Trees' })
    expect(fake.chatBodies()[0].format).toEqual(SUMMARY_JSON_SCHEMA)
    expect(userContent(0)).toContain('about 200-500 words')
  })

  it('asks for a model before contacting Ollama', async () => {
    const ai = ollamaAi({ model: null })
    const calls: Promise<unknown>[] = [
      ai.extractSyllabus({ notebookName: 'DS', syllabus: sources[0], existingTopicTitles: [], todayDate: '2026-10-04' }),
      ai.generateLesson(lessonInput),
      ai.generateQuestions(quizInput()),
      ai.generateFlashcards({ notebookName: 'DS', topic, lesson: {} as LessonContent, sources, count: 2 }),
      ai.gradeExplanation({ topic, prompt: 'Explain.', rubric: [], explanation: 'x', sources }),
      ai.summarizeSource({ notebookName: 'DS', source: sources[0] })
    ]
    for (const call of calls) await expect(call).rejects.toMatchObject({ code: 'NO_AI_MODEL', message: 'Choose an Ollama model in Settings.' })
    expect(fake.requests).toHaveLength(0)
  })

  it('lets demo mode win over Ollama', async () => {
    const ai = ollamaAi({ demo: true })
    await expect(ai.generateLesson(lessonInput)).resolves.toMatchObject({ title: expect.any(String) })
    await expect(ai.testConnection()).resolves.toMatchObject({ ok: true, message: expect.stringContaining('Demo mode') })
    expect(fake.requests).toHaveLength(0)
  })

  it('tests the Ollama connection, not Claude', async () => {
    fake.tags = { status: 200, body: { models: [{ name: 'qwen3:8b', size: 1 }] } }
    await expect(ollamaAi().testConnection()).resolves.toEqual({ ok: true, message: 'Connected. qwen3:8b is ready to use.' })
    await expect(ollamaAi({ model: null }).testConnection()).resolves.toEqual({ ok: false, message: 'Choose an Ollama model in Settings.' })
  })
})

describe('StudyAi with Claude', () => {
  it('never contacts Ollama and still asks for a key', async () => {
    const ai = new StudyAi(() => ({ provider: 'claude', apiKey: null, model: 'claude-opus-5-5', demo: false }))
    await expect(ai.generateLesson(lessonInput)).rejects.toMatchObject({ code: 'NO_API_KEY' })
    expect(fake.requests).toHaveLength(0)
  })
})

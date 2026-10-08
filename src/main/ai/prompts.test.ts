import { describe, expect, it } from 'vitest'
import type { AiSourceDoc, GenerateQuestionsInput, TopicBrief } from './index'
import {
  compactLessonDigest,
  compactLessonInstruction,
  explanationInstruction,
  flashcardsInstruction,
  jsonOutline,
  lessonDigest,
  lessonInstruction,
  questionsInstruction,
  summaryInstruction,
  SYSTEM_PROMPT
} from './prompts'
import { LESSON_JSON_SCHEMA, rawLessonSchema, SYLLABUS_JSON_SCHEMA } from './schemas'

const topic: TopicBrief = { id: 't1', title: 'Hash tables', description: 'Hashing and collision resolution.', unitLabel: 'Week 4' }
const sources: AiSourceDoc[] = [{ name: 'Week 4.pdf', kind: 'lecture', text: '[Page 1]\nA hash function maps keys to buckets.' }]

describe('SYSTEM_PROMPT', () => {
  it('asks for Markdown code and KaTeX math, and forbids trivia questions', () => {
    expect(SYSTEM_PROMPT).toMatch(/fenced code blocks with a language tag/)
    expect(SYSTEM_PROMPT).toMatch(/\$\.\.\.\$ inline and \$\$\.\.\.\$\$/)
    expect(SYSTEM_PROMPT).toContain('Never use \\( \\) or \\[ \\]')
    expect(SYSTEM_PROMPT).toMatch(/never about the documents themselves/)
  })

  it('never asks the model to write out its own reasoning (that is declined as reasoning extraction)', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/think step by step|show your (reasoning|thinking)|scratchpad|<thinking>/i)
  })
})

describe('lessonInstruction', () => {
  it('asks every part to name the files and pages it draws on, and to cover all the topic material', () => {
    const text = lessonInstruction({ notebookName: 'Data Structures', topic, sources, otherTopics: [] })
    expect(text).toContain('*Source: Lecture 05 - Deadlocks.pdf, pages 3-6*')
    expect(text).toMatch(/cover all of them/)
  })

  it('does not ask for source lines when there are no files', () => {
    const text = lessonInstruction({ notebookName: 'Data Structures', topic, sources: [], otherTopics: [] })
    expect(text).not.toContain('*Source:')
    expect(text).toContain('No course files are attached')
  })
})

describe('questionsInstruction', () => {
  const input: GenerateQuestionsInput = {
    notebookName: 'Data Structures',
    topics: [topic],
    primaryTopicId: 't1',
    sources,
    types: ['mc', 'tf', 'fill', 'identification'],
    count: 4,
    difficulty: 'mixed',
    mode: 'practice',
    weakFocus: [],
    avoidPrompts: []
  }

  it('gives a quality rule for each requested type', () => {
    const text = questionsInstruction(input, { count: 4, alreadyWritten: [] })
    expect(text).toMatch(/Each distractor is a specific mistake/)
    expect(text).toMatch(/not a trick word, a negation or a double negative/)
    expect(text).toMatch(/not inside code or math/)
    expect(text).toMatch(/not its textbook definition reworded/)
  })

  it('only describes the requested types', () => {
    const text = questionsInstruction({ ...input, types: ['tf'] }, { count: 4, alreadyWritten: [] })
    expect(text).toContain('"tf" (true or false)')
    expect(text).not.toContain('"mc" (multiple choice)')
  })
})

describe('explanationInstruction', () => {
  it('grades Feynman-style: gaps phrased as what is missing, and one actionable next step', () => {
    const text = explanationInstruction({ topic, prompt: 'Explain hashing.', rubric: ['Buckets'], explanation: 'Keys go to buckets.', sources })
    expect(text).toMatch(/Feynman test/)
    expect(text).toMatch(/a term used without saying what it means/)
    expect(text).toMatch(/"missing": each gap/)
    expect(text).toMatch(/"suggestion": the single most useful next step/)
    expect(text).toContain('<explanation>\nKeys go to buckets.\n</explanation>')
  })
})

describe('compact variants for local models', () => {
  const others: TopicBrief[] = Array.from({ length: 40 }, (_, i) => ({ id: `o${i}`, title: `Topic ${i}`, description: 'A long description. '.repeat(30), unitLabel: `Week ${i}` }))

  it('asks for a compact lesson that still meets every minimum the lesson validator checks', () => {
    const text = compactLessonInstruction({ notebookName: 'Data Structures', topic, sources, otherTopics: others })
    expect(text).toContain('"warmup": exactly 2 questions')
    expect(text).toContain('"chunks": exactly 3 parts')
    expect(text).toContain('"keyTerms": 3-5 terms')
    expect(text).toContain('"explainRubric": 3-4 short')
    expect(text).toContain('*Source: Lecture 05 - Deadlocks.pdf, pages 3-6*')
    // Other topics by title only, and at most 30 of them.
    expect(text).toContain('30. Topic 29')
    expect(text).not.toContain('31. Topic 30')
    expect(text).not.toContain('A long description.')
    expect(text.length).toBeLessThan(lessonInstruction({ notebookName: 'Data Structures', topic, sources, otherTopics: others }).length / 2)

    // A lesson at exactly those minimums passes validation.
    const question = { type: 'tf', prompt: 'Q', options: ['True', 'False'], answer: 'True', explanation: 'E', difficulty: 'easy', sourceRef: '' }
    const minimal = {
      title: 'Hash tables',
      overview: 'O',
      estMinutes: 12,
      warmup: [question, question],
      chunks: [1, 2, 3].map((i) => ({ heading: `H${i}`, body: 'B', example: '', check: question })),
      keyTerms: [1, 2, 3].map((i) => ({ term: `T${i}`, definition: 'D' })),
      connections: [],
      explainPrompt: 'Explain hashing.',
      explainRubric: ['a', 'b', 'c']
    }
    expect(rawLessonSchema.safeParse(minimal).success).toBe(true)
  })

  it('keeps the quiz instruction short with long lists, and leaves the default unchanged', () => {
    const input: GenerateQuestionsInput = {
      notebookName: 'Data Structures',
      topics: [topic, ...others.slice(0, 10)],
      primaryTopicId: null,
      sources,
      types: ['mc'],
      count: 5,
      difficulty: 'mixed',
      mode: 'weak_spots',
      weakFocus: [{ topicId: 'o1', title: 'Topic 1', recentMistakes: ['m1', 'm2', 'm3', 'm4', 'm5'] }],
      avoidPrompts: Array.from({ length: 60 }, (_, i) => `Old question ${i} ${'x'.repeat(200)}`)
    }
    const full = questionsInstruction(input, { count: 5, alreadyWritten: [] })
    expect(questionsInstruction(input, { count: 5, alreadyWritten: [] }, {})).toBe(full)
    const compact = questionsInstruction(input, { count: 5, alreadyWritten: [] }, { compact: true })
    expect(compact.length).toBeLessThan(full.length / 2)
    expect(compact).toContain('Old question 19')
    expect(compact).not.toContain('Old question 20')
    expect(compact).toContain('"m3"')
    expect(compact).not.toContain('"m4"')
    expect(full).toContain('Old question 59')
  })

  it('shows a local model the questions it wrote last and some from recent quizzes', () => {
    const input: GenerateQuestionsInput = {
      notebookName: 'Data Structures',
      topics: [topic],
      primaryTopicId: topic.id,
      sources,
      types: ['tf'],
      count: 10,
      difficulty: 'mixed',
      mode: 'mock_exam',
      weakFocus: [],
      avoidPrompts: Array.from({ length: 30 }, (_, i) => `Old question ${i + 1}`)
    }
    const alreadyWritten = Array.from({ length: 30 }, (_, i) => `Written ${i + 1}`)
    const compact = questionsInstruction(input, { count: 10, alreadyWritten }, { compact: true })
    expect(compact).toContain('"Written 30"')
    expect(compact).toContain('"Written 17"')
    expect(compact).not.toContain('"Written 16"')
    expect(compact).toContain('"Old question 6"')
    expect(compact).not.toContain('"Old question 7"')
    // Claude sees everything in order, as before.
    const full = questionsInstruction(input, { count: 10, alreadyWritten })
    expect(full).toContain('"Written 1"')
    expect(full).toContain('"Old question 30"')
  })

  it('asks a local model for the number of flashcards outright, and Claude for up to that many', () => {
    const input = { notebookName: 'DS', topic, lessonSummary: '# Hash tables', sources, count: 8 }
    expect(flashcardsInstruction(input)).toContain('- Up to 8 cards, all different. Cover every key term')
    expect(flashcardsInstruction(input, { compact: true })).toContain('- 8 cards, all different. Cover every key term')
  })

  it('asks for a shorter summary only in the compact style', () => {
    const source = sources[0]
    expect(summaryInstruction({ notebookName: 'DS', source })).toContain('about 300-900 words')
    expect(summaryInstruction({ notebookName: 'DS', source }, { compact: true })).toContain('about 200-500 words')
  })

  it('cuts a long lesson digest to size, keeping headings and key terms', () => {
    const lesson = {
      title: 'Hash tables',
      overview: 'Buckets.',
      chunks: [1, 2, 3, 4].map((i) => ({ heading: `Part heading ${i}`, body: 'Long body text. '.repeat(500), example: 'Example. '.repeat(100) })),
      keyTerms: [{ term: 'Load factor', definition: 'Items per bucket.' }]
    }
    const short = { ...lesson, chunks: lesson.chunks.map((c) => ({ ...c, body: 'Short.', example: '' })) }
    expect(compactLessonDigest(short, 6_000)).toBe(lessonDigest(short))
    const digest = compactLessonDigest(lesson, 6_000)
    expect(digest.length).toBeLessThanOrEqual(6_100)
    for (let i = 1; i <= 4; i++) expect(digest).toContain(`## Part ${i}: Part heading ${i}`)
    expect(digest).toContain('- Load factor: Items per bucket.')
  })

  it('outlines a JSON schema compactly', () => {
    expect(jsonOutline(SYLLABUS_JSON_SCHEMA)).toBe(
      '{"courseCode": string, "topics": [{"title": string, "description": string, "unitLabel": string}, ...], "exams": [{"name": string, "examDate": string | null, "coversTopicTitles": [string, ...]}, ...]}'
    )
    const outline = jsonOutline(LESSON_JSON_SCHEMA)
    expect(outline).toContain('"type": "mc" | "tf"')
    expect(outline.length).toBeLessThan(JSON.stringify(LESSON_JSON_SCHEMA).length / 3)
  })
})

// Output contracts for every AI task: the JSON Schema sent as
// `output_config.format` (structured outputs only accept a subset: no
// numeric/length/array-size constraints, `additionalProperties: false` and
// every property required), the zod schema that validates what comes back,
// and the conversion into domain types. The model never invents ids: ids
// are assigned here and topics are mapped from a 1-based `topicIndex`.

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { QUESTION_TYPES } from '@shared/types'
import type {
  Difficulty,
  ExplanationFeedback,
  ID,
  KeyTerm,
  LessonChunk,
  LessonContent,
  Question,
  QuestionType
} from '@shared/types'
import type { GeneratedCard, SyllabusExtraction, TopicBrief } from './index'

/** The model's output was unusable; `message` says why (and is fed back on the retry). */
export class OutputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutputError'
  }
}

// ---------------------------------------------------------------------------
// JSON Schema builders
// ---------------------------------------------------------------------------

export type JsonSchema = { [key: string]: unknown }

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const

function described(schema: JsonSchema, description?: string): JsonSchema {
  return description ? { ...schema, description } : schema
}

const str = (description?: string): JsonSchema => described({ type: 'string' }, description)
const int = (description?: string): JsonSchema => described({ type: 'integer' }, description)
const arr = (items: JsonSchema, description?: string): JsonSchema => described({ type: 'array', items }, description)
const strEnum = (values: readonly string[], description?: string): JsonSchema => described({ type: 'string', enum: [...values] }, description)

function obj(properties: Record<string, JsonSchema>): JsonSchema {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }
}

const lessonQuestionJson = obj({
  type: strEnum(['mc', 'tf']),
  prompt: str('The question (Markdown).'),
  options: arr(str(), 'mc: 3-5 choices. tf: exactly ["True", "False"].'),
  answer: str('Copied exactly from options.'),
  explanation: str('Why the answer is right and why the tempting wrong answers are wrong (Markdown).'),
  difficulty: strEnum(DIFFICULTIES),
  sourceRef: str('File and page/slide, e.g. "Lecture 05.pdf, page 12". Empty when there are no files.')
})

const quizQuestionJson = obj({
  topicIndex: int('Number of the topic this question is about, from the numbered topic list.'),
  type: strEnum(QUESTION_TYPES),
  prompt: str('The question (Markdown). For fill, contains ____ where the blank is.'),
  options: arr(str(), 'mc: 3-5 choices. tf: exactly ["True", "False"]. fill/identification: [].'),
  answer: str('mc/tf: copied exactly from options. fill/identification: the expected word or short phrase.'),
  acceptable: arr(str(), 'fill/identification: other correct answers (synonyms, spellings). [] for mc/tf.'),
  explanation: str('Why the answer is right and why the tempting wrong answers are wrong (Markdown).'),
  difficulty: strEnum(DIFFICULTIES),
  sourceRef: str('File and page/slide, e.g. "Lecture 05.pdf, page 12". Empty when there are no files.')
})

export const LESSON_JSON_SCHEMA: JsonSchema = obj({
  title: str(),
  overview: str('One paragraph: what this topic is and why it matters.'),
  estMinutes: int('Realistic minutes to work through the whole lesson.'),
  warmup: arr(lessonQuestionJson, 'Exactly 2 pre-test questions answerable by intuition.'),
  chunks: arr(
    obj({
      heading: str(),
      body: str('Teaching text (Markdown).'),
      example: str('A worked example (Markdown), or "" when none.'),
      check: lessonQuestionJson
    }),
    '3-6 parts in teaching order.'
  ),
  keyTerms: arr(obj({ term: str(), definition: str('One or two sentences.') }), '5-10 terms.'),
  connections: arr(str(), 'How this topic links to the other listed topics.'),
  explainPrompt: str('e.g. "Explain X to a first-year student."'),
  explainRubric: arr(str(), '4-6 points a good explanation covers.')
})

export const QUESTIONS_JSON_SCHEMA: JsonSchema = obj({ questions: arr(quizQuestionJson) })

export const FLASHCARDS_JSON_SCHEMA: JsonSchema = obj({
  cards: arr(
    obj({
      front: str('A question answerable from memory (Markdown).'),
      back: str('Short, complete answer (Markdown).'),
      sourceRef: str('File and page/slide, or "" when unknown.')
    })
  )
})

export const EXPLANATION_JSON_SCHEMA: JsonSchema = obj({
  score: int('0-100.'),
  covered: arr(str(), 'Rubric points the explanation gets right (short phrases).'),
  missing: arr(str(), 'Rubric points that are missing or too vague (short phrases).'),
  misconceptions: arr(str(), 'Statements that are wrong, each with the correction (short phrases).'),
  suggestion: str('One concrete thing to add or fix.')
})

export const SYLLABUS_JSON_SCHEMA: JsonSchema = obj({
  courseCode: str('e.g. "CS 201"; "" when not found.'),
  topics: arr(obj({ title: str(), description: str(), unitLabel: str('e.g. "Week 4"; "" when none.') }), 'In course order.'),
  exams: arr(
    obj({
      name: str(),
      examDate: described({ anyOf: [{ type: 'string' }, { type: 'null' }] }, 'YYYY-MM-DD, or null when no date is given.'),
      coversTopicTitles: arr(str(), 'Exact titles from "topics".')
    })
  )
})

export const SUMMARY_JSON_SCHEMA: JsonSchema = obj({
  title: str('Short title for the summary note.'),
  summary: str('The study summary (Markdown).')
})

// ---------------------------------------------------------------------------
// Zod schemas for the raw model output
// ---------------------------------------------------------------------------

const text = z.string().trim().min(1)

/** Structured outputs don't guarantee the casing of enum values (e.g. "Medium"), so match them case-insensitively. */
function looseEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess((value) => (typeof value === 'string' ? value.trim().toLowerCase() : value), z.enum(values))
}

const rawLessonQuestion = z.object({
  type: looseEnum(['mc', 'tf']),
  prompt: text,
  options: z.array(z.string()),
  answer: text,
  explanation: text,
  difficulty: looseEnum(DIFFICULTIES),
  sourceRef: z.string()
})

const rawQuizQuestion = z.object({
  topicIndex: z.number().int(),
  type: looseEnum(QUESTION_TYPES),
  prompt: text,
  options: z.array(z.string()),
  answer: text,
  acceptable: z.array(z.string()),
  explanation: text,
  difficulty: looseEnum(DIFFICULTIES),
  sourceRef: z.string()
})

export const rawLessonSchema = z.object({
  title: text,
  overview: text,
  estMinutes: z.number().int(),
  warmup: z.array(rawLessonQuestion).min(2),
  chunks: z
    .array(z.object({ heading: text, body: text, example: z.string(), check: rawLessonQuestion }))
    .min(3)
    .max(6),
  keyTerms: z.array(z.object({ term: text, definition: text })).min(3),
  connections: z.array(z.string()),
  explainPrompt: text,
  explainRubric: z.array(text).min(3)
})

// Questions are validated one by one so a single bad item doesn't throw away a whole quiz.
export const rawQuestionsSchema = z.object({ questions: z.array(z.unknown()) })

export const rawFlashcardsSchema = z.object({
  cards: z.array(z.object({ front: text, back: text, sourceRef: z.string() }))
})

export const rawExplanationSchema = z.object({
  score: z.number(),
  covered: z.array(z.string()),
  missing: z.array(z.string()),
  misconceptions: z.array(z.string()),
  suggestion: z.string()
})

export const rawSyllabusSchema = z.object({
  courseCode: z.string(),
  topics: z.array(z.object({ title: z.string(), description: z.string(), unitLabel: z.string() })),
  exams: z.array(z.object({ name: z.string(), examDate: z.string().nullable(), coversTopicTitles: z.array(z.string()) }))
})

export const rawSummarySchema = z.object({ title: text, summary: text })

export type RawLesson = z.infer<typeof rawLessonSchema>
export type RawLessonQuestion = z.infer<typeof rawLessonQuestion>
export type RawQuizQuestion = z.infer<typeof rawQuizQuestion>
export type RawFlashcards = z.infer<typeof rawFlashcardsSchema>
export type RawExplanation = z.infer<typeof rawExplanationSchema>
export type RawSyllabus = z.infer<typeof rawSyllabusSchema>
export type RawSummary = z.infer<typeof rawSummarySchema>

function parseWith<T>(schema: z.ZodType<T>, json: unknown): T {
  const result = schema.safeParse(json)
  if (result.success) return result.data
  const details = result.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.length ? issue.path.join('.') : 'output'}: ${issue.message}`)
    .join('; ')
  throw new OutputError(`The JSON did not match the schema (${details}).`)
}

// ---------------------------------------------------------------------------
// Question normalisation (shared by lessons and quizzes)
// ---------------------------------------------------------------------------

export const TF_OPTIONS = ['True', 'False']
export const BLANK = '____'

interface QuestionDraft {
  type: QuestionType
  prompt: string
  options: string[]
  answer: string
  acceptable: string[]
  explanation: string
  difficulty: Difficulty
  sourceRef: string
}

function uniqueTrimmed(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    const key = trimmed.toLowerCase()
    if (!trimmed || seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

/**
 * Enforces the question rules the UI relies on (tf options, mc answer is an
 * option, fill has a blank), repairing harmless slips such as "true" or an
 * answer given as "B". Returns an error message when it can't be repaired.
 */
export function finalizeQuestion(draft: QuestionDraft, topicId: ID | null): Question | string {
  const prompt = draft.prompt.trim()
  const base = {
    id: randomUUID(),
    type: draft.type,
    prompt,
    explanation: draft.explanation.trim(),
    topicId,
    difficulty: draft.difficulty,
    sourceRef: draft.sourceRef.trim()
  }
  const answer = draft.answer.trim()

  switch (draft.type) {
    case 'tf': {
      const normalized = /^(true|t|yes)\.?$/i.test(answer) ? 'True' : /^(false|f|no)\.?$/i.test(answer) ? 'False' : null
      if (!normalized) return `a true/false answer must be "True" or "False", got "${answer}"`
      return { ...base, options: [...TF_OPTIONS], answer: normalized, acceptable: [] }
    }
    case 'mc': {
      const options = uniqueTrimmed(draft.options)
      if (options.length < 3 || options.length > 5) return `a multiple-choice question needs 3-5 distinct options, got ${options.length}`
      const exact = options.find((o) => o === answer) ?? options.find((o) => o.toLowerCase() === answer.toLowerCase())
      const letter = /^\(?([A-Ea-e])[).:]?$/.exec(answer)
      const byLetter = letter ? options[letter[1].toUpperCase().charCodeAt(0) - 65] : undefined
      const resolved = exact ?? byLetter
      if (!resolved) return `the multiple-choice answer "${answer}" is not one of the options`
      return { ...base, options, answer: resolved, acceptable: [] }
    }
    case 'fill': {
      const withBlank = prompt.replace(/_{3,}/g, BLANK)
      if (!withBlank.includes(BLANK)) return `a fill-in-the-blank prompt must contain ${BLANK}`
      const acceptable = uniqueTrimmed(draft.acceptable).filter((a) => a.toLowerCase() !== answer.toLowerCase())
      return { ...base, prompt: withBlank, options: [], answer, acceptable }
    }
    case 'identification': {
      const acceptable = uniqueTrimmed(draft.acceptable).filter((a) => a.toLowerCase() !== answer.toLowerCase())
      return { ...base, options: [], answer, acceptable }
    }
  }
}

function finalizeLessonQuestion(raw: RawLessonQuestion, topicId: ID, where: string): Question {
  const result = finalizeQuestion({ ...raw, acceptable: [] }, topicId)
  if (typeof result === 'string') throw new OutputError(`${where}: ${result}.`)
  return result
}

// ---------------------------------------------------------------------------
// Per-task conversion into domain types
// ---------------------------------------------------------------------------

const MAX_KEY_TERMS = 10
const MAX_RUBRIC = 6

export function parseLessonOutput(json: unknown, context: { topic: TopicBrief; sourceNames: string[] }): LessonContent {
  const raw = parseWith(rawLessonSchema, json)
  const topicId = context.topic.id
  const warmup = raw.warmup.slice(0, 2).map((q, i) => finalizeLessonQuestion(q, topicId, `warmup ${i + 1}`))
  const chunks: LessonChunk[] = raw.chunks.map((chunk, i) => ({
    heading: chunk.heading.trim(),
    body: chunk.body.trim(),
    example: chunk.example.trim(),
    check: finalizeLessonQuestion(chunk.check, topicId, `chunk ${i + 1} check`)
  }))
  const seenTerms = new Set<string>()
  const keyTerms: KeyTerm[] = []
  for (const kt of raw.keyTerms) {
    const key = kt.term.toLowerCase()
    if (seenTerms.has(key)) continue
    seenTerms.add(key)
    keyTerms.push({ term: kt.term, definition: kt.definition })
  }
  return {
    title: raw.title,
    overview: raw.overview,
    estMinutes: clamp(raw.estMinutes, 5, 180),
    warmup,
    chunks,
    keyTerms: keyTerms.slice(0, MAX_KEY_TERMS),
    connections: uniqueTrimmed(raw.connections),
    explainPrompt: raw.explainPrompt,
    explainRubric: uniqueTrimmed(raw.explainRubric).slice(0, MAX_RUBRIC),
    sourcesUsed: context.sourceNames.length > 0 ? [...context.sourceNames] : ['No files: based on the topic description']
  }
}

export interface QuestionsContext {
  topics: TopicBrief[]
  primaryTopicId: ID | null
  types: QuestionType[]
  difficulty: Difficulty | 'mixed'
}

export interface ParsedQuestions {
  questions: Question[]
  /** Why individual items were dropped (fed back to the model when topping up). */
  rejected: string[]
}

/** Maps the model's 1-based topicIndex to an input topic id, falling back to the primary (or only) topic. */
export function topicIdForIndex(index: number, context: Pick<QuestionsContext, 'topics' | 'primaryTopicId'>): ID | null {
  const topic = context.topics[index - 1]
  if (topic) return topic.id
  if (context.primaryTopicId) return context.primaryTopicId
  return context.topics.length === 1 ? context.topics[0].id : null
}

export function parseQuestionsOutput(json: unknown, context: QuestionsContext): ParsedQuestions {
  const raw = parseWith(rawQuestionsSchema, json)
  const allowed = new Set(context.types)
  const questions: Question[] = []
  const rejected: string[] = []
  raw.questions.forEach((item, i) => {
    const parsed = rawQuizQuestion.safeParse(item)
    if (!parsed.success) {
      rejected.push(`question ${i + 1} did not match the schema`)
      return
    }
    const q = parsed.data
    if (!allowed.has(q.type)) {
      rejected.push(`question ${i + 1} used type "${q.type}", which was not allowed`)
      return
    }
    const difficulty = context.difficulty === 'mixed' ? q.difficulty : context.difficulty
    const result = finalizeQuestion({ ...q, difficulty }, topicIdForIndex(q.topicIndex, context))
    if (typeof result === 'string') rejected.push(`question ${i + 1}: ${result}`)
    else questions.push(result)
  })
  return { questions, rejected }
}

/** Case/space/punctuation-insensitive key used to spot repeated prompts and cards. */
export function promptKey(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .trim()
}

export function parseFlashcardsOutput(json: unknown, context: { count: number }): GeneratedCard[] {
  const raw = parseWith(rawFlashcardsSchema, json)
  const seen = new Set<string>()
  const cards: GeneratedCard[] = []
  for (const card of raw.cards) {
    const key = promptKey(card.front)
    if (seen.has(key)) continue
    seen.add(key)
    cards.push({ front: card.front.trim(), back: card.back.trim(), sourceRef: card.sourceRef.trim() })
  }
  // Fewer cards than asked is fine (a short lesson has fewer ideas), but not a near-empty deck.
  const minimum = Math.min(context.count, Math.max(1, Math.ceil(context.count / 2)))
  if (cards.length < minimum) throw new OutputError(`Only ${cards.length} distinct cards were written; ${context.count} were requested.`)
  return cards.slice(0, context.count)
}

export function parseExplanationOutput(json: unknown): ExplanationFeedback {
  const raw = parseWith(rawExplanationSchema, json)
  return {
    score: clamp(Math.round(raw.score), 0, 100),
    covered: uniqueTrimmed(raw.covered),
    missing: uniqueTrimmed(raw.missing),
    misconceptions: uniqueTrimmed(raw.misconceptions),
    suggestion: raw.suggestion.trim()
  }
}

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** True for a real calendar date written as YYYY-MM-DD. */
export function isValidLocalDate(value: string): boolean {
  const match = LOCAL_DATE.exec(value)
  if (!match) return false
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

export function parseSyllabusOutput(json: unknown, context: { existingTopicTitles: string[] }): SyllabusExtraction {
  const raw = parseWith(rawSyllabusSchema, json)
  const titleKey = (title: string): string => title.trim().toLowerCase().replace(/\s+/g, ' ')
  const existing = new Map(context.existingTopicTitles.map((t) => [titleKey(t), t.trim()]))

  const topics: SyllabusExtraction['topics'] = []
  const outputTitles = new Map<string, string>()
  for (const topic of raw.topics) {
    const title = topic.title.trim()
    const key = titleKey(title)
    if (!title || existing.has(key) || outputTitles.has(key)) continue
    outputTitles.set(key, title)
    topics.push({ title, description: topic.description.trim(), unitLabel: topic.unitLabel.trim() })
  }

  const exams: SyllabusExtraction['exams'] = raw.exams
    .filter((exam) => exam.name.trim())
    .map((exam) => {
      const date = exam.examDate?.trim() ?? ''
      // Exams can cover topics extracted earlier, so existing titles count as matches too.
      const covers = uniqueTrimmed(
        exam.coversTopicTitles.map((t) => outputTitles.get(titleKey(t)) ?? existing.get(titleKey(t)) ?? '').filter(Boolean)
      )
      return { name: exam.name.trim(), examDate: isValidLocalDate(date) ? date : null, coversTopicTitles: covers }
    })

  return { courseCode: raw.courseCode.trim(), topics, exams }
}

export function parseSummaryOutput(json: unknown): { title: string; summary: string } {
  const raw = parseWith(rawSummarySchema, json)
  return { title: raw.title, summary: raw.summary }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

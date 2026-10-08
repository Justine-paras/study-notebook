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

const quizQuestionJson = (types: readonly QuestionType[]): JsonSchema =>
  obj({
    topicIndex: int('Number of the topic this question is about, from the numbered topic list.'),
    type: strEnum(types),
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

/**
 * The quiz schema with "type" limited to `types`. A local model gets this
 * narrower one: Ollama turns the schema into a grammar, so the model can't
 * write a question type the learner turned off.
 */
export function questionsJsonSchema(types: readonly QuestionType[]): JsonSchema {
  return obj({ questions: arr(quizQuestionJson(types)) })
}

export const QUESTIONS_JSON_SCHEMA: JsonSchema = questionsJsonSchema(QUESTION_TYPES)

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

// ---------------------------------------------------------------------------
// Repairs for local models
// ---------------------------------------------------------------------------
//
// A small local model gets the JSON shape right (Ollama enforces the schema)
// but makes slips Claude doesn't: options lettered "A) ...", an answer like
// "C) O(n)" or "O(n).", a true/false question written as multiple choice, a
// blank entry in a list, "None" in a list that should be empty, a date
// written out in words, a topic title reworded with "&". With `lenient`, the
// parsers repair these before the usual checks instead of throwing a whole
// answer away; anything ambiguous is still rejected. Claude's answers are
// parsed without it, exactly as before.

const OPTION_LETTER = /^\(?([A-Ea-e])[).:]\s+/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBlank(value: unknown): boolean {
  return typeof value === 'string' && !value.trim()
}

function letterIndex(letter: string): number {
  return letter.toUpperCase().charCodeAt(0) - 65
}

/** An option or answer without its letter, final period, spacing and case, for matching. */
function choiceKey(text: string): string {
  return text.trim().replace(OPTION_LETTER, '').replace(/[.\s]+$/, '').toLowerCase()
}

/** The option an answer names, or null when that isn't certain. */
function resolveChoice(options: string[], raw: string): string | null {
  const answer = raw.trim()
  const exact = options.find((o) => o === answer) ?? options.find((o) => o.toLowerCase() === answer.toLowerCase())
  if (exact) return exact
  const bare = /^\(?([A-Ea-e])[).:]?$/.exec(answer)
  if (bare) return options[letterIndex(bare[1])] ?? null
  const byText = options.filter((o) => choiceKey(o) === choiceKey(answer))
  if (byText.length !== 1) return null
  // "C) O(n)": the letter has to point at the option the text names.
  const lettered = OPTION_LETTER.exec(answer)
  if (lettered && options[letterIndex(lettered[1])] !== byText[0]) return null
  return byText[0]
}

/**
 * Fixes a local model's multiple-choice slips: letters in front of the
 * options, an answer that names its option with a letter or a final period,
 * and ["True", "False"] options (made a true/false question when `allowTf`).
 * Other question types pass through unchanged.
 */
export function repairChoiceQuestion<T extends { type: QuestionType; options: string[]; answer: string }>(question: T, allowTf: boolean): T {
  if (question.type !== 'mc') return question
  let options = question.options.map((o) => o.trim()).filter(Boolean)
  if (options.length >= 2 && options.every((o, i) => OPTION_LETTER.exec(o)?.[1].toUpperCase() === String.fromCharCode(65 + i))) {
    options = options.map((o) => o.replace(OPTION_LETTER, ''))
  }
  const answer = resolveChoice(options, question.answer) ?? question.answer
  const isTrueFalse = options.length === 2 && options.every((o) => /^(true|false)$/i.test(o)) && options[0].toLowerCase() !== options[1].toLowerCase()
  if (allowTf && isTrueFalse) return { ...question, type: 'tf', options: [...TF_OPTIONS], answer } as T
  return { ...question, options, answer }
}

/** Drops blank entries from a lesson's lists: a trailing "" rubric point, a key term without a definition. */
function tidyLessonJson(json: unknown): unknown {
  if (!isRecord(json)) return json
  const strings = (value: unknown): unknown => (Array.isArray(value) ? value.filter((v) => !isBlank(v)) : value)
  return {
    ...json,
    explainRubric: strings(json.explainRubric),
    connections: strings(json.connections),
    keyTerms: Array.isArray(json.keyTerms) ? json.keyTerms.filter((k) => !(isRecord(k) && (isBlank(k.term) || isBlank(k.definition)))) : json.keyTerms
  }
}

/** Drops cards with a blank front or back, so one doesn't throw away the deck. */
function tidyFlashcardsJson(json: unknown): unknown {
  if (!isRecord(json) || !Array.isArray(json.cards)) return json
  return { ...json, cards: json.cards.filter((card) => !(isRecord(card) && (isBlank(card.front) || isBlank(card.back)))) }
}

/** "None", "N/A", "No misconceptions found." standing in for an empty list. */
const PLACEHOLDER_ENTRY = /^(none|n\/a|nothing|no (misconceptions?|gaps?|issues?|errors?|mistakes?)( (found|identified))?)\.?$/i

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** A date written out ("October 20, 2026", "Tue, Oct. 20 2026", "20 October 2026") as YYYY-MM-DD, or null. */
export function parseWrittenDate(text: string): string | null {
  const flat = text
    .trim()
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.? /i, '')
  const monthFirst = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)? (\d{4})$/i.exec(flat)
  const dayFirst = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.? (\d{4})$/i.exec(flat)
  const [month, day, year] = monthFirst ? [monthFirst[1], monthFirst[2], monthFirst[3]] : dayFirst ? [dayFirst[2], dayFirst[1], dayFirst[3]] : []
  if (!month || !day || !year) return null
  const name = month.toLowerCase()
  const index = MONTHS.findIndex((m) => m === name || (name.length >= 3 && m.startsWith(name)))
  if (index < 0) return null
  const iso = `${year}-${String(index + 1).padStart(2, '0')}-${day.padStart(2, '0')}`
  return isValidLocalDate(iso) ? iso : null
}

/** A topic title for loose matching: "&" read as "and", punctuation and spacing ignored. */
function looseTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
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

/** `lenient`: repair a local model's slips first (see "Repairs for local models"). */
export function parseLessonOutput(json: unknown, context: { topic: TopicBrief; sourceNames: string[]; lenient?: boolean }): LessonContent {
  const raw = parseWith(rawLessonSchema, context.lenient ? tidyLessonJson(json) : json)
  const topicId = context.topic.id
  const repair = (q: RawLessonQuestion): RawLessonQuestion => (context.lenient ? repairChoiceQuestion(q, true) : q)
  const warmup = raw.warmup.slice(0, 2).map((q, i) => finalizeLessonQuestion(repair(q), topicId, `warmup ${i + 1}`))
  const chunks: LessonChunk[] = raw.chunks.map((chunk, i) => ({
    heading: chunk.heading.trim(),
    body: chunk.body.trim(),
    example: chunk.example.trim(),
    check: finalizeLessonQuestion(repair(chunk.check), topicId, `chunk ${i + 1} check`)
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
  /** Repair a local model's slips first (see "Repairs for local models"). */
  lenient?: boolean
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
    const q = context.lenient ? repairChoiceQuestion(parsed.data, allowed.has('tf')) : parsed.data
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

/** `lenient`: drop blank cards instead of rejecting the deck (see "Repairs for local models"). */
export function parseFlashcardsOutput(json: unknown, context: { count: number; lenient?: boolean }): GeneratedCard[] {
  const raw = parseWith(rawFlashcardsSchema, context.lenient ? tidyFlashcardsJson(json) : json)
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

/** `lenient`: drop "None"-style placeholder entries (see "Repairs for local models"). */
export function parseExplanationOutput(json: unknown, options: { lenient?: boolean } = {}): ExplanationFeedback {
  const raw = parseWith(rawExplanationSchema, json)
  const list = (values: string[]): string[] => {
    const unique = uniqueTrimmed(values)
    return options.lenient ? unique.filter((v) => !PLACEHOLDER_ENTRY.test(v)) : unique
  }
  return {
    score: clamp(Math.round(raw.score), 0, 100),
    covered: list(raw.covered),
    missing: list(raw.missing),
    misconceptions: list(raw.misconceptions),
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

/** `lenient`: accept written-out dates and loosely matching topic titles (see "Repairs for local models"). */
export function parseSyllabusOutput(json: unknown, context: { existingTopicTitles: string[]; lenient?: boolean }): SyllabusExtraction {
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

  const loose = new Map<string, string>()
  if (context.lenient) {
    for (const title of [...existing.values(), ...outputTitles.values()]) loose.set(looseTitleKey(title), title)
  }
  const knownTitle = (t: string): string =>
    outputTitles.get(titleKey(t)) ?? existing.get(titleKey(t)) ?? (context.lenient ? loose.get(looseTitleKey(t)) : undefined) ?? ''

  const exams: SyllabusExtraction['exams'] = raw.exams
    .filter((exam) => exam.name.trim())
    .map((exam) => {
      const date = exam.examDate?.trim() ?? ''
      const examDate = isValidLocalDate(date) ? date : context.lenient ? parseWrittenDate(date) : null
      // Exams can cover topics extracted earlier, so existing titles count as matches too.
      const covers = uniqueTrimmed(exam.coversTopicTitles.map(knownTitle).filter(Boolean))
      return { name: exam.name.trim(), examDate, coversTopicTitles: covers }
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

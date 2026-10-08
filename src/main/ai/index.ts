// The AI engine: every AI call goes through `StudyAi`, which sends it to
// Claude (the Anthropic API) or to a local model through Ollama, as chosen
// in Settings. Demo mode wins over both.
// OWNER: ai agent. Other files in src/main/ai/ (prompts, schemas, demo
// outputs, client helpers) are the ai agent's to create.

import type {
  AiModelId,
  AiTask,
  Difficulty,
  ExplanationFeedback,
  ID,
  LessonContent,
  OllamaContextSize,
  Question,
  QuestionType,
  QuizKind,
  SourceKind
} from '@shared/types'
import { AppError, ERROR_MESSAGES } from '@shared/errors'
import { clientForKey, countKey, mapAiError, runStructured, type AiClient, type ProgressPlan } from './client'
import { demoExplanation, demoFlashcards, demoLesson, demoQuestions, demoSummary, demoSyllabus } from './demo'
import { ollamaQuestionsPerCall, runOllamaStructured, testOllamaConnection, type OllamaCall, type OllamaTarget } from './ollama'
import {
  compactLessonDigest,
  compactLessonInstruction,
  explanationInstruction,
  flashcardsInstruction,
  lessonDigest,
  lessonInstruction,
  questionsInstruction,
  summaryInstruction,
  syllabusInstruction,
  type PromptStyle
} from './prompts'
import {
  EXPLANATION_JSON_SCHEMA,
  FLASHCARDS_JSON_SCHEMA,
  LESSON_JSON_SCHEMA,
  OutputError,
  parseExplanationOutput,
  parseFlashcardsOutput,
  parseLessonOutput,
  parseQuestionsOutput,
  parseSummaryOutput,
  parseSyllabusOutput,
  promptKey,
  QUESTIONS_JSON_SCHEMA,
  questionsJsonSchema,
  SUMMARY_JSON_SCHEMA,
  SYLLABUS_JSON_SCHEMA,
  type QuestionsContext
} from './schemas'
import { orderSources } from './sources'

export interface ClaudeAiConfig {
  provider: 'claude'
  apiKey: string | null
  model: AiModelId
  /** Offline demo mode: deterministic canned outputs built from the inputs, no network. */
  demo: boolean
}

export interface OllamaAiConfig {
  provider: 'ollama'
  /** Normalized server address, e.g. "http://127.0.0.1:11434". */
  baseUrl: string
  /** The installed model to use; null until the learner picks one. */
  model: string | null
  /** num_ctx for every request, which also sizes how much of the files fits. */
  contextTokens: OllamaContextSize
  /** Offline demo mode: deterministic canned outputs built from the inputs, no network. */
  demo: boolean
}

export type AiConfig = ClaudeAiConfig | OllamaAiConfig

export interface AiSourceDoc {
  name: string
  kind: SourceKind
  text: string
}

export interface CallOptions {
  /** Called as output streams in. `progress` is a rough 0-1 estimate or null. */
  onProgress?: (task: AiTask, progress: number | null, message: string) => void
  signal?: AbortSignal
}

export interface TopicBrief {
  id: ID
  title: string
  description: string
  unitLabel: string
}

export interface SyllabusExtraction {
  /** e.g. "CS 201"; empty when not found. */
  courseCode: string
  /** In course order. */
  topics: { title: string; description: string; unitLabel: string }[]
  exams: { name: string; examDate: string | null; coversTopicTitles: string[] }[]
}

export interface GenerateQuestionsInput {
  notebookName: string
  /** Topics questions may be about. Every returned question's topicId is one of these ids. */
  topics: TopicBrief[]
  /** The topic most questions should target (practice step); null for cross-topic quizzes. */
  primaryTopicId: ID | null
  sources: AiSourceDoc[]
  types: QuestionType[]
  count: number
  difficulty: Difficulty | 'mixed'
  mode: QuizKind
  /** Topics the learner keeps missing, with example mistakes, to target. */
  weakFocus: { topicId: ID; title: string; recentMistakes: string[] }[]
  /** Prompts already asked recently; avoid repeating them. */
  avoidPrompts: string[]
}

export interface GeneratedCard {
  front: string
  back: string
  sourceRef: string
}

// Rough sizes of a finished answer (characters of JSON), for progress estimates.
const LESSON_CHARS = 28_000
const COMPACT_LESSON_CHARS = 10_000
const QUESTION_CHARS = 900
const CARD_CHARS = 260
/** A Claude-written lesson can be ~30,000 characters; a local model's flashcard call gets a shorter digest of it. */
const COMPACT_DIGEST_CHARS = 6_000
/** Top-up calls a local model gets beyond the ones its quiz's shortfall needs (Claude gets exactly one). */
const LOCAL_EXTRA_TOP_UPS = 2

/** One structured task, provider-neutral: the runner adds the model. */
type TaskCall<T> = OllamaCall<T>
/** Runs one structured task on the configured provider. */
type Runner = <T>(call: TaskCall<T>, options?: CallOptions) => Promise<T>

export class StudyAi {
  constructor(private readonly getConfig: () => AiConfig) {}

  /** Reads a syllabus: course code, topics in course order, exams with dates (YYYY-MM-DD, resolved against `todayDate`'s year when the year is missing). */
  async extractSyllabus(
    input: { notebookName: string; syllabus: AiSourceDoc; existingTopicTitles: string[]; todayDate: string },
    options?: CallOptions
  ): Promise<SyllabusExtraction> {
    const config = this.getConfig()
    // A local model's harmless slips are repaired rather than rejected; Claude's answers are parsed as they always were.
    const lenient = config.provider === 'ollama'
    const validate = (json: unknown): SyllabusExtraction => parseSyllabusOutput(json, { existingTopicTitles: input.existingTopicTitles, lenient })
    if (config.demo) return this.demo('syllabus', options, () => validate(demoSyllabus(input)))
    return this.run(config, (run) =>
      run(
        {
          task: 'syllabus',
          instruction: syllabusInstruction(input),
          sources: [input.syllabus],
          schema: SYLLABUS_JSON_SCHEMA,
          validate,
          progress: {
            expectedChars: 6_000,
            startMessage: 'Reading your syllabus',
            thinkingMessage: 'Working out the course schedule',
            describe: (text) => {
              if (countKey(text, 'exams') > 0) return 'Finding exam dates'
              const found = countKey(text, 'unitLabel')
              return found > 0 ? `Found ${found} topic${found === 1 ? '' : 's'} so far` : 'Reading the schedule'
            }
          }
        },
        options
      )
    )
  }

  /** An in-depth, chunked lesson with warm-up and check questions (ids assigned, topicId set to topic.id). */
  async generateLesson(
    input: { notebookName: string; topic: TopicBrief; sources: AiSourceDoc[]; otherTopics: TopicBrief[] },
    options?: CallOptions
  ): Promise<LessonContent> {
    const sourceNames = orderSources(input.sources).map((s) => s.name)
    const config = this.getConfig()
    const local = config.provider === 'ollama'
    const validate = (json: unknown): LessonContent => parseLessonOutput(json, { topic: input.topic, sourceNames, lenient: local })
    if (config.demo) return this.demo('lesson', options, () => validate(demoLesson(input)))
    return this.run(config, (run) =>
      run(
        {
          task: 'lesson',
          instruction: local ? compactLessonInstruction(input) : lessonInstruction(input),
          sources: input.sources,
          schema: LESSON_JSON_SCHEMA,
          validate,
          progress: lessonProgress(local ? COMPACT_LESSON_CHARS : LESSON_CHARS)
        },
        options
      )
    )
  }

  /** Exactly `count` questions using only `types` (ids assigned, topicId mapped to input topic ids). */
  async generateQuestions(input: GenerateQuestionsInput, options?: CallOptions): Promise<Question[]> {
    if (input.count < 1 || input.types.length === 0 || input.topics.length === 0) {
      throw new AppError('INVALID_INPUT', 'A quiz needs at least one question, one question type and one topic.')
    }
    const config = this.getConfig()
    const local = config.provider === 'ollama'
    const context: QuestionsContext = {
      topics: input.topics,
      primaryTopicId: input.primaryTopicId,
      types: input.types,
      difficulty: input.difficulty,
      lenient: local
    }

    if (config.demo) {
      return this.demo('quiz', options, () => {
        const parsed = parseQuestionsOutput(demoQuestions(input), context)
        return requireCount(collectQuestions([], parsed.questions, input), input.count)
      })
    }

    const style: PromptStyle | undefined = local ? { compact: true } : undefined
    // A local model writes a big quiz in several smaller calls; Claude writes it in one.
    const perCall = config.provider === 'ollama' ? ollamaQuestionsPerCall(config.contextTokens) : input.count
    // A local model's grammar allows only the chosen question types.
    const schema = local ? questionsJsonSchema(input.types) : QUESTIONS_JSON_SCHEMA
    return this.run(config, async (run) => {
      const batch = async (count: number, alreadyWritten: string[], batchOptions: CallOptions | undefined, progress: ProgressPlan): Promise<Question[]> =>
        run(
          {
            task: 'quiz',
            instruction: questionsInstruction(input, { count, alreadyWritten }, style),
            sources: input.sources,
            schema,
            validate: (json) => {
              const parsed = parseQuestionsOutput(json, context)
              if (parsed.questions.length === 0) throw new OutputError(`None of the questions were usable (${parsed.rejected.slice(0, 3).join('; ')}).`)
              return parsed.questions
            },
            progress,
            itemCount: count
          },
          batchOptions
        )

      let questions: Question[] = []
      // A local model is shown only a few of the recent quizzes' prompts, so its repeats of the others are kept as a last resort.
      const spares: Question[] | undefined = local ? [] : undefined
      const calls = Math.ceil(input.count / perCall)
      for (let i = 0; i < calls && questions.length < input.count; i++) {
        const count = Math.min(perCall, input.count - questions.length)
        // Each call fills its share of the first 90% of the job's progress bar.
        const callOptions = calls === 1 ? options : progressSlice(options, (0.9 * i) / calls, (0.9 * (i + 1)) / calls)
        const written = questions.length
        const more = await batch(count, questions.map((q) => q.prompt), callOptions, quizProgress(count, written, input.count))
        questions = collectQuestions(questions, more, input, spares)
      }
      // Top-up calls when items were dropped or the model wrote too few: one for
      // Claude; a few for a local model, which drops a question or two in most
      // calls, each asking for what is still missing until one adds nothing new.
      const topUps = local ? Math.ceil((input.count - questions.length) / perCall) + LOCAL_EXTRA_TOP_UPS : 1
      for (let t = 0; t < topUps && questions.length < input.count; t++) {
        const missing = Math.min(perCall, input.count - questions.length)
        const onProgress = options?.onProgress
        // Top-ups continue the job's progress bar (its last 9%) instead of starting it again from zero.
        const from = 0.9 + (0.09 * t) / topUps
        const span = 0.09 / topUps
        const topUpOptions: CallOptions = {
          signal: options?.signal,
          onProgress: onProgress && ((task, p) => onProgress(task, p === null ? null : from + span * p, `Writing ${missing} more question${missing === 1 ? '' : 's'}`))
        }
        const before = questions.length
        const more = await batch(
          missing,
          questions.map((q) => q.prompt),
          topUpOptions,
          quizProgress(missing)
        )
        questions = collectQuestions(questions, more, input, spares)
        if (questions.length === before) break
      }
      return requireCount(spares ? fillFromSpares(questions, spares, input.count) : questions, input.count)
    })
  }

  /** Recall-style flashcards (one idea per card, answerable from memory). */
  async generateFlashcards(
    input: { notebookName: string; topic: TopicBrief; lesson: LessonContent; sources: AiSourceDoc[]; count: number },
    options?: CallOptions
  ): Promise<GeneratedCard[]> {
    const config = this.getConfig()
    const local = config.provider === 'ollama'
    const validate = (json: unknown): GeneratedCard[] => parseFlashcardsOutput(json, { count: input.count, lenient: local })
    if (config.demo) return this.demo('flashcards', options, () => validate(demoFlashcards(input)))
    const digest = local ? (lesson: LessonContent) => compactLessonDigest(lesson, COMPACT_DIGEST_CHARS) : lessonDigest
    const style: PromptStyle | undefined = local ? { compact: true } : undefined
    return this.run(config, (run) =>
      run(
        {
          task: 'flashcards',
          instruction: flashcardsInstruction({ ...input, lessonSummary: digest(input.lesson) }, style),
          sources: input.sources,
          schema: FLASHCARDS_JSON_SCHEMA,
          validate,
          itemCount: input.count,
          progress: {
            expectedChars: CARD_CHARS * input.count,
            startMessage: 'Reviewing the lesson',
            thinkingMessage: 'Choosing what to remember',
            describe: (text) => `Writing card ${Math.max(1, Math.min(countKey(text, 'front'), input.count))} of ${input.count}`
          }
        },
        options
      )
    )
  }

  /** Grades a "teach it back" explanation against the rubric and the sources. */
  async gradeExplanation(
    input: { topic: TopicBrief; prompt: string; rubric: string[]; explanation: string; sources: AiSourceDoc[] },
    options?: CallOptions
  ): Promise<ExplanationFeedback> {
    const config = this.getConfig()
    if (config.demo) return this.demo('explanation', options, () => parseExplanationOutput(demoExplanation(input)))
    const lenient = config.provider === 'ollama'
    return this.run(config, (run) =>
      run(
        {
          task: 'explanation',
          instruction: explanationInstruction(input),
          sources: input.sources,
          schema: EXPLANATION_JSON_SCHEMA,
          validate: (json) => parseExplanationOutput(json, { lenient }),
          progress: {
            expectedChars: 1_500,
            startMessage: 'Reading your explanation',
            thinkingMessage: 'Checking it against the rubric and your files',
            describe: (text) => (countKey(text, 'suggestion') > 0 ? 'Writing a suggestion' : 'Writing your feedback')
          }
        },
        options
      )
    )
  }

  /** A Markdown study summary of one source. */
  async summarizeSource(input: { notebookName: string; source: AiSourceDoc }, options?: CallOptions): Promise<{ title: string; summary: string }> {
    const config = this.getConfig()
    if (config.demo) return this.demo('summary', options, () => parseSummaryOutput(demoSummary(input)))
    const style: PromptStyle | undefined = config.provider === 'ollama' ? { compact: true } : undefined
    return this.run(config, (run) =>
      run(
        {
          task: 'summary',
          instruction: summaryInstruction(input, style),
          sources: [input.source],
          schema: SUMMARY_JSON_SCHEMA,
          validate: parseSummaryOutput,
          progress: {
            expectedChars: 5_000,
            startMessage: `Reading ${input.source.name}`,
            thinkingMessage: 'Picking out the key ideas',
            describe: (text) =>
              /Likely exam points/i.test(text) ? 'Listing likely exam points' : /Definitions/.test(text) ? 'Collecting definitions' : 'Writing the key ideas'
          }
        },
        options
      )
    )
  }

  /** Checks the configured provider works (Claude: a tiny request with the key; Ollama: server, model, context size). Never throws. */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const config = this.getConfig()
      if (config.demo) return { ok: true, message: 'Demo mode is on: AI features use offline sample content, so no key is needed.' }
      if (config.provider === 'ollama') return await testOllamaConnection(config)
      if (!config.apiKey) return { ok: false, message: ERROR_MESSAGES.NO_API_KEY }
      const model = await this.clientFor(config.apiKey).models.retrieve(config.model)
      return { ok: true, message: `Connected. ${model.display_name} is ready to use.` }
    } catch (err) {
      const error = mapAiError(err)
      return { ok: false, message: error.code === 'UNKNOWN' ? ERROR_MESSAGES.UNKNOWN : error.message }
    }
  }

  /** The SDK client for a key. Overridable so tests can substitute a fake transport. */
  protected clientFor(apiKey: string): AiClient {
    return clientForKey(apiKey)
  }

  /**
   * Runs `body` with a runner for the configured provider. Claude: the key is
   * checked first and one client serves every call of the task. Ollama: a
   * model must be chosen; every error is already an AppError.
   */
  private async run<T>(config: AiConfig, body: (run: Runner) => Promise<T>): Promise<T> {
    if (config.provider === 'ollama') {
      if (!config.model) throw new AppError('NO_AI_MODEL', ERROR_MESSAGES.NO_AI_MODEL)
      const target: OllamaTarget = { baseUrl: config.baseUrl, model: config.model, contextTokens: config.contextTokens }
      return body((call, options) => runOllamaStructured(target, call, options))
    }
    return this.call(config, (client) =>
      body((call, options) => {
        // itemCount only sizes a local model's answer.
        const { itemCount, ...rest } = call
        void itemCount
        return runStructured(client, { ...rest, model: config.model }, options)
      })
    )
  }

  private async call<T>(config: ClaudeAiConfig, run: (client: AiClient) => Promise<T>): Promise<T> {
    if (!config.apiKey) throw new AppError('NO_API_KEY', ERROR_MESSAGES.NO_API_KEY)
    try {
      return await run(this.clientFor(config.apiKey))
    } catch (err) {
      throw mapAiError(err)
    }
  }

  /** Demo output still goes through validation, so a bad template fails loudly in tests. */
  private async demo<T>(task: AiTask, options: CallOptions | undefined, build: () => T): Promise<T> {
    if (options?.signal?.aborted) throw new AppError('UNKNOWN', 'The AI request was cancelled.')
    options?.onProgress?.(task, 0.5, 'Writing (demo mode)')
    try {
      return build()
    } catch (err) {
      if (err instanceof OutputError) throw new AppError('AI_BAD_OUTPUT', `Demo output was invalid: ${err.message}`)
      throw err
    }
  }
}

function lessonProgress(expectedChars: number): ProgressPlan {
  return {
    expectedChars,
    startMessage: 'Reading your files',
    thinkingMessage: 'Planning your lesson',
    describe: (text) => {
      if (countKey(text, 'explainPrompt') > 0) return 'Preparing the explain-it step'
      if (countKey(text, 'keyTerms') > 0) return 'Adding key terms and connections'
      const part = countKey(text, 'heading')
      return part > 0 ? `Writing part ${part} of the lesson` : 'Writing the warm-up questions'
    }
  }
}

/** Progress for one call writing `count` questions, after `written` of a quiz of `total`. */
function quizProgress(count: number, written = 0, total = count): ProgressPlan {
  return {
    expectedChars: QUESTION_CHARS * count,
    startMessage: 'Reading your files',
    thinkingMessage: 'Planning your questions',
    describe: (text) => `Writing question ${written + Math.max(1, Math.min(countKey(text, 'prompt'), count))} of ${total}`
  }
}

/** Maps one call's 0-1 progress onto [from, to] of the job's progress bar. */
function progressSlice(options: CallOptions | undefined, from: number, to: number): CallOptions {
  const onProgress = options?.onProgress
  return {
    signal: options?.signal,
    onProgress: onProgress && ((task, p, message) => onProgress(task, p === null ? null : from + (to - from) * p, message))
  }
}

/** Adds new questions, skipping repeats of earlier ones and of recently asked prompts (kept in `spares` when given). */
function collectQuestions(existing: Question[], incoming: Question[], input: GenerateQuestionsInput, spares?: Question[]): Question[] {
  const seen = new Set([...input.avoidPrompts, ...existing.map((q) => q.prompt)].map(promptKey))
  const result = [...existing]
  for (const question of incoming) {
    const key = promptKey(question.prompt)
    if (seen.has(key)) {
      spares?.push(question)
      continue
    }
    seen.add(key)
    result.push(question)
  }
  return result
}

/**
 * Completes a local model's quiz that is still short with questions it
 * dropped for repeating an earlier quiz's prompt: the learner has seen them
 * before, but that beats losing every question already written. Repeats
 * within this quiz are never used.
 */
function fillFromSpares(questions: Question[], spares: Question[], count: number): Question[] {
  const seen = new Set(questions.map((q) => promptKey(q.prompt)))
  const result = [...questions]
  for (const question of spares) {
    if (result.length >= count) break
    const key = promptKey(question.prompt)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(question)
  }
  return result
}

function requireCount(questions: Question[], count: number): Question[] {
  if (questions.length < count) {
    throw new AppError('AI_BAD_OUTPUT', `The AI wrote ${questions.length} usable questions instead of ${count}. Try again.`)
  }
  return questions.slice(0, count)
}

// The AI engine: every call to Claude goes through `StudyAi`.
// OWNER: ai agent. Other files in src/main/ai/ (prompts, schemas, demo
// outputs, client helpers) are the ai agent's to create.

import type {
  AiModelId,
  AiTask,
  Difficulty,
  ExplanationFeedback,
  ID,
  LessonContent,
  Question,
  QuestionType,
  QuizKind,
  SourceKind
} from '@shared/types'
import { AppError, ERROR_MESSAGES } from '@shared/errors'
import { clientForKey, countKey, mapAiError, runStructured, type AiClient, type ProgressPlan } from './client'
import { demoExplanation, demoFlashcards, demoLesson, demoQuestions, demoSummary, demoSyllabus } from './demo'
import {
  explanationInstruction,
  flashcardsInstruction,
  lessonDigest,
  lessonInstruction,
  questionsInstruction,
  summaryInstruction,
  syllabusInstruction
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
  SUMMARY_JSON_SCHEMA,
  SYLLABUS_JSON_SCHEMA,
  type QuestionsContext
} from './schemas'
import { orderSources } from './sources'

export interface AiConfig {
  apiKey: string | null
  model: AiModelId
  /** Offline demo mode: deterministic canned outputs built from the inputs, no network. */
  demo: boolean
}

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
const QUESTION_CHARS = 900
const CARD_CHARS = 260

export class StudyAi {
  constructor(private readonly getConfig: () => AiConfig) {}

  /** Reads a syllabus: course code, topics in course order, exams with dates (YYYY-MM-DD, resolved against `todayDate`'s year when the year is missing). */
  async extractSyllabus(
    input: { notebookName: string; syllabus: AiSourceDoc; existingTopicTitles: string[]; todayDate: string },
    options?: CallOptions
  ): Promise<SyllabusExtraction> {
    const validate = (json: unknown): SyllabusExtraction => parseSyllabusOutput(json, { existingTopicTitles: input.existingTopicTitles })
    const config = this.getConfig()
    if (config.demo) return this.demo('syllabus', options, () => validate(demoSyllabus(input)))
    return this.call(config, (client) =>
      runStructured(
        client,
        {
          task: 'syllabus',
          model: config.model,
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
    const validate = (json: unknown): LessonContent => parseLessonOutput(json, { topic: input.topic, sourceNames })
    const config = this.getConfig()
    if (config.demo) return this.demo('lesson', options, () => validate(demoLesson(input)))
    return this.call(config, (client) =>
      runStructured(
        client,
        {
          task: 'lesson',
          model: config.model,
          instruction: lessonInstruction(input),
          sources: input.sources,
          schema: LESSON_JSON_SCHEMA,
          validate,
          progress: lessonProgress()
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
    const context: QuestionsContext = {
      topics: input.topics,
      primaryTopicId: input.primaryTopicId,
      types: input.types,
      difficulty: input.difficulty
    }
    const config = this.getConfig()

    if (config.demo) {
      return this.demo('quiz', options, () => {
        const parsed = parseQuestionsOutput(demoQuestions(input), context)
        return requireCount(collectQuestions([], parsed.questions, input), input.count)
      })
    }

    return this.call(config, async (client) => {
      const batch = async (count: number, alreadyWritten: string[], batchOptions: CallOptions | undefined): Promise<Question[]> =>
        runStructured(
          client,
          {
            task: 'quiz',
            model: config.model,
            instruction: questionsInstruction(input, { count, alreadyWritten }),
            sources: input.sources,
            schema: QUESTIONS_JSON_SCHEMA,
            validate: (json) => {
              const parsed = parseQuestionsOutput(json, context)
              if (parsed.questions.length === 0) throw new OutputError(`None of the questions were usable (${parsed.rejected.slice(0, 3).join('; ')}).`)
              return parsed.questions
            },
            progress: quizProgress(count)
          },
          batchOptions
        )

      let questions = collectQuestions([], await batch(input.count, [], options), input)
      // One top-up call when items were dropped or the model wrote too few.
      if (questions.length < input.count) {
        const missing = input.count - questions.length
        const onProgress = options?.onProgress
        // The top-up continues the job's progress bar instead of starting it again from zero.
        const topUpOptions: CallOptions = {
          signal: options?.signal,
          onProgress: onProgress && ((task, p) => onProgress(task, p === null ? null : 0.9 + 0.09 * p, `Writing ${missing} more question${missing === 1 ? '' : 's'}`))
        }
        const more = await batch(
          missing,
          questions.map((q) => q.prompt),
          topUpOptions
        )
        questions = collectQuestions(questions, more, input)
      }
      return requireCount(questions, input.count)
    })
  }

  /** Recall-style flashcards (one idea per card, answerable from memory). */
  async generateFlashcards(
    input: { notebookName: string; topic: TopicBrief; lesson: LessonContent; sources: AiSourceDoc[]; count: number },
    options?: CallOptions
  ): Promise<GeneratedCard[]> {
    const validate = (json: unknown): GeneratedCard[] => parseFlashcardsOutput(json, { count: input.count })
    const config = this.getConfig()
    if (config.demo) return this.demo('flashcards', options, () => validate(demoFlashcards(input)))
    return this.call(config, (client) =>
      runStructured(
        client,
        {
          task: 'flashcards',
          model: config.model,
          instruction: flashcardsInstruction({ ...input, lessonSummary: lessonDigest(input.lesson) }),
          sources: input.sources,
          schema: FLASHCARDS_JSON_SCHEMA,
          validate,
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
    return this.call(config, (client) =>
      runStructured(
        client,
        {
          task: 'explanation',
          model: config.model,
          instruction: explanationInstruction(input),
          sources: input.sources,
          schema: EXPLANATION_JSON_SCHEMA,
          validate: parseExplanationOutput,
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
    return this.call(config, (client) =>
      runStructured(
        client,
        {
          task: 'summary',
          model: config.model,
          instruction: summaryInstruction(input),
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

  /** Tiny request to verify the key and model work. Never throws. */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const config = this.getConfig()
      if (config.demo) return { ok: true, message: 'Demo mode is on: AI features use offline sample content, so no key is needed.' }
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

  private async call<T>(config: AiConfig, run: (client: AiClient) => Promise<T>): Promise<T> {
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

function lessonProgress(): ProgressPlan {
  return {
    expectedChars: LESSON_CHARS,
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

function quizProgress(count: number): ProgressPlan {
  return {
    expectedChars: QUESTION_CHARS * count,
    startMessage: 'Reading your files',
    thinkingMessage: 'Planning your questions',
    describe: (text) => `Writing question ${Math.max(1, Math.min(countKey(text, 'prompt'), count))} of ${count}`
  }
}

/** Adds new questions, skipping repeats of earlier ones and of recently asked prompts. */
function collectQuestions(existing: Question[], incoming: Question[], input: GenerateQuestionsInput): Question[] {
  const seen = new Set([...input.avoidPrompts, ...existing.map((q) => q.prompt)].map(promptKey))
  const result = [...existing]
  for (const question of incoming) {
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

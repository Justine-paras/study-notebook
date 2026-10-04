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

export class StudyAi {
  constructor(private readonly getConfig: () => AiConfig) {}

  /** Reads a syllabus: course code, topics in course order, exams with dates (YYYY-MM-DD, resolved against `todayDate`'s year when the year is missing). */
  async extractSyllabus(
    input: { notebookName: string; syllabus: AiSourceDoc; existingTopicTitles: string[]; todayDate: string },
    options?: CallOptions
  ): Promise<SyllabusExtraction> {
    void input
    void options
    void this.getConfig
    throw new Error('TODO')
  }

  /** An in-depth, chunked lesson with warm-up and check questions (ids assigned, topicId set to topic.id). */
  async generateLesson(
    input: { notebookName: string; topic: TopicBrief; sources: AiSourceDoc[]; otherTopics: TopicBrief[] },
    options?: CallOptions
  ): Promise<LessonContent> {
    void input
    void options
    throw new Error('TODO')
  }

  /** Exactly `count` questions using only `types` (ids assigned, topicId mapped to input topic ids). */
  async generateQuestions(input: GenerateQuestionsInput, options?: CallOptions): Promise<Question[]> {
    void input
    void options
    throw new Error('TODO')
  }

  /** Recall-style flashcards (one idea per card, answerable from memory). */
  async generateFlashcards(
    input: { notebookName: string; topic: TopicBrief; lesson: LessonContent; sources: AiSourceDoc[]; count: number },
    options?: CallOptions
  ): Promise<GeneratedCard[]> {
    void input
    void options
    throw new Error('TODO')
  }

  /** Grades a "teach it back" explanation against the rubric and the sources. */
  async gradeExplanation(
    input: { topic: TopicBrief; prompt: string; rubric: string[]; explanation: string; sources: AiSourceDoc[] },
    options?: CallOptions
  ): Promise<ExplanationFeedback> {
    void input
    void options
    throw new Error('TODO')
  }

  /** A Markdown study summary of one source. */
  async summarizeSource(
    input: { notebookName: string; source: AiSourceDoc },
    options?: CallOptions
  ): Promise<{ title: string; summary: string }> {
    void input
    void options
    throw new Error('TODO')
  }

  /** Tiny request to verify the key and model work. Never throws. */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    throw new Error('TODO')
  }
}

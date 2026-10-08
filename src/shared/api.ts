// The contract between the renderer and the main process.
// Every method is exposed to the renderer as `window.api.<method>(...)` and is
// handled in the main process by the service with the same name
// (see src/main/services/index.ts). Arguments and results must be plain,
// structured-cloneable data.

import type {
  AiProgressEvent,
  AnswerRecord,
  AnswerSource,
  Card,
  Confidence,
  Exam,
  ExplanationFeedback,
  FocusKind,
  FocusSession,
  ID,
  Insights,
  Lesson,
  Note,
  Notebook,
  NotebookColor,
  NotebookSummary,
  PathStep,
  Question,
  Quiz,
  QuizKind,
  QuizResult,
  QuizSettings,
  Rating,
  ReviewCard,
  Settings,
  SettingsUpdate,
  Source,
  SourceKind,
  SourceText,
  Topic,
  TopicWithProgress,
  TodayOverview
} from './types'

export interface ImportFileInput {
  /** Absolute path on disk. */
  path: string
  /** When omitted the kind is guessed from the file name. */
  kind?: SourceKind
}

export interface ImportResult {
  sources: Source[]
  /** Files that could not be imported, with a reason. */
  failed: { path: string; reason: string }[]
}

export interface SyllabusResult {
  topicsAdded: Topic[]
  examsAdded: Exam[]
  /** Topics that already existed (matched by title) and were left as they were. */
  topicsSkipped: string[]
}

export interface RecordAnswerInput {
  topicId: ID
  source: Extract<AnswerSource, 'warmup' | 'check'>
  question: Question
  response: string
  confidence: Confidence | null
}

export interface FinishTopicResult {
  topic: Topic
  cardsCreated: Card[]
  /** Upcoming reviews for this topic's cards, e.g. [{label: 'Tomorrow', date: '2026-10-05'}]. */
  reviewPlan: { label: string; date: string }[]
}

export interface CreateQuizInput {
  notebookId: ID
  /** Set for the Practice step of a topic. */
  topicId: ID | null
  kind: QuizKind
  settings: QuizSettings
  /** Restrict to these topics (mock exams: an exam's topics; weak spots: weak topic ids). Empty = decide automatically. */
  topicIds: ID[]
  /** Optional title; generated when omitted. */
  title?: string
}

export interface ReviewInput {
  cardId: ID
  rating: Rating
  confidence: Confidence | null
  /** What the learner typed before revealing, if anything. */
  response: string
}

export interface StudyApi {
  // Notebooks
  listNotebooks(): Promise<NotebookSummary[]>
  getNotebook(id: ID): Promise<NotebookSummary>
  createNotebook(input: { name: string; code: string; color: NotebookColor }): Promise<Notebook>
  updateNotebook(id: ID, patch: Partial<Pick<Notebook, 'name' | 'code' | 'color' | 'archived'>>): Promise<Notebook>
  deleteNotebook(id: ID): Promise<void>

  // Sources
  /** Opens the system file picker. Returns absolute paths (empty when cancelled). */
  pickFiles(): Promise<string[]>
  /** Copies files into the library and extracts their text. Resolves when all are processed. */
  importSources(notebookId: ID, files: ImportFileInput[]): Promise<ImportResult>
  listSources(notebookId: ID): Promise<Source[]>
  updateSource(id: ID, patch: { kind?: SourceKind }): Promise<Source>
  deleteSource(id: ID): Promise<void>
  getSourceText(id: ID): Promise<SourceText>
  /** AI summary; stores it on the source and as a Note of kind 'summary'. */
  summarizeSource(id: ID): Promise<Note>
  /** Opens the stored copy with the default app. */
  openSource(id: ID): Promise<void>

  // Topics
  listTopics(notebookId: ID): Promise<TopicWithProgress[]>
  getTopic(id: ID): Promise<TopicWithProgress>
  createTopic(notebookId: ID, input: { title: string; description?: string; unitLabel?: string; sourceIds?: ID[] }): Promise<Topic>
  updateTopic(id: ID, patch: Partial<Pick<Topic, 'title' | 'description' | 'unitLabel' | 'sourceIds'>>): Promise<Topic>
  deleteTopic(id: ID): Promise<void>
  reorderTopics(notebookId: ID, orderedIds: ID[]): Promise<void>
  /** AI: reads a syllabus source and adds its topics (in course order) and exams. */
  extractTopicsFromSyllabus(notebookId: ID, sourceId: ID): Promise<SyllabusResult>
  setTopicStep(topicId: ID, step: PathStep, chunkIndex?: number): Promise<Topic>

  // Learning path
  getLesson(topicId: ID): Promise<Lesson | null>
  /** AI: creates (or with regenerate, replaces) the lesson for a topic from its sources. */
  generateLesson(topicId: ID, options?: { regenerate?: boolean }): Promise<Lesson>
  /** Grades a warm-up or check question and logs it. */
  recordAnswer(input: RecordAnswerInput): Promise<{ correct: boolean; record: AnswerRecord }>
  /** AI: grades a "teach it back" explanation; saves it as the topic's explanation note. */
  gradeExplanation(topicId: ID, explanation: string): Promise<ExplanationFeedback>
  /** Remember step: creates flashcards from the lesson, marks the path done, returns the review plan. */
  finishTopic(topicId: ID): Promise<FinishTopicResult>

  // Quizzes and mock exams
  /** AI: generates questions and stores the quiz. */
  createQuiz(input: CreateQuizInput): Promise<Quiz>
  getQuiz(id: ID): Promise<Quiz>
  listQuizzes(notebookId: ID, kind?: QuizKind): Promise<Quiz[]>
  startQuiz(id: ID): Promise<Quiz>
  /** Autosaves one answer (not graded until submit). */
  saveQuizAnswer(id: ID, answer: { questionId: ID; response: string; confidence: Confidence | null }): Promise<Quiz>
  /** Grades, logs answers, turns mistakes into flashcards. */
  submitQuiz(id: ID): Promise<QuizResult>
  getQuizResult(id: ID): Promise<QuizResult>
  deleteQuiz(id: ID): Promise<void>

  // Flashcards and reviews
  /**
   * Due cards, interleaved across subjects. With cardIds, exactly those cards (in that order).
   * With topicIds (at least one), those topics' cards whether due or not (up to the limit), for focusing
   * on weak topics: due cards first (most overdue first), then the rest, most at risk of being forgotten first.
   */
  getReviewQueue(options?: { limit?: number; notebookId?: ID; cardIds?: ID[]; topicIds?: ID[] }): Promise<ReviewCard[]>
  reviewCard(input: ReviewInput): Promise<Card>
  listCards(notebookId: ID, topicId?: ID): Promise<Card[]>
  createCard(input: { notebookId: ID; topicId: ID | null; front: string; back: string }): Promise<Card>
  updateCard(id: ID, patch: Partial<Pick<Card, 'front' | 'back' | 'suspended' | 'topicId'>>): Promise<Card>
  deleteCard(id: ID): Promise<void>

  // Notes
  listNotes(notebookId: ID, topicId?: ID): Promise<Note[]>
  createNote(input: { notebookId: ID; topicId: ID | null; title: string; body: string }): Promise<Note>
  updateNote(id: ID, patch: Partial<Pick<Note, 'title' | 'body' | 'topicId'>>): Promise<Note>
  deleteNote(id: ID): Promise<void>

  // Exams
  listExams(notebookId?: ID): Promise<Exam[]>
  createExam(input: { notebookId: ID; name: string; examDate: string; topicIds: ID[] }): Promise<Exam>
  updateExam(id: ID, patch: Partial<Pick<Exam, 'name' | 'examDate' | 'topicIds'>>): Promise<Exam>
  deleteExam(id: ID): Promise<void>

  // Today and insights
  getToday(): Promise<TodayOverview>
  getInsights(): Promise<Insights>

  // Focus timer
  logFocusSession(input: { notebookId: ID | null; kind: FocusKind; startedAt: string; endedAt: string; minutes: number }): Promise<FocusSession>
  /** Shows a desktop notification (used when a Pomodoro ends). */
  notify(title: string, body: string): Promise<void>

  // Settings
  getSettings(): Promise<Settings>
  updateSettings(patch: SettingsUpdate): Promise<Settings>
  /** Stores the Anthropic API key encrypted with the OS keychain (Electron safeStorage). */
  setApiKey(key: string): Promise<Settings>
  clearApiKey(): Promise<Settings>
  /** Makes a tiny API call to check the key works. */
  testApiKey(): Promise<{ ok: boolean; message: string }>
  /** Save dialog, then copies a consistent snapshot of the database there. Null when cancelled. */
  exportBackup(): Promise<{ path: string } | null>
  openDataFolder(): Promise<void>
}

export type StudyApiMethod = keyof StudyApi

/** Every method name, used to register IPC handlers and build the renderer proxy. */
export const STUDY_API_METHODS = [
  'listNotebooks', 'getNotebook', 'createNotebook', 'updateNotebook', 'deleteNotebook',
  'pickFiles', 'importSources', 'listSources', 'updateSource', 'deleteSource', 'getSourceText', 'summarizeSource', 'openSource',
  'listTopics', 'getTopic', 'createTopic', 'updateTopic', 'deleteTopic', 'reorderTopics', 'extractTopicsFromSyllabus', 'setTopicStep',
  'getLesson', 'generateLesson', 'recordAnswer', 'gradeExplanation', 'finishTopic',
  'createQuiz', 'getQuiz', 'listQuizzes', 'startQuiz', 'saveQuizAnswer', 'submitQuiz', 'getQuizResult', 'deleteQuiz',
  'getReviewQueue', 'reviewCard', 'listCards', 'createCard', 'updateCard', 'deleteCard',
  'listNotes', 'createNote', 'updateNote', 'deleteNote',
  'listExams', 'createExam', 'updateExam', 'deleteExam',
  'getToday', 'getInsights',
  'logFocusSession', 'notify',
  'getSettings', 'updateSettings', 'setApiKey', 'clearApiKey', 'testApiKey', 'exportBackup', 'openDataFolder'
] as const satisfies readonly StudyApiMethod[]

// Compile-time check that STUDY_API_METHODS lists every method.
type MissingMethods = Exclude<StudyApiMethod, (typeof STUDY_API_METHODS)[number]>
const _allMethodsListed: MissingMethods extends never ? true : MissingMethods = true
void _allMethodsListed

/** IPC envelope. Handlers never throw across the bridge; errors are returned. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

export const IPC_PREFIX = 'api:'
export const AI_PROGRESS_CHANNEL = 'event:ai-progress'

/** What the preload script exposes on `window.studyBridge`. */
export interface StudyBridge {
  invoke(method: StudyApiMethod, args: unknown[]): Promise<ApiResult<unknown>>
  onAiProgress(listener: (event: AiProgressEvent) => void): () => void
  /** Absolute path of a File dropped onto the window (drag and drop import). */
  pathForFile(file: File): string
  platform: string
}

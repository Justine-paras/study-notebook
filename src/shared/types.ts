// Domain types shared by the main process, preload and renderer.
// All dates are ISO-8601 strings (UTC) unless the field name ends in `Date`,
// in which case it is a local calendar date `YYYY-MM-DD`.

export type ID = string

// ---------------------------------------------------------------------------
// Notebooks (one per subject)
// ---------------------------------------------------------------------------

/** Cover colors a notebook can use. Each maps to a token in the renderer. */
export const NOTEBOOK_COLORS = ['blue', 'orange', 'teal', 'purple', 'green', 'pink', 'slate', 'gold'] as const
export type NotebookColor = (typeof NOTEBOOK_COLORS)[number]

export interface Notebook {
  id: ID
  name: string
  /** Course code such as "CS 201". Empty string when unknown. */
  code: string
  color: NotebookColor
  createdAt: string
  archived: boolean
}

export interface NotebookSummary extends Notebook {
  sourceCount: number
  topicCount: number
  /** 0-100, mean mastery across all topics (not-started topics count as 0). */
  mastery: number
  dueCards: number
  nextExam: Exam | null
  /** Readiness 0-100 for `nextExam`, null when there is no upcoming exam. */
  nextExamReadiness: number | null
  lastStudiedAt: string | null
}

// ---------------------------------------------------------------------------
// Sources (uploaded files)
// ---------------------------------------------------------------------------

export const SOURCE_KINDS = ['syllabus', 'lecture', 'slides', 'quiz', 'exam', 'notes', 'other'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

export const SUPPORTED_EXTENSIONS = ['pdf', 'pptx', 'docx', 'txt', 'md'] as const
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number]

export type SourceStatus = 'processing' | 'ready' | 'error'

export interface Source {
  id: ID
  notebookId: ID
  fileName: string
  ext: SupportedExtension
  kind: SourceKind
  sizeBytes: number
  /** Absolute path of the copy kept in the app's library folder. */
  storedPath: string
  status: SourceStatus
  /** Error message when status is 'error'. */
  error: string | null
  /** Number of characters of extracted text. */
  charCount: number
  /** Page or slide count when known. */
  pageCount: number | null
  /** AI summary in Markdown, null until generated. */
  summary: string | null
  addedAt: string
}

/** Extracted text of a source, split by page/slide where the format allows. */
export interface SourceText {
  sourceId: ID
  /** Full text. Pages/slides are separated by "\n\n" and each starts with a marker line like "[Page 3]" or "[Slide 7]". */
  text: string
}

// ---------------------------------------------------------------------------
// Topics and the learning path
// ---------------------------------------------------------------------------

export const PATH_STEPS = ['warmup', 'learn', 'explain', 'practice', 'remember'] as const
export type PathStep = (typeof PATH_STEPS)[number]

export type MasteryState = 'not_started' | 'learning' | 'weak' | 'reviewing' | 'mastered'

export interface Topic {
  id: ID
  notebookId: ID
  title: string
  description: string
  /** Syllabus grouping such as "Week 4" or "Unit 2". Empty when unknown. */
  unitLabel: string
  /** Position in course order (ascending). */
  orderIndex: number
  /** Sources this topic draws on. */
  sourceIds: ID[]
  /** Current step of the learning path, null when not started. 'done' after Remember. */
  pathStep: PathStep | 'done' | null
  /** Index of the lesson chunk the learner is on (Learn step). */
  chunkIndex: number
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

export interface TopicProgress {
  topicId: ID
  state: MasteryState
  /** 0-100. */
  mastery: number
  /** Accuracy 0-100 over recent answers, null when fewer than 3 answers. */
  recentAccuracy: number | null
  answeredCount: number
  missedCount: number
  /** Answers marked "sure" that were wrong, last 30 days. */
  overconfidentCount: number
  cardCount: number
  dueCards: number
  /** Earliest due date among this topic's cards, null when none. */
  nextReviewAt: string | null
  lastPracticedAt: string | null
}

export interface TopicWithProgress extends Topic {
  progress: TopicProgress
}

// ---------------------------------------------------------------------------
// Questions, lessons, quizzes
// ---------------------------------------------------------------------------

export const QUESTION_TYPES = ['mc', 'tf', 'fill', 'identification'] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mc: 'Multiple choice',
  tf: 'True or false',
  fill: 'Fill in the blank',
  identification: 'Identification'
}

export type Difficulty = 'easy' | 'medium' | 'hard'

export interface Question {
  id: ID
  type: QuestionType
  /** The question text (Markdown allowed). For 'fill', contains "____" where the blank is. */
  prompt: string
  /** Choices for 'mc' (3-5 items) and 'tf' (exactly ["True", "False"]). Empty for other types. */
  options: string[]
  /** The correct answer. For 'mc'/'tf' it equals one of `options` exactly. */
  answer: string
  /** Other accepted answers for 'fill'/'identification' (synonyms, spellings). */
  acceptable: string[]
  /** Why the answer is right (and common wrong answers are wrong). Markdown. */
  explanation: string
  topicId: ID | null
  difficulty: Difficulty
  /** Where in the sources this comes from, e.g. "Lecture 05 – Deadlocks.pdf, page 12". */
  sourceRef: string
}

export type Confidence = 'sure' | 'unsure' | 'guess'

export interface LessonChunk {
  heading: string
  /** Markdown body; may contain code blocks, tables and $math$. */
  body: string
  /** A worked example in Markdown, empty string when none. */
  example: string
  /** One quick check question (type 'mc' or 'tf') answered before moving on. */
  check: Question
}

export interface KeyTerm {
  term: string
  definition: string
}

export interface LessonContent {
  title: string
  /** One-paragraph overview of why this topic matters. */
  overview: string
  estMinutes: number
  /** 2 quick questions asked before the lesson (pre-testing). */
  warmup: Question[]
  /** 3-6 small sections. */
  chunks: LessonChunk[]
  keyTerms: KeyTerm[]
  /** Short notes on how this topic links to other topics in the notebook. */
  connections: string[]
  /** The "explain it in your own words" prompt. */
  explainPrompt: string
  /** Points a good explanation should cover; used to grade the learner's explanation. */
  explainRubric: string[]
  /** Names of the sources used, for the "Built from" list. */
  sourcesUsed: string[]
}

export interface Lesson {
  id: ID
  topicId: ID
  content: LessonContent
  createdAt: string
}

export interface ExplanationFeedback {
  /** 0-100. */
  score: number
  covered: string[]
  missing: string[]
  misconceptions: string[]
  /** One concrete suggestion for improving the explanation. */
  suggestion: string
}

export type QuizKind = 'practice' | 'weak_spots' | 'mock_exam'

export interface QuizSettings {
  types: QuestionType[]
  count: number
  difficulty: Difficulty | 'mixed'
  /** Prioritise topics the learner keeps missing. */
  focusWeak: boolean
  /** Mix in questions from earlier topics of the same notebook (interleaving). */
  interleave: boolean
  /** Minutes for mock exams; null for untimed. */
  timeLimitMin: number | null
}

export interface QuizAnswer {
  questionId: ID
  response: string
  confidence: Confidence | null
  correct: boolean
}

export interface Quiz {
  id: ID
  notebookId: ID
  /** The topic the quiz was made for (practice step), null for cross-topic quizzes. */
  topicId: ID | null
  kind: QuizKind
  title: string
  settings: QuizSettings
  questions: Question[]
  createdAt: string
  startedAt: string | null
  submittedAt: string | null
  answers: QuizAnswer[]
  /** Correct count, null until submitted. */
  score: number | null
}

export interface QuizResult {
  quiz: Quiz
  correct: number
  total: number
  byTopic: { topicId: ID | null; topicTitle: string; correct: number; total: number }[]
  /** Questions answered "sure" but wrong. */
  overconfident: ID[]
  /** Flashcards created from mistakes. */
  cardsCreated: number
}

// ---------------------------------------------------------------------------
// Answer log (every answered question, used for weak topics and calibration)
// ---------------------------------------------------------------------------

export type AnswerSource = 'warmup' | 'check' | 'practice' | 'weak_spots' | 'mock_exam' | 'review'

export interface AnswerRecord {
  id: ID
  notebookId: ID
  topicId: ID | null
  quizId: ID | null
  cardId: ID | null
  source: AnswerSource
  questionType: QuestionType | 'recall'
  prompt: string
  userAnswer: string
  correctAnswer: string
  correct: boolean
  confidence: Confidence | null
  answeredAt: string
}

// ---------------------------------------------------------------------------
// Flashcards and spaced repetition
// ---------------------------------------------------------------------------

export type CardOrigin = 'lesson' | 'mistake' | 'manual' | 'explanation'
export type CardState = 'new' | 'learning' | 'review' | 'relearning'
/** 1 = Again (forgot), 2 = Hard, 3 = Good, 4 = Easy. */
export type Rating = 1 | 2 | 3 | 4

export interface CardSchedule {
  due: string
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  learningSteps: number
  reps: number
  lapses: number
  state: CardState
  lastReview: string | null
}

export interface Card extends CardSchedule {
  id: ID
  notebookId: ID
  topicId: ID | null
  front: string
  back: string
  origin: CardOrigin
  sourceRef: string
  suspended: boolean
  createdAt: string
}

export interface ReviewLog {
  id: ID
  cardId: ID
  rating: Rating
  confidence: Confidence | null
  stateBefore: CardState
  scheduledDays: number
  elapsedDays: number
  reviewedAt: string
}

/** What each rating would do to a card, shown on the grade buttons. */
export interface RatingPreview {
  rating: Rating
  /** Human label such as "1 min", "10 min", "3 days". */
  intervalLabel: string
  due: string
}

export interface ReviewCard extends Card {
  notebookName: string
  notebookColor: NotebookColor
  topicTitle: string | null
  previews: RatingPreview[]
}

// ---------------------------------------------------------------------------
// Notes, exams, focus sessions
// ---------------------------------------------------------------------------

export type NoteKind = 'note' | 'summary' | 'explanation'

export interface Note {
  id: ID
  notebookId: ID
  topicId: ID | null
  sourceId: ID | null
  kind: NoteKind
  title: string
  /** Markdown. */
  body: string
  createdAt: string
  updatedAt: string
}

export interface Exam {
  id: ID
  notebookId: ID
  name: string
  /** Local date YYYY-MM-DD. */
  examDate: string
  /** Topics the exam covers. Empty means "all topics up to the exam". */
  topicIds: ID[]
  createdAt: string
}

export type FocusKind = 'focus' | 'break'

export interface FocusSession {
  id: ID
  notebookId: ID | null
  kind: FocusKind
  startedAt: string
  endedAt: string
  minutes: number
}

// ---------------------------------------------------------------------------
// Today plan and insights
// ---------------------------------------------------------------------------

export type PlanBlockKind = 'review' | 'weak' | 'learn' | 'exam_prep'

export interface PlanBlock {
  kind: PlanBlockKind
  title: string
  /** One line naming what is included, e.g. "Mixed: CS 201, CS 310". */
  detail: string
  /** Why this block is in today's plan, written for the learner. */
  reason: string
  estMinutes: number
  cardIds: ID[]
  topicIds: ID[]
  notebookIds: ID[]
}

export interface TodayPlan {
  date: string
  blocks: PlanBlock[]
  totalMinutes: number
  dueCount: number
}

export interface UpcomingExam extends Exam {
  notebookName: string
  notebookColor: NotebookColor
  daysLeft: number
  readiness: number
  /** Weakest covered topics (up to 3) to mention under the exam. */
  weakestTopics: { topicId: ID; title: string; mastery: number }[]
  notStartedCount: number
}

export interface WeakTopic {
  topicId: ID
  notebookId: ID
  notebookName: string
  notebookCode: string
  title: string
  mastery: number
  accuracy: number | null
  missedCount: number
  answeredCount: number
  overconfidentCount: number
  /** Short reason such as "sure but wrong 4 times" or "on OS Quiz 3 in 4 days". */
  why: string
}

export interface CalibrationBucket {
  confidence: Confidence
  answered: number
  correct: number
  /** 0-100, null when answered is 0. */
  accuracy: number | null
}

export interface ForecastDay {
  date: string
  due: number
}

export interface Insights {
  weakTopics: WeakTopic[]
  calibration: CalibrationBucket[]
  overconfidentLast7Days: number
  forecast: ForecastDay[]
  mistakes: AnswerRecord[]
  studyMinutesByDay: { date: string; minutes: number }[]
  studyMinutesBySubject: { notebookId: ID; name: string; color: NotebookColor; minutes: number }[]
  /** Recall rate 0-100 over reviews in the last 7 days, null when none. */
  recallRate7d: number | null
  /** Cards whose stability is at least 21 days. */
  longTermCards: number
  streakDays: number
}

export interface TodayOverview {
  plan: TodayPlan
  exams: UpcomingExam[]
  notebooks: NotebookSummary[]
  recallRate7d: number | null
  longTermCards: number
  streakDays: number
  studyMinutesToday: number
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best quality)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, cheaper)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fastest, cheapest)' }
] as const
export type AiModelId = (typeof AI_MODELS)[number]['id']

export type ThemePref = 'system' | 'light' | 'dark'

export interface Settings {
  model: AiModelId
  theme: ThemePref
  focusMinutes: number
  breakMinutes: number
  /** Target number of new topics to start per day in the plan. */
  newTopicsPerDay: number
  /** Maximum review cards per day in the plan. */
  maxReviewsPerDay: number
  /** Desired probability of recalling a card when it comes due (0.8-0.97). */
  desiredRetention: number
  /** True when an API key is stored or ANTHROPIC_API_KEY is set. Read-only. */
  hasApiKey: boolean
  /** True when the app runs with the offline demo AI (no key needed). Read-only. */
  demoAi: boolean
  /** Where the library and database live. Read-only. */
  dataDir: string
}

export type SettingsUpdate = Partial<
  Pick<Settings, 'model' | 'theme' | 'focusMinutes' | 'breakMinutes' | 'newTopicsPerDay' | 'maxReviewsPerDay' | 'desiredRetention'>
>

// ---------------------------------------------------------------------------
// AI job progress
// ---------------------------------------------------------------------------

export type AiTask = 'syllabus' | 'lesson' | 'quiz' | 'flashcards' | 'explanation' | 'summary'

export interface AiProgressEvent {
  jobId: ID
  task: AiTask
  /**
   * What the job works on, so two jobs of the same task (two files being
   * summarized at once) each show their own progress: the topic for lessons,
   * explanation feedback, flashcards and practice quizzes; the file for
   * summaries; the notebook for syllabus reading, weak-spot quizzes and mock
   * exams. Missing or null when not known.
   */
  subjectId?: ID | null
  /** Rough 0-1 progress from output tokens streamed so far, null when unknown. */
  progress: number | null
  message: string
}

/** Error codes the renderer can show friendly messages for. */
export type AppErrorCode =
  | 'NO_API_KEY'
  | 'INVALID_API_KEY'
  | 'RATE_LIMITED'
  | 'AI_REFUSED'
  | 'AI_BAD_OUTPUT'
  | 'AI_UNAVAILABLE'
  | 'NETWORK'
  | 'SOURCE_TOO_LARGE'
  | 'NO_SOURCES'
  | 'UNSUPPORTED_FILE'
  | 'EXTRACT_FAILED'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'UNKNOWN'

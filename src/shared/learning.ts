// Pure learning-science logic: answer grading, spaced repetition (FSRS via
// ts-fsrs), topic mastery, the Today plan, exam readiness, calibration and
// streaks. No I/O, no Electron, no database: everything takes plain data and
// `now`, so it is fully unit-testable.
//
// OWNER: learning agent. Signatures are the contract other modules code
// against; do not change them without updating every caller.

import type {
  AnswerRecord,
  CalibrationBucket,
  Card,
  CardSchedule,
  Confidence,
  Exam,
  ForecastDay,
  ID,
  PlanBlock,
  Question,
  Rating,
  RatingPreview,
  ReviewLog,
  TodayPlan,
  Topic,
  TopicProgress,
  TopicWithProgress
} from './types'

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Local calendar date `YYYY-MM-DD` for a Date (uses the machine's time zone). */
export function localDate(d: Date): string {
  void d
  throw new Error('TODO')
}

/** Whole local days from `from` to `to` (dates `YYYY-MM-DD`), negative when `to` is earlier. */
export function daysBetween(fromDate: string, toDate: string): number {
  void fromDate
  void toDate
  throw new Error('TODO')
}

// ---------------------------------------------------------------------------
// Answer grading
// ---------------------------------------------------------------------------

/** Lower-cases, trims, collapses whitespace, strips surrounding punctuation and articles ("the", "a", "an"). */
export function normalizeAnswer(s: string): string {
  void s
  throw new Error('TODO')
}

/**
 * True when `response` answers `q` correctly.
 * - mc/tf: exact match with `q.answer` after normalization.
 * - fill/identification: matches `q.answer` or any `q.acceptable` after
 *   normalization, tolerating small typos (Levenshtein distance <= 1 for
 *   answers of 5-8 characters, <= 2 for 9+ characters, exact below 5), and
 *   ignoring hyphens/spaces differences ("in-order" == "inorder").
 * Empty responses are always wrong.
 */
export function gradeResponse(q: Question, response: string): boolean {
  void q
  void response
  throw new Error('TODO')
}

// ---------------------------------------------------------------------------
// Spaced repetition (FSRS)
// ---------------------------------------------------------------------------

/** Schedule for a brand-new card, due immediately. */
export function newCardSchedule(now: Date): CardSchedule {
  void now
  throw new Error('TODO')
}

/**
 * Confidence-aware rating: a "Good"/"Easy" given while guessing is treated as
 * "Hard" (the memory is not reliable yet). Other combinations are unchanged.
 */
export function adjustRatingForConfidence(rating: Rating, confidence: Confidence | null): Rating {
  void rating
  void confidence
  throw new Error('TODO')
}

/** What each rating (1-4) would do to the card right now. */
export function previewRatings(card: CardSchedule, now: Date, desiredRetention: number): RatingPreview[] {
  void card
  void now
  void desiredRetention
  throw new Error('TODO')
}

/** Applies a rating. Returns the new schedule and the values for the review log. */
export function applyRating(
  card: CardSchedule,
  rating: Rating,
  now: Date,
  desiredRetention: number
): { schedule: CardSchedule; log: Pick<ReviewLog, 'stateBefore' | 'scheduledDays' | 'elapsedDays'> } {
  void card
  void rating
  void now
  void desiredRetention
  throw new Error('TODO')
}

/** Probability 0-1 of recalling the card now (1 for new cards that were never reviewed is NOT assumed: return 0). */
export function retrievability(card: CardSchedule, now: Date): number {
  void card
  void now
  throw new Error('TODO')
}

/** Short human interval: "1 min", "10 min", "1 hr", "1 day", "3 days", "2 wk", "4 mo", "1.2 yr". */
export function formatInterval(ms: number): string {
  void ms
  throw new Error('TODO')
}

/** Due-card counts for each of the next `days` local days starting at `from` (overdue cards count on day 0). */
export function forecastDue(cards: Pick<CardSchedule, 'due'>[], from: Date, days: number): ForecastDay[] {
  void cards
  void from
  void days
  throw new Error('TODO')
}

/**
 * Orders cards so consecutive cards come from different notebooks where
 * possible (interleaving), keeping each notebook's own order (most overdue
 * first). Deterministic.
 */
export function interleaveByNotebook<T extends { notebookId: ID }>(items: T[]): T[] {
  void items
  throw new Error('TODO')
}

// ---------------------------------------------------------------------------
// Topic mastery
// ---------------------------------------------------------------------------

export interface TopicProgressInput {
  topic: Topic
  /** All answer records for this topic (any age, any order). */
  answers: AnswerRecord[]
  /** All non-suspended cards for this topic. */
  cards: Card[]
  /** Review logs for those cards. */
  reviews: ReviewLog[]
  now: Date
}

/**
 * Mastery model (document the exact formula in a comment):
 * - Accuracy: recency-weighted accuracy over the last 20 answers + reviews
 *   (reviews count as correct when rating >= 3). Needs >= 3 data points.
 * - Memory: mean retrievability of the topic's reviewed cards.
 * - mastery = round(100 * (0.5 * accuracy + 0.4 * memory + 0.1 * pathDone)), using
 *   whichever parts exist (re-weighted), 0 when the topic has no data.
 * States:
 * - not_started: pathStep null and no answers and no cards.
 * - learning: pathStep set and not 'done'.
 * - weak: (>= 4 data points and accuracy < 0.6) or overconfident errors in the last 30 days >= 2.
 * - mastered: mastery >= 85 and at least 2 successful reviews on different days >= 3 days apart.
 * - reviewing: everything else.
 */
export function computeTopicProgress(input: TopicProgressInput): TopicProgress {
  void input
  throw new Error('TODO')
}

// ---------------------------------------------------------------------------
// Exams
// ---------------------------------------------------------------------------

/**
 * Readiness 0-100 = mean mastery of the topics the exam covers (all topics of
 * the notebook in course order when `exam.topicIds` is empty). Also returns the
 * 3 weakest covered topics and how many covered topics are not started.
 */
export function examReadiness(
  exam: Exam,
  notebookTopics: TopicWithProgress[]
): { readiness: number; weakest: { topicId: ID; title: string; mastery: number }[]; notStartedCount: number } {
  void exam
  void notebookTopics
  throw new Error('TODO')
}

// ---------------------------------------------------------------------------
// Today plan
// ---------------------------------------------------------------------------

export interface PlanCard extends Card {
  notebookName: string
  notebookCode: string
}

export interface PlanTopic extends TopicWithProgress {
  notebookName: string
  notebookCode: string
}

export interface TodayPlanInput {
  now: Date
  /** Cards due now or earlier (any order). */
  dueCards: PlanCard[]
  /** Every topic of every non-archived notebook. */
  topics: PlanTopic[]
  /** Upcoming exams (today or later). */
  exams: Exam[]
  newTopicsPerDay: number
  maxReviewsPerDay: number
}

/**
 * Builds today's plan in this order (skip a block when it would be empty):
 * 1. review: due cards, most overdue first, capped at maxReviewsPerDay, interleaved
 *    across notebooks. ~40 s per card. Reason mentions they are about to be forgotten.
 * 2. weak: up to 3 weak topics, prioritising topics covered by the nearest exam,
 *    then lowest mastery. ~5 min per topic. Reason mentions repeated misses / exam.
 * 3. learn: up to newTopicsPerDay topics, preferring 'learning' topics (finish
 *    what you started), then not-started topics covered by the nearest exam in
 *    course order, then course order. ~20 min per topic.
 * 4. exam_prep: when an exam is within 3 days, a mock-exam block for it (~30 min).
 * Reasons are short, concrete and written to the learner ("you keep missing these,
 * and 2 are on your Oct 12 midterm").
 */
export function buildTodayPlan(input: TodayPlanInput): TodayPlan {
  void input
  throw new Error('TODO')
}

/** One short reason for a weak topic, e.g. "sure but wrong 4 times", "on CS 310 Quiz 3 in 4 days", "missed 6 of 14". */
export function weakTopicReason(progress: TopicProgress, nearestExam: { name: string; daysLeft: number } | null): string {
  void progress
  void nearestExam
  throw new Error('TODO')
}

// ---------------------------------------------------------------------------
// Calibration and streaks
// ---------------------------------------------------------------------------

/** Accuracy by stated confidence. Always returns the three buckets in order sure, unsure, guess. */
export function calibration(answers: Pick<AnswerRecord, 'confidence' | 'correct'>[]): CalibrationBucket[] {
  void answers
  throw new Error('TODO')
}

/**
 * Consecutive days with study activity ending today (or yesterday, if nothing
 * has happened yet today). `activityDates` are local dates YYYY-MM-DD, any order, may repeat.
 */
export function streakDays(activityDates: string[], today: string): number {
  void activityDates
  void today
  throw new Error('TODO')
}

/** Planned review dates for newly created cards, as labels for the Remember step. */
export function reviewPlanLabels(dueDates: string[], now: Date): { label: string; date: string }[] {
  void dueDates
  void now
  throw new Error('TODO')
}

/** Re-exported so callers can show a block's minutes consistently. */
export function planMinutes(blocks: PlanBlock[]): number {
  return blocks.reduce((sum, b) => sum + b.estMinutes, 0)
}

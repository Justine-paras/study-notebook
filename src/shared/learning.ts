// Pure learning-science logic: answer grading, spaced repetition (FSRS via
// ts-fsrs), topic mastery, the Today plan, exam readiness, calibration and
// streaks. No I/O, no Electron, no database: everything takes plain data and
// `now`, so it is fully unit-testable.
//
// OWNER: learning agent. Signatures are the contract other modules code
// against; do not change them without updating every caller.

import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating as FsrsRating,
  State as FsrsState,
  type Card as FsrsCard,
  type FSRS,
  type Grade
} from 'ts-fsrs'
import type {
  AnswerRecord,
  CalibrationBucket,
  Card,
  CardSchedule,
  CardState,
  Confidence,
  Exam,
  ForecastDay,
  ID,
  PathStep,
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

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Local calendar date `YYYY-MM-DD` for a Date (uses the machine's time zone). */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function parseLocalDate(date: string): { y: number; m: number; d: number } {
  const match = LOCAL_DATE_RE.exec(date)
  if (!match) throw new RangeError(`Expected a date like 2026-10-04, got "${date}"`)
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

// Calendar dates are mapped onto the UTC timeline, which has no DST, so every
// day is exactly DAY_MS long there and the division below is exact. Using the
// local timeline instead would give 23- or 25-hour days around DST changes.
function dayNumber(date: string): number {
  const { y, m, d } = parseLocalDate(date)
  return Date.UTC(y, m - 1, d) / DAY_MS
}

/** Whole local days from `from` to `to` (dates `YYYY-MM-DD`), negative when `to` is earlier. */
export function daysBetween(fromDate: string, toDate: string): number {
  return dayNumber(toDate) - dayNumber(fromDate)
}

/** The local date `days` calendar days after `date` (both `YYYY-MM-DD`). */
export function addDays(date: string, days: number): string {
  const { y, m, d } = parseLocalDate(date)
  const shifted = new Date(Date.UTC(y, m - 1, d + days))
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}

/** "Oct 12" for a local date; adds the year ("Jan 5, 2027") when it differs from `currentYear`. */
export function shortDateLabel(date: string, currentYear?: number): string {
  const { y, m, d } = parseLocalDate(date)
  const base = `${MONTH_NAMES[m - 1]} ${d}`
  return currentYear !== undefined && currentYear !== y ? `${base}, ${y}` : base
}

function parseTime(iso: string): number | null {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

// ---------------------------------------------------------------------------
// Answer grading
// ---------------------------------------------------------------------------

const ARTICLES = new Set(['the', 'a', 'an'])
// Brackets are deliberately not stripped: "O(n)" must keep its parentheses.
const LEADING_PUNCT = /^[\s.,;:!?'"`*_~]+/u
const TRAILING_PUNCT = /[\s.,;:!?'"`*_~]+$/u

function stripSurroundingPunctuation(s: string): string {
  return s.replace(LEADING_PUNCT, '').replace(TRAILING_PUNCT, '')
}

/** Lower-cases, trims, collapses whitespace, strips surrounding punctuation and articles ("the", "a", "an"). */
export function normalizeAnswer(s: string): string {
  const cleaned = s
    .normalize('NFKC')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    // "O( n )" and "O(n)" are the same answer; so are "f(a, b)" and "f(a,b)".
    .replace(/([([{])\s+/g, '$1')
    .replace(/\s+([)\]}])/g, '$1')
    .replace(/\s*,\s*/g, ', ')
    .trim()

  const stripped = stripSurroundingPunctuation(cleaned)
  // An article is only dropped when it precedes a word, so expressions such
  // as "a + b" keep their variable and a bare "a" answer is never emptied.
  const tokens = stripped.split(' ')
  const kept = tokens.filter((t, i) => !(ARTICLES.has(t) && i < tokens.length - 1 && /^\p{L}/u.test(tokens[i + 1])))
  return stripSurroundingPunctuation(kept.join(' '))
}

/** Normalized form that also ignores spaces, hyphens and underscores ("in-order" == "in order" == "inorder"). */
function compactAnswer(s: string): string {
  return normalizeAnswer(s).replace(/[\s\-_]+/g, '')
}

/** Levenshtein distance, giving up early (returning `max + 1`) once it must exceed `max`. */
export function levenshtein(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      row.push(value)
      if (value < rowMin) rowMin = value
    }
    if (rowMin > max) return max + 1
    prev = row
  }
  return prev[b.length]
}

function typoAllowance(expectedLength: number): number {
  if (expectedLength >= 9) return 2
  if (expectedLength >= 5) return 1
  return 0
}

function matchesWithTypos(expected: string, response: string): boolean {
  const exp = compactAnswer(expected)
  const res = compactAnswer(response)
  if (exp.length === 0 || res.length === 0) return false
  if (exp === res) return true
  // Typos are only forgiven in words. In anything with digits, brackets or
  // operators ("O(log n)" vs "O(n log n)", "1024" vs "1025") a one-character
  // difference is a different answer, not a slip.
  if (!/^\p{L}+$/u.test(exp)) return false
  // A response that is the answer with letters added in front is usually its
  // opposite ("mutable" vs "immutable", "synchronous" vs "asynchronous").
  const [shorter, longer] = exp.length <= res.length ? [exp, res] : [res, exp]
  if (longer.endsWith(shorter)) return false
  const allowance = typoAllowance(exp.length)
  return allowance > 0 && levenshtein(exp, res, allowance) <= allowance
}

function canonicalTrueFalse(s: string): 'true' | 'false' | null {
  const n = normalizeAnswer(s)
  if (n === 'true' || n === 't') return 'true'
  if (n === 'false' || n === 'f') return 'false'
  return null
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
  const given = normalizeAnswer(response)
  if (given.length === 0) return false

  switch (q.type) {
    case 'tf': {
      const expected = canonicalTrueFalse(q.answer)
      if (expected !== null) return canonicalTrueFalse(response) === expected
      return given === normalizeAnswer(q.answer)
    }
    case 'mc': {
      const expected = normalizeAnswer(q.answer)
      return expected.length > 0 && given === expected
    }
    case 'fill':
    case 'identification':
      return [q.answer, ...q.acceptable].some((candidate) => matchesWithTypos(candidate, response))
  }
}

// ---------------------------------------------------------------------------
// Spaced repetition (FSRS)
// ---------------------------------------------------------------------------

const STATE_TO_FSRS: Record<CardState, FsrsState> = {
  new: FsrsState.New,
  learning: FsrsState.Learning,
  review: FsrsState.Review,
  relearning: FsrsState.Relearning
}

const STATE_FROM_FSRS: Record<FsrsState, CardState> = {
  [FsrsState.New]: 'new',
  [FsrsState.Learning]: 'learning',
  [FsrsState.Review]: 'review',
  [FsrsState.Relearning]: 'relearning'
}

const GRADES: Record<Rating, Grade> = {
  1: FsrsRating.Again,
  2: FsrsRating.Hard,
  3: FsrsRating.Good,
  4: FsrsRating.Easy
}

const RATINGS: readonly Rating[] = [1, 2, 3, 4]

const DEFAULT_RETENTION = 0.9
const MIN_RETENTION = 0.7
const MAX_RETENTION = 0.99

function clampRetention(desiredRetention: number): number {
  if (!Number.isFinite(desiredRetention)) return DEFAULT_RETENTION
  return Math.min(MAX_RETENTION, Math.max(MIN_RETENTION, desiredRetention))
}

// Schedulers are stateless apart from their parameters, so one per retention
// value is reused (the settings only ever hold a handful of values).
const schedulers = new Map<number, FSRS>()

function scheduler(desiredRetention: number): FSRS {
  const retention = clampRetention(desiredRetention)
  let f = schedulers.get(retention)
  if (!f) {
    f = fsrs(
      generatorParameters({
        request_retention: retention,
        // No fuzz: the interval shown on a grade button must be exactly what
        // pressing it does, and tests must be deterministic.
        enable_fuzz: false,
        // Short-term steps bring a missed card back within the same session.
        enable_short_term: true,
        learning_steps: ['1m', '10m'],
        relearning_steps: ['10m']
      })
    )
    schedulers.set(retention, f)
  }
  return f
}

function toFsrsCard(card: CardSchedule): FsrsCard {
  const fsrsCard: FsrsCard = {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: STATE_TO_FSRS[card.state]
  }
  if (card.lastReview !== null) fsrsCard.last_review = new Date(card.lastReview)
  return fsrsCard
}

function fromFsrsCard(card: FsrsCard): CardSchedule {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: STATE_FROM_FSRS[card.state],
    lastReview: card.last_review ? card.last_review.toISOString() : null
  }
}

/** Schedule for a brand-new card, due immediately. */
export function newCardSchedule(now: Date): CardSchedule {
  return fromFsrsCard(createEmptyCard(now))
}

/**
 * Confidence-aware rating: a "Good"/"Easy" given while guessing is treated as
 * "Hard" (the memory is not reliable yet). Other combinations are unchanged.
 */
export function adjustRatingForConfidence(rating: Rating, confidence: Confidence | null): Rating {
  return confidence === 'guess' && rating >= 3 ? 2 : rating
}

/** What each rating (1-4) would do to the card right now. */
export function previewRatings(card: CardSchedule, now: Date, desiredRetention: number): RatingPreview[] {
  const preview = scheduler(desiredRetention).repeat(toFsrsCard(card), now)
  return RATINGS.map((rating) => {
    const due = preview[GRADES[rating]].card.due
    return { rating, intervalLabel: formatInterval(due.getTime() - now.getTime()), due: due.toISOString() }
  })
}

/**
 * Applies a rating. Returns the new schedule and the values for the review log.
 * The log's `scheduledDays` is the interval this review granted (whole days, 0
 * while in learning steps) and `elapsedDays` the whole days since the previous
 * review (0 for a first review).
 */
export function applyRating(
  card: CardSchedule,
  rating: Rating,
  now: Date,
  desiredRetention: number
): { schedule: CardSchedule; log: Pick<ReviewLog, 'stateBefore' | 'scheduledDays' | 'elapsedDays'> } {
  const result = scheduler(desiredRetention).next(toFsrsCard(card), now, GRADES[rating])
  const schedule = fromFsrsCard(result.card)
  return {
    schedule,
    log: { stateBefore: card.state, scheduledDays: schedule.scheduledDays, elapsedDays: result.log.elapsed_days }
  }
}

/** Probability 0-1 of recalling the card now (1 for new cards that were never reviewed is NOT assumed: return 0). */
export function retrievability(card: CardSchedule, now: Date): number {
  if (card.state === 'new' || card.lastReview === null || card.stability <= 0) return 0
  const lastReview = parseTime(card.lastReview)
  if (lastReview === null) return 0
  // Fractional days (ts-fsrs's own helper floors them), so a card reviewed
  // this morning has decayed a little by tonight.
  const elapsedDays = Math.max(0, (now.getTime() - lastReview) / DAY_MS)
  const r = scheduler(DEFAULT_RETENTION).forgetting_curve(elapsedDays, card.stability)
  return Math.min(1, Math.max(0, r))
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`
}

/** Short human interval: "1 min", "10 min", "1 hr", "1 day", "3 days", "2 wk", "4 mo", "1.2 yr". */
export function formatInterval(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'now'
  // Each unit is chosen from the rounded value of the smaller one, so 59.6
  // minutes reads "1 hr" rather than "60 min".
  const minutes = Math.max(1, Math.round(ms / MINUTE_MS))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(ms / HOUR_MS)
  if (hours < 24) return `${hours} hr`
  const days = Math.round(ms / DAY_MS)
  if (days < 14) return plural(days, 'day')
  if (days < 60) return `${Math.round(days / 7)} wk`
  if (days < 365) return `${Math.max(2, Math.round(days / 30.4375))} mo`
  const years = Math.round((days / 365.25) * 10) / 10
  return `${Number.isInteger(years) ? years.toFixed(0) : years.toFixed(1)} yr`
}

/** Due-card counts for each of the next `days` local days starting at `from` (overdue cards count on day 0). */
export function forecastDue(cards: Pick<CardSchedule, 'due'>[], from: Date, days: number): ForecastDay[] {
  const length = Math.max(0, Math.floor(days))
  const start = localDate(from)
  const counts = new Array<number>(length).fill(0)
  for (const card of cards) {
    const due = parseTime(card.due)
    if (due === null) continue
    const offset = Math.max(0, daysBetween(start, localDate(new Date(due))))
    if (offset < length) counts[offset] += 1
  }
  return counts.map((due, i) => ({ date: addDays(start, i), due }))
}

/**
 * Orders cards so consecutive cards come from different notebooks where
 * possible (interleaving), keeping each notebook's own order (most overdue
 * first). Deterministic.
 *
 * Greedy: at each step take the next item of the notebook with the most items
 * left that differs from the previous pick (ties go to the notebook whose next
 * item came first in the input, which keeps urgent cards early). Picking the
 * largest group first is what avoids a long single-notebook run at the end.
 */
export function interleaveByNotebook<T extends { notebookId: ID }>(items: T[]): T[] {
  const queues = new Map<ID, { index: number; item: T }[]>()
  items.forEach((item, index) => {
    const queue = queues.get(item.notebookId)
    if (queue) queue.push({ index, item })
    else queues.set(item.notebookId, [{ index, item }])
  })
  const heads = new Map<ID, number>([...queues.keys()].map((id) => [id, 0]))
  const result: T[] = []
  let previous: ID | null = null
  while (result.length < items.length) {
    let best: { id: ID; remaining: number; index: number } | null = null
    for (const [id, queue] of queues) {
      const head = heads.get(id) ?? 0
      const remaining = queue.length - head
      if (remaining === 0) continue
      const candidate = { id, remaining, index: queue[head].index }
      if (best === null || ranksBefore(candidate, best, previous)) best = candidate
    }
    if (best === null) break
    const head = heads.get(best.id) ?? 0
    result.push((queues.get(best.id) ?? [])[head].item)
    heads.set(best.id, head + 1)
    previous = best.id
  }
  return result
}

function ranksBefore(
  a: { id: ID; remaining: number; index: number },
  b: { id: ID; remaining: number; index: number },
  previous: ID | null
): boolean {
  const aRepeats = a.id === previous
  const bRepeats = b.id === previous
  if (aRepeats !== bRepeats) return bRepeats
  return a.remaining > b.remaining || (a.remaining === b.remaining && a.index < b.index)
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

const ACCURACY_WINDOW = 20
const RECENCY_DECAY = 0.85
const MIN_ACCURACY_POINTS = 3
const WEAK_MIN_POINTS = 4
const WEAK_ACCURACY = 0.6
const OVERCONFIDENT_WINDOW_DAYS = 30
const WEAK_OVERCONFIDENT = 2
const MASTERED_MIN = 85
const MASTERED_REVIEW_SPAN_DAYS = 3

const PATH_PROGRESS: Record<PathStep | 'done', number> = {
  warmup: 0,
  learn: 0.2,
  explain: 0.4,
  practice: 0.6,
  remember: 0.8,
  done: 1
}

interface DataPoint {
  at: number
  id: string
  correct: boolean
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
 * - learning (again): pathStep null but answers or cards exist (e.g. only a mock exam touched it).
 * - reviewing: everything else.
 *
 * Exact formulas:
 * - Data points are the topic's answers (except warm-up answers: pre-test
 *   guesses happen before learning and are expected to be wrong) plus its
 *   review logs. Answers logged for a card review (source 'review', same card
 *   and timestamp as a review log) are the same event as the log, so only the
 *   log counts. answeredCount / missedCount cover all data points ever.
 * - accuracy = sum(w_i * correct_i) / sum(w_i) over the newest 20 data
 *   points, w_i = 0.85^i where i = 0 is the newest (the 20th weighs ~4%).
 * - memory = mean over cards with a review of R(t) = FSRS forgetting curve at
 *   the fractional days since the last review.
 * - pathDone = 0 not started, warmup 0, learn 0.2, explain 0.4, practice 0.6,
 *   remember 0.8, done 1.
 * - With A = accuracy (when >= 3 points) and M = memory (when any card was
 *   reviewed): mastery = round(100 * (0.5A + 0.4M + 0.1P) / (0.5[A] + 0.4[M] + 0.1)).
 *   With neither, there is no evidence of recall, so the path alone is only
 *   worth its own 10% share: mastery = round(10 * P).
 * - Overconfident errors: answers marked 'sure' that were wrong, plus reviews
 *   rated Again while 'sure' (unless already counted as an answer), in the 30
 *   days before `now`.
 */
export function computeTopicProgress(input: TopicProgressInput): TopicProgress {
  const { topic, now } = input
  const nowMs = now.getTime()
  const cards = input.cards.filter((c) => !c.suspended)

  const reviewKeys = new Set(input.reviews.map((r) => `${r.cardId}|${parseTime(r.reviewedAt)}`))
  const isLoggedReview = (a: AnswerRecord): boolean =>
    a.source === 'review' && a.cardId !== null && reviewKeys.has(`${a.cardId}|${parseTime(a.answeredAt)}`)
  const scoredAnswers = input.answers.filter((a) => a.source !== 'warmup' && !isLoggedReview(a))

  const points: DataPoint[] = [
    ...scoredAnswers.map((a) => ({ at: parseTime(a.answeredAt) ?? 0, id: a.id, correct: a.correct })),
    ...input.reviews.map((r) => ({ at: parseTime(r.reviewedAt) ?? 0, id: r.id, correct: r.rating >= 3 }))
  ].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))

  let accuracy: number | null = null
  if (points.length >= MIN_ACCURACY_POINTS) {
    let weighted = 0
    let total = 0
    points.slice(0, ACCURACY_WINDOW).forEach((p, i) => {
      const w = RECENCY_DECAY ** i
      total += w
      if (p.correct) weighted += w
    })
    accuracy = weighted / total
  }

  const reviewed = cards.filter((c) => c.state !== 'new' && c.lastReview !== null)
  const memory = reviewed.length > 0 ? reviewed.reduce((sum, c) => sum + retrievability(c, now), 0) / reviewed.length : null
  const pathDone = topic.pathStep === null ? 0 : PATH_PROGRESS[topic.pathStep]

  let mastery: number
  if (accuracy === null && memory === null) {
    mastery = Math.round(10 * pathDone)
  } else {
    let sum = 0.1 * pathDone
    let weight = 0.1
    if (accuracy !== null) {
      sum += 0.5 * accuracy
      weight += 0.5
    }
    if (memory !== null) {
      sum += 0.4 * memory
      weight += 0.4
    }
    mastery = Math.round((100 * sum) / weight)
  }
  mastery = Math.min(100, Math.max(0, mastery))

  const overconfidentSince = nowMs - OVERCONFIDENT_WINDOW_DAYS * DAY_MS
  const inWindow = (iso: string): boolean => {
    const t = parseTime(iso)
    return t !== null && t >= overconfidentSince && t <= nowMs
  }
  const overconfidentAnswers = input.answers.filter(
    (a) => a.source !== 'warmup' && a.confidence === 'sure' && !a.correct && inWindow(a.answeredAt)
  )
  const countedReviewKeys = new Set(
    overconfidentAnswers.filter((a) => a.source === 'review').map((a) => `${a.cardId}|${parseTime(a.answeredAt)}`)
  )
  const overconfidentReviews = input.reviews.filter(
    (r) =>
      r.confidence === 'sure' &&
      r.rating === 1 &&
      inWindow(r.reviewedAt) &&
      !countedReviewKeys.has(`${r.cardId}|${parseTime(r.reviewedAt)}`)
  )
  const overconfidentCount = overconfidentAnswers.length + overconfidentReviews.length

  const successfulReviewDays = input.reviews
    .filter((r) => r.rating >= 3)
    .map((r) => parseTime(r.reviewedAt))
    .filter((t): t is number => t !== null)
    .map((t) => localDate(new Date(t)))
    .sort()
  const provenOverTime =
    successfulReviewDays.length >= 2 &&
    daysBetween(successfulReviewDays[0], successfulReviewDays[successfulReviewDays.length - 1]) >= MASTERED_REVIEW_SPAN_DAYS

  let state: TopicProgress['state']
  if (topic.pathStep === null && input.answers.length === 0 && cards.length === 0) state = 'not_started'
  else if (topic.pathStep !== null && topic.pathStep !== 'done') state = 'learning'
  else if ((points.length >= WEAK_MIN_POINTS && accuracy !== null && accuracy < WEAK_ACCURACY) || overconfidentCount >= WEAK_OVERCONFIDENT)
    state = 'weak'
  else if (mastery >= MASTERED_MIN && provenOverTime) state = 'mastered'
  // Quiz or mock-exam answers (or hand-made cards) on a topic whose path was never
  // opened are a start, not a learned topic in spaced review.
  else if (topic.pathStep === null) state = 'learning'
  else state = 'reviewing'

  let nextReviewAt: string | null = null
  let nextReviewMs = Number.POSITIVE_INFINITY
  let dueCards = 0
  for (const card of cards) {
    const due = parseTime(card.due)
    if (due === null) continue
    if (due <= nowMs) dueCards += 1
    if (due < nextReviewMs) {
      nextReviewMs = due
      nextReviewAt = card.due
    }
  }

  let lastPracticedMs = Number.NEGATIVE_INFINITY
  let lastPracticedAt: string | null = null
  for (const iso of [...input.answers.map((a) => a.answeredAt), ...input.reviews.map((r) => r.reviewedAt)]) {
    const t = parseTime(iso)
    if (t !== null && t > lastPracticedMs) {
      lastPracticedMs = t
      lastPracticedAt = iso
    }
  }

  return {
    topicId: topic.id,
    state,
    mastery,
    recentAccuracy: accuracy === null ? null : Math.round(accuracy * 100),
    answeredCount: points.length,
    missedCount: points.filter((p) => !p.correct).length,
    overconfidentCount,
    cardCount: cards.length,
    dueCards,
    nextReviewAt,
    lastPracticedAt
  }
}

// ---------------------------------------------------------------------------
// Exams
// ---------------------------------------------------------------------------

function byCourseOrder(a: Topic, b: Topic): number {
  return a.orderIndex - b.orderIndex || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
}

/**
 * The topics an exam covers, in course order: `exam.topicIds`, or all of
 * `notebookTopics` when empty. `notebookTopics` must be the exam's notebook's topics.
 */
export function examTopics<T extends Topic>(exam: Exam, notebookTopics: T[]): T[] {
  if (exam.topicIds.length === 0) return [...notebookTopics].sort(byCourseOrder)
  const ids = new Set(exam.topicIds)
  return notebookTopics.filter((t) => ids.has(t.id)).sort(byCourseOrder)
}

/**
 * Readiness 0-100 = mean mastery of the topics the exam covers (all topics of
 * the notebook in course order when `exam.topicIds` is empty). Also returns the
 * 3 weakest covered topics and how many covered topics are not started.
 *
 * Not-started topics count as 0 in the readiness mean but are left out of
 * `weakest` (they are reported by `notStartedCount`), so `weakest` names
 * topics the learner has studied and should revisit. Ties keep course order.
 */
export function examReadiness(
  exam: Exam,
  notebookTopics: TopicWithProgress[]
): { readiness: number; weakest: { topicId: ID; title: string; mastery: number }[]; notStartedCount: number } {
  const covered = examTopics(exam, notebookTopics)
  if (covered.length === 0) return { readiness: 0, weakest: [], notStartedCount: 0 }
  const readiness = Math.round(covered.reduce((sum, t) => sum + t.progress.mastery, 0) / covered.length)
  const weakest = covered
    .filter((t) => t.progress.state !== 'not_started')
    .map((t, order) => ({ t, order }))
    .sort((a, b) => a.t.progress.mastery - b.t.progress.mastery || a.order - b.order)
    .slice(0, 3)
    .map(({ t }) => ({ topicId: t.id, title: t.title, mastery: t.progress.mastery }))
  const notStartedCount = covered.filter((t) => t.progress.state === 'not_started').length
  return { readiness, weakest, notStartedCount }
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

const REVIEW_SECONDS_PER_CARD = 40
const WEAK_MINUTES_PER_TOPIC = 5
const WEAK_TOPICS_MAX = 3
const LEARN_MINUTES_PER_TOPIC = 20
const MOCK_EXAM_MINUTES = 30
const MOCK_EXAM_WITHIN_DAYS = 3

const STEP_LABELS: Record<PathStep, string> = {
  warmup: 'Warm-up',
  learn: 'Learn',
  explain: 'Explain it',
  practice: 'Practice',
  remember: 'Remember'
}

/** The short name used for a notebook in plan text: its course code, else its name. */
export function notebookLabel(nb: { notebookName: string; notebookCode: string }): string {
  return nb.notebookCode.trim() || nb.notebookName.trim()
}

interface ExamRef {
  exam: Exam
  daysLeft: number
}

function compareExamRefs(a: ExamRef, b: ExamRef): number {
  return a.daysLeft - b.daysLeft || a.exam.name.localeCompare(b.exam.name) || a.exam.id.localeCompare(b.exam.id)
}

/** "your Oct 12 Midterm" */
function yourExam(ref: ExamRef, currentYear: number): string {
  return `your ${shortDateLabel(ref.exam.examDate, currentYear)} ${ref.exam.name}`
}

function whenLabel(daysLeft: number): string {
  if (daysLeft <= 0) return 'today'
  if (daysLeft === 1) return 'tomorrow'
  return `in ${daysLeft} days`
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function wholeCount(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
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
 *
 * Details: each learn topic and each exam within 3 days gets its own block, so
 * every block names one thing ("Learn: Binary search trees", "Mock exam:
 * Midterm"). A topic's exam is the nearest upcoming exam covering it.
 */
export function buildTodayPlan(input: TodayPlanInput): TodayPlan {
  const { now } = input
  const nowMs = now.getTime()
  const today = localDate(now)
  const currentYear = now.getFullYear()
  const blocks: PlanBlock[] = []

  const examRefs: ExamRef[] = input.exams
    .map((exam) => ({ exam, daysLeft: daysBetween(today, exam.examDate) }))
    .filter((ref) => ref.daysLeft >= 0)
    .sort(compareExamRefs)
  const topicsOf = (notebookId: ID): PlanTopic[] => input.topics.filter((t) => t.notebookId === notebookId)
  const examByTopic = new Map<ID, ExamRef>()
  for (const ref of examRefs) {
    for (const topic of examTopics(ref.exam, topicsOf(ref.exam.notebookId))) {
      if (!examByTopic.has(topic.id)) examByTopic.set(topic.id, ref)
    }
  }
  const examDays = (topicId: ID): number => examByTopic.get(topicId)?.daysLeft ?? Number.POSITIVE_INFINITY

  // 1. Reviews
  const due = input.dueCards
    .filter((c) => !c.suspended && (parseTime(c.due) ?? Number.POSITIVE_INFINITY) <= nowMs)
    .sort((a, b) => (parseTime(a.due) ?? 0) - (parseTime(b.due) ?? 0) || a.id.localeCompare(b.id))
  const reviewCards = interleaveByNotebook(due.slice(0, wholeCount(input.maxReviewsPerDay)))
  if (reviewCards.length > 0) {
    const labels = unique(reviewCards.map(notebookLabel))
    blocks.push({
      kind: 'review',
      title: `Review ${plural(reviewCards.length, 'card')}`,
      detail: labels.length > 1 ? `Mixed: ${labels.join(', ')}` : labels[0],
      reason:
        due.length > reviewCards.length
          ? `the ${reviewCards.length} most overdue of ${due.length}, before they slip from memory`
          : reviewCards.length === 1
            ? 'this one is about to slip from memory'
            : 'these are about to slip from memory',
      estMinutes: Math.ceil((reviewCards.length * REVIEW_SECONDS_PER_CARD) / 60),
      cardIds: reviewCards.map((c) => c.id),
      topicIds: unique(reviewCards.map((c) => c.topicId).filter((id): id is ID => id !== null)),
      notebookIds: unique(reviewCards.map((c) => c.notebookId))
    })
  }

  // 2. Weak spots
  const weak = input.topics
    .filter((t) => t.progress.state === 'weak')
    .sort(
      (a, b) =>
        examDays(a.id) - examDays(b.id) ||
        a.progress.mastery - b.progress.mastery ||
        byCourseOrder(a, b) ||
        notebookLabel(a).localeCompare(notebookLabel(b))
    )
    .slice(0, WEAK_TOPICS_MAX)
  if (weak.length > 0) {
    blocks.push({
      kind: 'weak',
      title: `Fix ${plural(weak.length, 'weak spot')}`,
      detail: weak.map((t) => t.title).join(' · '),
      reason: weakBlockReason(weak, examByTopic, currentYear),
      estMinutes: weak.length * WEAK_MINUTES_PER_TOPIC,
      cardIds: [],
      topicIds: weak.map((t) => t.id),
      notebookIds: unique(weak.map((t) => t.notebookId))
    })
  }

  // 3. Learn
  const planned = new Set(weak.map((t) => t.id))
  const isInProgress = (t: Topic): boolean => t.pathStep !== null && t.pathStep !== 'done'
  const crossNotebookOrder = (a: PlanTopic, b: PlanTopic): number =>
    a.orderIndex - b.orderIndex || notebookLabel(a).localeCompare(notebookLabel(b)) || byCourseOrder(a, b)
  const inProgress = input.topics
    .filter((t) => isInProgress(t) && !planned.has(t.id))
    .sort(
      (a, b) =>
        examDays(a.id) - examDays(b.id) ||
        (a.startedAt ?? '').localeCompare(b.startedAt ?? '') ||
        crossNotebookOrder(a, b)
    )
  const notStarted = input.topics
    // A topic touched only by quizzes or a mock exam has never been taught, so it still counts as new.
    .filter((t) => t.pathStep === null && (t.progress.state === 'not_started' || t.progress.state === 'learning') && !planned.has(t.id))
    .sort((a, b) => examDays(a.id) - examDays(b.id) || crossNotebookOrder(a, b))
  for (const topic of [...inProgress, ...notStarted].slice(0, wholeCount(input.newTopicsPerDay))) {
    blocks.push(learnBlock(topic, examByTopic.get(topic.id) ?? null, currentYear))
  }

  // 4. Mock exams
  for (const ref of examRefs.filter((r) => r.daysLeft <= MOCK_EXAM_WITHIN_DAYS)) {
    const notebookTopics = topicsOf(ref.exam.notebookId)
    const covered = examTopics(ref.exam, notebookTopics)
    const notebook = notebookTopics[0]
    const parts = [notebook ? notebookLabel(notebook) : '', covered.length > 0 ? plural(covered.length, 'topic') : '']
    if (covered.length > 0) parts.push(`${examReadiness(ref.exam, covered).readiness}% ready`)
    blocks.push({
      kind: 'exam_prep',
      title: `Mock exam: ${ref.exam.name}`,
      detail: parts.filter(Boolean).join(' · ') || ref.exam.name,
      reason: `${ref.exam.name} is ${whenLabel(ref.daysLeft)}: rehearse it under exam conditions`,
      estMinutes: MOCK_EXAM_MINUTES,
      cardIds: [],
      topicIds: covered.map((t) => t.id),
      notebookIds: [ref.exam.notebookId]
    })
  }

  return { date: today, blocks, totalMinutes: planMinutes(blocks), dueCount: due.length }
}

function weakBlockReason(weak: PlanTopic[], examByTopic: Map<ID, ExamRef>, currentYear: number): string {
  const base = weak.length === 1 ? 'you keep missing this one' : 'you keep missing these'
  const refs = weak.map((t) => examByTopic.get(t.id)).filter((r): r is ExamRef => r !== undefined)
  if (refs.length === 0) return base
  const exams = unique(refs.map((r) => r.exam.id))
  if (weak.length === 1) return `${base}, and it's on ${yourExam(refs[0], currentYear)}`
  const howMany =
    refs.length === weak.length ? (weak.length === 2 ? 'both are' : 'all are') : refs.length === 1 ? '1 is' : `${refs.length} are`
  if (exams.length === 1) return `${base}, and ${howMany} on ${yourExam(refs[0], currentYear)}`
  return `${base}, and ${howMany} on upcoming exams`
}

function learnBlock(topic: PlanTopic, exam: ExamRef | null, currentYear: number): PlanBlock {
  const step = topic.pathStep !== null && topic.pathStep !== 'done' ? topic.pathStep : null
  const detail = [notebookLabel(topic), topic.unitLabel.trim() || `topic ${topic.orderIndex + 1}`]
  if (step) detail.push(`pick up at ${STEP_LABELS[step]}`)
  let reason: string
  if (step) reason = exam ? `finish what you started before ${yourExam(exam, currentYear)}` : 'finish what you started'
  else reason = exam ? `next up before ${yourExam(exam, currentYear)}` : `next on the ${notebookLabel(topic)} syllabus`
  return {
    kind: 'learn',
    title: `Learn: ${topic.title}`,
    detail: detail.filter(Boolean).join(' · '),
    reason,
    estMinutes: LEARN_MINUTES_PER_TOPIC,
    cardIds: [],
    topicIds: [topic.id],
    notebookIds: [topic.notebookId]
  }
}

/**
 * One short reason for a weak topic, e.g. "sure but wrong 4 times", "on CS 310 Quiz 3 in 4 days", "missed 6 of 14".
 *
 * Picks the most actionable fact, in this order: repeated overconfident errors
 * (the most dangerous kind), an exam within two weeks, the miss count, recent
 * accuracy, overdue cards.
 */
export function weakTopicReason(progress: TopicProgress, nearestExam: { name: string; daysLeft: number } | null): string {
  if (progress.overconfidentCount >= 2) return `sure but wrong ${progress.overconfidentCount} times`
  if (nearestExam && nearestExam.daysLeft >= 0 && nearestExam.daysLeft <= 14) {
    return `on ${nearestExam.name} ${whenLabel(nearestExam.daysLeft)}`
  }
  if (progress.missedCount > 0) return `missed ${progress.missedCount} of ${progress.answeredCount}`
  if (progress.recentAccuracy !== null) return `${progress.recentAccuracy}% right lately`
  if (progress.dueCards > 0) return `${plural(progress.dueCards, 'card')} overdue`
  return 'needs another pass'
}

// ---------------------------------------------------------------------------
// Calibration and streaks
// ---------------------------------------------------------------------------

/** Accuracy by stated confidence. Always returns the three buckets in order sure, unsure, guess. */
export function calibration(answers: Pick<AnswerRecord, 'confidence' | 'correct'>[]): CalibrationBucket[] {
  return (['sure', 'unsure', 'guess'] as const).map((confidence) => {
    const bucket = answers.filter((a) => a.confidence === confidence)
    const correct = bucket.filter((a) => a.correct).length
    return {
      confidence,
      answered: bucket.length,
      correct,
      accuracy: bucket.length > 0 ? Math.round((100 * correct) / bucket.length) : null
    }
  })
}

/**
 * Consecutive days with study activity ending today (or yesterday, if nothing
 * has happened yet today). `activityDates` are local dates YYYY-MM-DD, any order, may repeat.
 */
export function streakDays(activityDates: string[], today: string): number {
  const days = new Set(activityDates.filter((d) => LOCAL_DATE_RE.test(d)))
  let day = days.has(today) ? today : addDays(today, -1)
  let streak = 0
  while (days.has(day)) {
    streak += 1
    day = addDays(day, -1)
  }
  return streak
}

/**
 * Planned review dates for newly created cards, as labels for the Remember step.
 *
 * Labels by whole local days from today: "Today", "Tomorrow", "In N days"
 * (2-6), "In N weeks" (7-27, rounded), "In N months" (28-60, rounded to 30-day
 * months), then the date itself ("Nov 3", with the year when it is not this
 * year). Sorted by date; one entry per date.
 */
export function reviewPlanLabels(dueDates: string[], now: Date): { label: string; date: string }[] {
  const today = localDate(now)
  const dates = unique(
    dueDates
      .map(parseTime)
      .filter((t): t is number => t !== null)
      .map((t) => localDate(new Date(t)))
  ).sort()
  return dates.map((date) => ({ label: reviewLabel(daysBetween(today, date), date, now.getFullYear()), date }))
}

function reviewLabel(days: number, date: string, currentYear: number): string {
  if (days <= 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 7) return `In ${days} days`
  if (days < 28) {
    const weeks = Math.round(days / 7)
    return weeks === 1 ? 'In 1 week' : `In ${weeks} weeks`
  }
  if (days <= 60) {
    const months = Math.round(days / 30)
    return months === 1 ? 'In 1 month' : `In ${months} months`
  }
  return shortDateLabel(date, currentYear)
}

/** Re-exported so callers can show a block's minutes consistently. */
export function planMinutes(blocks: PlanBlock[]): number {
  return blocks.reduce((sum, b) => sum + b.estMinutes, 0)
}

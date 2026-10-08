// Pure display logic for the Insights screen (unit-tested in Node, no DOM).

import type { AnswerSource, CalibrationBucket, Confidence, WeakTopic } from '@shared/types'
import { formatDate, pluralize } from '../../lib/format'
import type { ProgressTone } from '../ui'

// ---------------------------------------------------------------------------
// Bar charts
// ---------------------------------------------------------------------------

/** Smallest visible bar for a non-zero value, as a fraction of the tallest bar. */
export const MIN_BAR_FRACTION = 0.04

/**
 * Bar heights as fractions (0-1) of the tallest bar. Non-zero values keep a
 * visible sliver so "1" never looks the same as "0".
 */
export function barFractions(values: readonly number[]): number[] {
  const max = Math.max(0, ...values)
  if (max <= 0) return values.map(() => 0)
  return values.map((v) => (v <= 0 ? 0 : Math.max(MIN_BAR_FRACTION, v / max)))
}

/** Forecast column label: "Today" for the first day, then "Mon", "Tue"... */
export function forecastLabel(date: string, index: number): string {
  return index === 0 ? 'Today' : formatDate(date, 'weekday')
}

export interface StudyTotals {
  total: number
  /** Mean over every day in the range, including days off. */
  dailyAverage: number
  activeDays: number
}

export function studyTotals(days: readonly { minutes: number }[]): StudyTotals {
  const total = days.reduce((sum, d) => sum + Math.max(0, d.minutes), 0)
  return {
    total,
    dailyAverage: days.length > 0 ? Math.round(total / days.length) : 0,
    activeDays: days.filter((d) => d.minutes > 0).length
  }
}

// ---------------------------------------------------------------------------
// Weak topics
// ---------------------------------------------------------------------------

export interface MasteryStatus {
  label: string
  tone: ProgressTone
}

/** Plain-words status for a mastery percentage (thresholds from the prototype). */
export function masteryStatus(mastery: number): MasteryStatus {
  if (mastery < 60) return { label: 'Needs work', tone: 'bad' }
  if (mastery < 80) return { label: 'Getting there', tone: 'caution' }
  return { label: 'Strong', tone: 'good' }
}

/**
 * Status for a row of the weak-topic list. Every topic there is weak, so it
 * never reads "Strong" with a green bar: a high mastery with repeated
 * sure-but-wrong answers (the row's reason says so) is still "Getting there".
 */
export function weakTopicStatus(mastery: number): MasteryStatus {
  const status = masteryStatus(mastery)
  return status.tone === 'good' ? { label: 'Getting there', tone: 'caution' } : status
}

/** "CS 201" when the notebook has a code, else its name. */
export function subjectLabel(topic: Pick<WeakTopic, 'notebookCode' | 'notebookName'>): string {
  return topic.notebookCode.trim() || topic.notebookName
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

/** Buckets with fewer answers than this are too noisy to interpret. */
export const MIN_BUCKET_ANSWERS = 3
/** Fewer rated answers than this overall: show how to use the chart instead of a verdict. */
export const MIN_CALIBRATION_ANSWERS = 5

export const CALIBRATION_TONES: Record<Confidence, ProgressTone> = {
  sure: 'good',
  unsure: 'caution',
  guess: 'bad'
}

function bucketAccuracy(buckets: readonly CalibrationBucket[], confidence: Confidence): number | null {
  const bucket = buckets.find((b) => b.confidence === confidence)
  if (!bucket || bucket.answered < MIN_BUCKET_ANSWERS || bucket.accuracy === null) return null
  return bucket.accuracy
}

/** One sentence on what the confidence-vs-accuracy numbers mean for this learner. */
export function calibrationInterpretation(buckets: readonly CalibrationBucket[]): string {
  const total = buckets.reduce((sum, b) => sum + b.answered, 0)
  if (total < MIN_CALIBRATION_ANSWERS) {
    return 'Rate how sure you are on a few more answers and this will show whether that feeling matches your results.'
  }
  const sure = bucketAccuracy(buckets, 'sure')
  const guess = bucketAccuracy(buckets, 'guess')
  if (sure === null) return "You haven't marked many answers as Sure yet. Use it when you would bet on the answer."
  if (sure < 70) return `When you feel sure you are right only ${sure}% of the time, so pause and check before choosing Sure.`
  if (guess !== null && guess >= sure) {
    return 'You know more than you think: your guesses are right about as often as your sure answers.'
  }
  if (sure >= 85) return `Your confidence is well calibrated: when you feel sure, you are right ${sure}% of the time.`
  return `When you feel sure you are right ${sure}% of the time; aim for 90% before trusting that feeling.`
}

export interface OverconfidenceNote {
  /** "7 times" */
  times: string
  /** Topic most often answered sure-but-wrong, when one stands out. */
  topic: string | null
}

/**
 * The "sure but wrong" note under the calibration bars, or null when there
 * were none this week. The topic comes from the weak-topic list (30-day
 * counts), named only when it was sure-but-wrong at least twice.
 */
export function overconfidenceNote(overconfidentLast7Days: number, weakTopics: readonly WeakTopic[]): OverconfidenceNote | null {
  if (overconfidentLast7Days <= 0) return null
  const worst = weakTopics.reduce<WeakTopic | null>(
    (top, t) => (t.overconfidentCount > (top?.overconfidentCount ?? 0) ? t : top),
    null
  )
  return {
    times: pluralize(overconfidentLast7Days, 'time'),
    topic: worst && worst.overconfidentCount >= 2 ? worst.title : null
  }
}

// ---------------------------------------------------------------------------
// Mistake log
// ---------------------------------------------------------------------------

export const ANSWER_SOURCE_LABELS: Record<AnswerSource, string> = {
  warmup: 'Warm-up',
  check: 'Lesson check',
  practice: 'Practice',
  weak_spots: 'Weak spots',
  mock_exam: 'Mock exam',
  review: 'Review'
}

/** What the learner typed, or a clear placeholder for a blank answer. */
export function shownAnswer(text: string): string {
  const trimmed = text.trim()
  return trimmed ? trimmed : '(left blank)'
}

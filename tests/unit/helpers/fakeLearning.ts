// A deliberately simple stand-in for src/shared/learning.ts, used by
// services.isolated.test.ts so the service layer can be tested on its own
// (the real module is tested by its owner; services.flow.test.ts runs both
// together). Behaviour is predictable on purpose: Good doubles the interval,
// Again resets it, mastery is plain accuracy.

import type {
  AnswerRecord,
  CalibrationBucket,
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
  TopicProgress,
  TopicWithProgress
} from '@shared/types'
import type { PlanCard, PlanTopic, TodayPlanInput, TopicProgressInput } from '@shared/learning'

export type { PlanCard, PlanTopic, TodayPlanInput, TopicProgressInput }

const DAY = 86_400_000

export function localDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / DAY)
}

export function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase()
}

export function gradeResponse(q: Question, response: string): boolean {
  if (!response.trim()) return false
  return [q.answer, ...q.acceptable].some((a) => normalizeAnswer(a) === normalizeAnswer(response))
}

export function newCardSchedule(now: Date): CardSchedule {
  return {
    due: now.toISOString(),
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    state: 'new',
    lastReview: null
  }
}

export function adjustRatingForConfidence(rating: Rating, confidence: Confidence | null): Rating {
  return confidence === 'guess' && rating >= 3 ? 2 : rating
}

function nextDays(card: CardSchedule, rating: Rating): number {
  if (rating === 1) return 0
  return Math.max(1, card.scheduledDays * 2) * (rating === 4 ? 2 : 1)
}

export function previewRatings(card: CardSchedule, now: Date, desiredRetention: number): RatingPreview[] {
  void desiredRetention
  return ([1, 2, 3, 4] as Rating[]).map((rating) => {
    const days = nextDays(card, rating)
    return { rating, intervalLabel: days === 0 ? '10 min' : `${days} days`, due: new Date(now.getTime() + (days || 1 / 144) * DAY).toISOString() }
  })
}

export function applyRating(
  card: CardSchedule,
  rating: Rating,
  now: Date,
  desiredRetention: number
): { schedule: CardSchedule; log: Pick<ReviewLog, 'stateBefore' | 'scheduledDays' | 'elapsedDays'> } {
  void desiredRetention
  const days = nextDays(card, rating)
  const schedule: CardSchedule = {
    ...card,
    due: new Date(now.getTime() + (days || 1 / 144) * DAY).toISOString(),
    stability: days,
    scheduledDays: days,
    reps: card.reps + 1,
    lapses: card.lapses + (rating === 1 ? 1 : 0),
    state: rating === 1 ? 'relearning' : 'review',
    lastReview: now.toISOString()
  }
  return { schedule, log: { stateBefore: card.state, scheduledDays: days, elapsedDays: 0 } }
}

export function retrievability(card: CardSchedule, now: Date): number {
  void now
  return card.lastReview ? 0.9 : 0
}

export function formatInterval(ms: number): string {
  return `${Math.round(ms / DAY)} days`
}

export function forecastDue(cards: Pick<CardSchedule, 'due'>[], from: Date, days: number): ForecastDay[] {
  return Array.from({ length: days }, (_, i) => {
    const date = localDate(new Date(from.getFullYear(), from.getMonth(), from.getDate() + i))
    const due = cards.filter((c) => {
      const d = localDate(new Date(c.due))
      return i === 0 ? d <= date : d === date
    }).length
    return { date, due }
  })
}

export function interleaveByNotebook<T extends { notebookId: ID }>(items: T[]): T[] {
  return items
}

export function computeTopicProgress(input: TopicProgressInput): TopicProgress {
  const { topic, answers, cards, reviews, now } = input
  const correct = answers.filter((a) => a.correct).length
  const accuracy = answers.length > 0 ? correct / answers.length : null
  const overconfident = answers.filter((a) => a.confidence === 'sure' && !a.correct).length
  const notStarted = topic.pathStep === null && answers.length === 0 && cards.length === 0
  const mastery = accuracy === null ? 0 : Math.round(accuracy * 100)
  let state: TopicProgress['state'] = 'reviewing'
  if (notStarted) state = 'not_started'
  else if ((answers.length >= 4 && (accuracy ?? 1) < 0.6) || overconfident >= 2) state = 'weak'
  else if (topic.pathStep !== null && topic.pathStep !== 'done') state = 'learning'
  else if (mastery >= 85) state = 'mastered'
  const dueCards = cards.filter((c) => c.due <= now.toISOString())
  const lastReview = reviews.map((r) => r.reviewedAt).sort().at(-1) ?? null
  const lastAnswer = answers.map((a) => a.answeredAt).sort().at(-1) ?? null
  return {
    topicId: topic.id,
    state,
    mastery,
    recentAccuracy: answers.length >= 3 && accuracy !== null ? Math.round(accuracy * 100) : null,
    answeredCount: answers.length,
    missedCount: answers.length - correct,
    overconfidentCount: overconfident,
    cardCount: cards.length,
    dueCards: dueCards.length,
    nextReviewAt: cards.map((c) => c.due).sort()[0] ?? null,
    lastPracticedAt: [lastReview, lastAnswer].filter((x): x is string => x !== null).sort().at(-1) ?? null
  }
}

export function examReadiness(
  exam: Exam,
  notebookTopics: TopicWithProgress[]
): { readiness: number; weakest: { topicId: ID; title: string; mastery: number }[]; notStartedCount: number } {
  const covered = exam.topicIds.length > 0 ? notebookTopics.filter((t) => exam.topicIds.includes(t.id)) : notebookTopics
  const readiness = covered.length > 0 ? Math.round(covered.reduce((s, t) => s + t.progress.mastery, 0) / covered.length) : 0
  const weakest = [...covered]
    .sort((a, b) => a.progress.mastery - b.progress.mastery)
    .slice(0, 3)
    .map((t) => ({ topicId: t.id, title: t.title, mastery: t.progress.mastery }))
  return { readiness, weakest, notStartedCount: covered.filter((t) => t.progress.state === 'not_started').length }
}

export function buildTodayPlan(input: TodayPlanInput): TodayPlan {
  const blocks: PlanBlock[] = []
  const reviews = input.dueCards.slice(0, input.maxReviewsPerDay)
  if (reviews.length > 0) {
    blocks.push({
      kind: 'review',
      title: 'Review',
      detail: `${reviews.length} cards`,
      reason: 'about to be forgotten',
      estMinutes: Math.max(1, Math.round(reviews.length * 40 / 60)),
      cardIds: reviews.map((c) => c.id),
      topicIds: [],
      notebookIds: [...new Set(reviews.map((c) => c.notebookId))]
    })
  }
  const learn = input.topics.filter((t) => t.pathStep !== 'done').slice(0, input.newTopicsPerDay)
  if (learn.length > 0) {
    blocks.push({
      kind: 'learn',
      title: 'Learn',
      detail: learn.map((t) => t.title).join(', '),
      reason: 'next in your course',
      estMinutes: 20 * learn.length,
      cardIds: [],
      topicIds: learn.map((t) => t.id),
      notebookIds: [...new Set(learn.map((t) => t.notebookId))]
    })
  }
  return { date: localDate(input.now), blocks, totalMinutes: planMinutes(blocks), dueCount: input.dueCards.length }
}

export function weakTopicReason(progress: TopicProgress, nearestExam: { name: string; daysLeft: number } | null): string {
  if (nearestExam) return `on ${nearestExam.name} in ${nearestExam.daysLeft} days`
  return `missed ${progress.missedCount} of ${progress.answeredCount}`
}

export function calibration(answers: Pick<AnswerRecord, 'confidence' | 'correct'>[]): CalibrationBucket[] {
  return (['sure', 'unsure', 'guess'] as Confidence[]).map((confidence) => {
    const bucket = answers.filter((a) => a.confidence === confidence)
    const correct = bucket.filter((a) => a.correct).length
    return { confidence, answered: bucket.length, correct, accuracy: bucket.length ? Math.round((100 * correct) / bucket.length) : null }
  })
}

export function streakDays(activityDates: string[], today: string): number {
  const dates = new Set(activityDates)
  let day = dates.has(today) ? today : localDate(new Date(Date.parse(`${today}T12:00:00`) - DAY))
  let streak = 0
  while (dates.has(day)) {
    streak++
    day = localDate(new Date(Date.parse(`${day}T12:00:00`) - DAY))
  }
  return streak
}

export function reviewPlanLabels(dueDates: string[], now: Date): { label: string; date: string }[] {
  void now
  return dueDates.map((d) => {
    const date = localDate(new Date(d))
    return { label: date, date }
  })
}

export function planMinutes(blocks: PlanBlock[]): number {
  return blocks.reduce((sum, b) => sum + b.estMinutes, 0)
}

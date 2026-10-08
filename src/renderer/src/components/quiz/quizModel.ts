// Pure quiz logic shared by the question views, runners and results: option
// letters and keys, answer drafts, the mock exam timer and feedback copy.
// No DOM or React here, so it is unit-tested in Node.

import {
  QUESTION_TYPES,
  type Confidence,
  type ID,
  type Question,
  type Quiz,
  type QuizAnswer,
  type QuizSettings
} from '@shared/types'

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const LETTERS = 'ABCDEFGH'

/** "A" for the first option, "B" for the second... */
export function optionLetter(index: number): string {
  return LETTERS[index] ?? String(index + 1)
}

/**
 * The option a key press picks: "1"-"5" or "a"-"e" (either case). Null when
 * the key does not name one of the `count` options.
 */
export function optionIndexForKey(key: string, count: number): number | null {
  const lower = key.toLowerCase()
  let index = -1
  if (/^[1-9]$/.test(lower)) index = Number(lower) - 1
  else if (/^[a-h]$/.test(lower)) index = lower.charCodeAt(0) - 97
  return index >= 0 && index < Math.min(count, 5) ? index : null
}

/** Multiple choice and true/false are answered by picking; the others are typed. */
export function isChoiceQuestion(question: Pick<Question, 'type' | 'options'>): boolean {
  return (question.type === 'mc' || question.type === 'tf') && question.options.length > 0
}

/** Hotkey string for option pickers: "1, a" ... one entry per option (up to five). */
export function optionHotkeys(count: number): string[] {
  return Array.from({ length: Math.min(count, 5) }, (_, i) => `${i + 1}, ${LETTERS[i]!.toLowerCase()}`)
}

// ---------------------------------------------------------------------------
// Drafts (what the learner has entered before submitting)
// ---------------------------------------------------------------------------

export interface DraftAnswer {
  response: string
  confidence: Confidence | null
}

export type DraftMap = Readonly<Record<ID, DraftAnswer>>

export const EMPTY_DRAFT: DraftAnswer = { response: '', confidence: null }

/** Answers already saved on the quiz (resuming after a reload). */
export function draftsFromQuiz(quiz: Pick<Quiz, 'answers'>): Record<ID, DraftAnswer> {
  const drafts: Record<ID, DraftAnswer> = {}
  for (const answer of quiz.answers) drafts[answer.questionId] = { response: answer.response, confidence: answer.confidence }
  return drafts
}

export function isAnswered(draft: DraftAnswer | undefined): boolean {
  return !!draft && draft.response.trim() !== ''
}

export function sameDraft(a: DraftAnswer | undefined, b: DraftAnswer | undefined): boolean {
  return (a?.response ?? '') === (b?.response ?? '') && (a?.confidence ?? null) === (b?.confidence ?? null)
}

export function countAnswered(questions: readonly Pick<Question, 'id'>[], drafts: DraftMap): number {
  return questions.filter((q) => isAnswered(drafts[q.id])).length
}

/** 1-based numbers of the questions without an answer, in order. */
export function unansweredNumbers(questions: readonly Pick<Question, 'id'>[], drafts: DraftMap): number[] {
  const numbers: number[] = []
  questions.forEach((q, i) => {
    if (!isAnswered(drafts[q.id])) numbers.push(i + 1)
  })
  return numbers
}

/** Answered questions that still have no confidence rating. */
export function missingConfidenceCount(questions: readonly Pick<Question, 'id'>[], drafts: DraftMap): number {
  return questions.filter((q) => isAnswered(drafts[q.id]) && drafts[q.id]?.confidence === null).length
}

// ---------------------------------------------------------------------------
// Mock exam timer
// ---------------------------------------------------------------------------

/**
 * When a timed quiz ends (epoch ms), computed from when it was started so the
 * countdown survives reloads. Null for untimed quizzes or before the start.
 */
export function examDeadline(startedAt: string | null, timeLimitMin: number | null): number | null {
  if (timeLimitMin === null || timeLimitMin <= 0 || !startedAt) return null
  const start = Date.parse(startedAt)
  if (Number.isNaN(start)) return null
  return start + timeLimitMin * 60_000
}

/** Milliseconds left (never negative), or null when there is no deadline. */
export function remainingMs(deadline: number | null, now: number): number | null {
  if (deadline === null) return null
  return Math.max(0, deadline - now)
}

export type TimerTone = 'normal' | 'low' | 'critical'

/** Under 5 minutes the timer turns amber, under 1 minute red. */
export function timerTone(remaining: number | null): TimerTone {
  if (remaining === null) return 'normal'
  if (remaining <= 60_000) return 'critical'
  if (remaining <= 5 * 60_000) return 'low'
  return 'normal'
}

/**
 * Whole minutes left worth announcing to screen readers (10, 5 and 1), so
 * the ticking clock itself stays silent.
 */
export function timerAnnouncement(remaining: number | null): string | null {
  if (remaining === null) return null
  const minutes = Math.ceil(remaining / 60_000)
  if (minutes === 10 || minutes === 5) return `${minutes} minutes left`
  if (minutes === 1) return '1 minute left'
  return null
}

// ---------------------------------------------------------------------------
// Navigator (mock exam)
// ---------------------------------------------------------------------------

export interface NavigatorItem {
  questionId: ID
  number: number
  answered: boolean
  flagged: boolean
  current: boolean
}

export function navigatorItems(
  questions: readonly Pick<Question, 'id'>[],
  drafts: DraftMap,
  flags: ReadonlySet<ID>,
  currentIndex: number
): NavigatorItem[] {
  return questions.map((q, i) => ({
    questionId: q.id,
    number: i + 1,
    answered: isAnswered(drafts[q.id]),
    flagged: flags.has(q.id),
    current: i === currentIndex
  }))
}

/** Accessible name of a navigator button: "Question 3, answered, flagged". */
export function navigatorLabel(item: NavigatorItem): string {
  return [`Question ${item.number}`, item.answered ? 'answered' : 'not answered', item.flagged && 'flagged for review']
    .filter(Boolean)
    .join(', ')
}

// ---------------------------------------------------------------------------
// Feedback and results
// ---------------------------------------------------------------------------

export type FeedbackKind = 'correct' | 'overconfident' | 'wrong' | 'unanswered'

export interface AnswerFeedbackCopy {
  kind: FeedbackKind
  title: string
}

/** The bold first line of a graded question's feedback. */
export function answerFeedback(question: Pick<Question, 'answer'>, answer: QuizAnswer | undefined): AnswerFeedbackCopy {
  if (answer?.correct) return { kind: 'correct', title: 'Correct.' }
  if (!answer || answer.response.trim() === '') return { kind: 'unanswered', title: `Not answered. The answer is ${question.answer}.` }
  if (answer.confidence === 'sure') {
    return { kind: 'overconfident', title: `You were sure, but the answer is ${question.answer}. Flagged for review.` }
  }
  return { kind: 'wrong', title: `Not quite. The answer is ${question.answer}.` }
}

export function scorePercent(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0
}

/** A warm one-liner (Caveat) above the score. */
export function scoreKicker(correct: number, total: number): string {
  const pct = scorePercent(correct, total)
  if (total === 0) return 'nothing to grade'
  if (pct === 100) return 'every single one!'
  if (pct >= 80) return 'strong work'
  if (pct >= 60) return 'getting there'
  if (pct >= 40) return 'good practice, keep going'
  return 'mistakes now mean fewer later'
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const PRACTICE_COUNTS = [5, 10, 20] as const

export const DEFAULT_PRACTICE_SETTINGS: QuizSettings = {
  types: [...QUESTION_TYPES],
  count: 10,
  difficulty: 'mixed',
  focusWeak: false,
  interleave: true,
  timeLimitMin: null
}

/** The newest quiz made for a topic's Practice step, if any. */
export function latestTopicQuiz(quizzes: readonly Quiz[], topicId: ID): Quiz | null {
  let latest: Quiz | null = null
  for (const quiz of quizzes) {
    if (quiz.topicId !== topicId || quiz.kind !== 'practice') continue
    if (!latest || quiz.createdAt > latest.createdAt) latest = quiz
  }
  return latest
}

export interface TopicLabelInfo {
  title: string
  unitLabel: string
}

/**
 * The topic line above a question. In a topic's practice quiz, questions
 * from earlier topics say so ("Heaps, from Week 5"), which is the point of
 * interleaving: noticing which idea a question needs.
 */
export function questionTopicLabel(
  question: Pick<Question, 'topicId'>,
  quizTopicId: ID | null,
  topics: ReadonlyMap<ID, TopicLabelInfo>
): string | null {
  const topic = question.topicId ? topics.get(question.topicId) : undefined
  if (!topic) return null
  const earlier = quizTopicId !== null && question.topicId !== quizTopicId
  if (!earlier) return topic.title
  return topic.unitLabel ? `${topic.title}, from ${topic.unitLabel}` : `${topic.title}, an earlier topic`
}

/** "question 4", "questions 2, 5 and 9", "questions 1, 2, 3, 4, 5 and 6 more". */
export function describeQuestionNumbers(numbers: readonly number[], max = 5): string {
  if (numbers.length === 0) return ''
  if (numbers.length === 1) return `question ${numbers[0]}`
  if (numbers.length <= max) {
    const head = numbers.slice(0, -1).join(', ')
    return `questions ${head} and ${numbers[numbers.length - 1]}`
  }
  return `questions ${numbers.slice(0, max).join(', ')} and ${numbers.length - max} more`
}

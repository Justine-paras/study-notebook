// Pure display logic for the Notebook page: topic row wording, exam
// readiness, mock exam settings, card filters. No DOM or React here so it
// can be unit-tested in Node (model.test.ts).

import {
  QUESTION_TYPES,
  SOURCE_KINDS,
  type Card,
  type Exam,
  type ID,
  type MasteryState,
  type Note,
  type NoteKind,
  type PathStep,
  type Quiz,
  type Source,
  type TopicWithProgress
} from '@shared/types'
import type { CreateQuizInput, SyllabusResult } from '@shared/api'
import { MOCK_EXAM_MINUTES as PLAN_MOCK_EXAM_MINUTES } from '@shared/learning'
import {
  PATH_STEP_LABELS,
  SOURCE_KIND_LABELS,
  daysBetween,
  formatDate,
  formatFileSize,
  formatList,
  formatRelativeDays,
  parseDate,
  pluralize,
  toLocalDateKey
} from '../../lib/format'

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

export type TopicActionLabel = 'Learn' | 'Continue' | 'Relearn' | 'Review'

export interface TopicAction {
  label: TopicActionLabel
  /** Filled button for topics that need attention now (in progress or weak), outline otherwise. */
  emphasis: boolean
}

export function topicAction(state: MasteryState): TopicAction {
  switch (state) {
    case 'not_started':
      return { label: 'Learn', emphasis: false }
    case 'learning':
      return { label: 'Continue', emphasis: true }
    case 'weak':
      return { label: 'Relearn', emphasis: true }
    case 'reviewing':
    case 'mastered':
      return { label: 'Review', emphasis: false }
  }
}

const STEP_ORDER: readonly PathStep[] = ['warmup', 'learn', 'explain', 'practice', 'remember']

/** "Step 2 of 5: Learn, part 3". */
export function pathStepLine(step: PathStep, chunkIndex: number): string {
  const index = STEP_ORDER.indexOf(step)
  const base = `Step ${index + 1} of ${STEP_ORDER.length}: ${PATH_STEP_LABELS[step].label}`
  return step === 'learn' && chunkIndex > 0 ? `${base}, part ${chunkIndex + 1}` : base
}

/** "Review due today", "Review due tomorrow", "Next review Oct 12", or null without cards. */
export function nextReviewLine(nextReviewAt: string | null, dueCards: number, now: Date): string | null {
  if (dueCards > 0) return `${pluralize(dueCards, 'card')} due now`
  if (!nextReviewAt) return null
  const days = daysBetween(now, nextReviewAt)
  if (days <= 0) return 'Review due today'
  if (days === 1) return 'Review due tomorrow'
  return `Next review ${formatDate(nextReviewAt, 'medium', now)}`
}

export interface TopicStatusContext {
  now: Date
  /** The next exam and the topics it covers, to flag topics that are on it. */
  nextExam: { exam: Exam; topicIds: ReadonlySet<ID> } | null
}

/** The small grey line under a topic's title: where the learner is and what comes next. */
export function topicStatusLine(topic: TopicWithProgress, context: TopicStatusContext): string {
  const { progress } = topic
  const { now, nextExam } = context
  const onExam = nextExam !== null && nextExam.topicIds.has(topic.id)
  const examNote = onExam ? `On ${nextExam.exam.name} ${formatRelativeDays(nextExam.exam.examDate, now)}` : null

  switch (progress.state) {
    case 'not_started':
      return examNote ?? 'Not started yet'
    case 'learning': {
      // Quizzes or a mock exam can touch a topic before its lesson is ever opened.
      if (topic.pathStep === null) {
        const answered =
          progress.answeredCount > 0 ? `${progress.answeredCount - progress.missedCount} of ${progress.answeredCount} right so far` : null
        return [answered ?? 'Lesson not opened yet', examNote].filter(Boolean).join(' · ')
      }
      const step = topic.pathStep !== 'done' ? topic.pathStep : 'warmup'
      return pathStepLine(step, topic.chunkIndex)
    }
    case 'weak': {
      const parts: string[] = []
      if (progress.answeredCount > 0) parts.push(`Missed ${progress.missedCount} of ${progress.answeredCount}`)
      if (progress.overconfidentCount > 0) parts.push(`sure but wrong ${pluralize(progress.overconfidentCount, 'time')}`)
      parts.push(progress.dueCards > 0 ? 'review today' : 'worth relearning')
      return parts.join(' · ')
    }
    case 'reviewing':
    case 'mastered':
      return nextReviewLine(progress.nextReviewAt, progress.dueCards, now) ?? 'No reviews scheduled'
  }
}

/** Ids in a new order after moving `id` one place up or down, or null when it can't move. */
export function moveId(ids: readonly ID[], id: ID, direction: 'up' | 'down'): ID[] | null {
  const index = ids.indexOf(id)
  if (index === -1) return null
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= ids.length) return null
  const next = [...ids]
  next[index] = ids[target]!
  next[target] = id
  return next
}

/** Applies an id order to a list (items missing from `orderedIds` keep their place at the end). */
export function applyOrder<T extends { id: ID }>(items: readonly T[], orderedIds: readonly ID[]): T[] {
  const rank = new Map(orderedIds.map((id, i) => [id, i]))
  return [...items].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity))
}

export interface TopicOption {
  value: ID
  label: string
}

/** Options for topic pickers, in course order: "Week 4 · Binary search trees". */
export function topicOptions(topics: readonly TopicWithProgress[]): TopicOption[] {
  return [...topics]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((t) => ({ value: t.id, label: t.unitLabel ? `${t.unitLabel} · ${t.title}` : t.title }))
}

// ---------------------------------------------------------------------------
// Exams
// ---------------------------------------------------------------------------

/** The topic ids an exam covers. An empty list on the exam means every topic of the notebook. */
export function examCoveredIds(exam: Pick<Exam, 'topicIds'>, topics: readonly { id: ID }[]): Set<ID> {
  if (exam.topicIds.length === 0) return new Set(topics.map((t) => t.id))
  const existing = new Set(topics.map((t) => t.id))
  // Topics deleted after the exam was saved are ignored.
  return new Set(exam.topicIds.filter((id) => existing.has(id)))
}

/** Mean mastery (0-100) of the exam's topics, null when it covers none. */
export function examReadiness(exam: Pick<Exam, 'topicIds'>, topics: readonly TopicWithProgress[]): number | null {
  const ids = examCoveredIds(exam, topics)
  const covered = topics.filter((t) => ids.has(t.id))
  if (covered.length === 0) return null
  return Math.round(covered.reduce((sum, t) => sum + t.progress.mastery, 0) / covered.length)
}

/** "Covers all topics", "Covers 4 topics". */
export function examCoverageLine(exam: Pick<Exam, 'topicIds'>, topics: readonly { id: ID }[]): string {
  if (exam.topicIds.length === 0) return 'Covers all topics'
  return `Covers ${pluralize(examCoveredIds(exam, topics).size, 'topic')}`
}

/** Upcoming exams soonest first (today counts as upcoming), past exams latest first. */
export function splitExams(exams: readonly Exam[], now: Date): { upcoming: Exam[]; past: Exam[] } {
  const today = toLocalDateKey(now)
  const upcoming = exams.filter((e) => e.examDate >= today).sort((a, b) => a.examDate.localeCompare(b.examDate))
  const past = exams.filter((e) => e.examDate < today).sort((a, b) => b.examDate.localeCompare(a.examDate))
  return { upcoming, past }
}

/** "Oct 12 · in 9 days", "Oct 3 · today", "Sep 20 · 2 weeks ago". */
export function examWhenLine(examDate: string, now: Date): string {
  return `${formatDate(examDate, 'medium', now)} · ${formatRelativeDays(examDate, now)}`
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/** True for a real calendar date in "YYYY-MM-DD" form (what <input type="date"> produces). */
export function isValidDateKey(value: string): boolean {
  if (!DATE_KEY_RE.test(value)) return false
  // parseDate rolls invalid days over (Feb 30 -> Mar 2), so compare the round trip.
  return toLocalDateKey(parseDate(value)) === value
}

// ---------------------------------------------------------------------------
// Mock exams
// ---------------------------------------------------------------------------

// The default time limit is also the length Today's plan budgets for a mock exam.
export const MOCK_EXAM_DEFAULTS = { count: 30, timeLimitMin: PLAN_MOCK_EXAM_MINUTES } as const
export const MOCK_EXAM_COUNTS = [10, 20, 30, 40] as const
export const MOCK_EXAM_MINUTES = [30, 45, 60, 90] as const

/** A mock exam: every question type, mixed difficulty, weighted toward weak spots, exam topics only. */
export function mockExamInput(
  notebookId: ID,
  exam: Pick<Exam, 'name' | 'topicIds'> | null,
  count: number,
  timeLimitMin: number
): CreateQuizInput {
  return {
    notebookId,
    topicId: null,
    kind: 'mock_exam',
    settings: {
      types: [...QUESTION_TYPES],
      count,
      difficulty: 'mixed',
      timeLimitMin,
      focusWeak: true,
      // A mock exam already spans the exam's topics; interleaving would pull in topics it doesn't cover.
      interleave: false
    },
    topicIds: exam ? [...exam.topicIds] : [],
    title: exam ? `Mock exam: ${exam.name}` : 'Mock exam'
  }
}

export interface MockAttemptSummary {
  /** "31/40", or null when not submitted. */
  score: string | null
  /** 0-100, or null when not submitted. */
  percent: number | null
  /** "Sep 28" (submitted), "Started Sep 28" or "Not started". */
  when: string
  status: 'submitted' | 'in_progress' | 'not_started'
}

export function mockAttemptSummary(quiz: Quiz, now: Date): MockAttemptSummary {
  const total = quiz.questions.length
  if (quiz.submittedAt) {
    const correct = quiz.score ?? 0
    return {
      score: `${correct}/${total}`,
      percent: total > 0 ? Math.round((correct / total) * 100) : 0,
      when: formatDate(quiz.submittedAt, 'medium', now),
      status: 'submitted'
    }
  }
  if (quiz.startedAt) {
    return { score: null, percent: null, when: `Started ${formatDate(quiz.startedAt, 'medium', now)}`, status: 'in_progress' }
  }
  return { score: null, percent: null, when: `Made ${formatDate(quiz.createdAt, 'medium', now)}`, status: 'not_started' }
}

/** Newest first. */
export function sortAttempts(quizzes: readonly Quiz[]): Quiz[] {
  return [...quizzes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// ---------------------------------------------------------------------------
// Sources and syllabus
// ---------------------------------------------------------------------------

export const SOURCE_KIND_OPTIONS = SOURCE_KINDS.map((kind) => ({ value: kind, label: SOURCE_KIND_LABELS[kind] }))

/** "24 pages · 3.4 MB" (slides for PowerPoint files). */
export function sourceMetaLine(source: Pick<Source, 'ext' | 'pageCount' | 'sizeBytes'>): string {
  const parts: string[] = []
  if (source.pageCount !== null && source.pageCount > 0) {
    parts.push(pluralize(source.pageCount, source.ext === 'pptx' ? 'slide' : 'page'))
  }
  parts.push(formatFileSize(source.sizeBytes))
  return parts.join(' · ')
}

/**
 * Files topics can be read from: ready syllabus files, or (when the caller
 * lets the learner choose and none is marked as a syllabus) any ready file.
 */
export function syllabusCandidates(sources: readonly Source[], fallbackToAll = false): Source[] {
  const ready = sources.filter((s) => s.status === 'ready')
  const syllabi = ready.filter((s) => s.kind === 'syllabus')
  if (syllabi.length > 0 || !fallbackToAll) return syllabi
  return ready
}

export interface SyllabusSummary {
  tone: 'good' | 'info'
  title: string
  message: string
}

/** The toast after reading a syllabus. */
export function syllabusSummary(result: SyllabusResult, fileName: string): SyllabusSummary {
  const topics = result.topicsAdded.length
  const exams = result.examsAdded.length
  const skipped = result.topicsSkipped.length
  const added: string[] = []
  if (topics > 0) added.push(pluralize(topics, 'topic'))
  if (exams > 0) added.push(pluralize(exams, 'exam date'))
  let skippedNote = ''
  if (skipped === 1) skippedNote = ' 1 topic was already here and was kept as it was.'
  else if (skipped > 1) skippedNote = ` ${skipped} topics were already here and were kept as they were.`
  if (added.length === 0) {
    return {
      tone: 'info',
      title: 'No new topics',
      message: `Nothing new was found in ${fileName}.${skippedNote}`.trim()
    }
  }
  return {
    tone: 'good',
    title: 'Topics added',
    message: `Added ${formatList(added)} from ${fileName}.${skippedNote}`
  }
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export const NOTE_KIND_LABELS: Record<NoteKind, string> = {
  note: 'Note',
  summary: 'Summary',
  explanation: 'Explanation'
}

/** Most recently edited first. */
export function sortNotes(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** A plain-text preview of a Markdown note (first non-empty line without Markdown symbols). */
export function notePreview(body: string, maxLength = 90): string {
  const line =
    body
      .split('\n')
      .map((l) =>
        l
          .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/, '')
          .replace(/[*_`~]/g, '')
          .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
          .trim()
      )
      .find((l) => l.length > 0 && !/^[-=]{3,}$/.test(l)) ?? ''
  return line.length > maxLength ? `${line.slice(0, maxLength - 1).trimEnd()}…` : line
}

// ---------------------------------------------------------------------------
// Flashcards
// ---------------------------------------------------------------------------

export type CardStatusFilter = 'all' | 'due' | 'new' | 'suspended'

export interface CardFilter {
  query: string
  /** A topic id, 'all', or 'none' (cards without a topic). */
  topic: ID | 'all' | 'none'
  status: CardStatusFilter
}

export function isCardDue(card: Pick<Card, 'due' | 'suspended'>, now: Date): boolean {
  return !card.suspended && parseDate(card.due).getTime() <= now.getTime()
}

export function filterCards(cards: readonly Card[], filter: CardFilter, now: Date): Card[] {
  const query = filter.query.trim().toLowerCase()
  return cards.filter((card) => {
    if (filter.topic === 'none' && card.topicId !== null) return false
    if (filter.topic !== 'all' && filter.topic !== 'none' && card.topicId !== filter.topic) return false
    if (filter.status === 'due' && !isCardDue(card, now)) return false
    if (filter.status === 'new' && (card.state !== 'new' || card.suspended)) return false
    if (filter.status === 'suspended' && !card.suspended) return false
    if (query && !card.front.toLowerCase().includes(query) && !card.back.toLowerCase().includes(query)) return false
    return true
  })
}

export interface CardCounts {
  total: number
  due: number
  fresh: number
  suspended: number
  /** Cards whose memory has lasted at least 3 weeks. */
  longTerm: number
}

export function countCards(cards: readonly Card[], now: Date): CardCounts {
  let due = 0
  let fresh = 0
  let suspended = 0
  let longTerm = 0
  for (const card of cards) {
    if (card.suspended) {
      suspended += 1
      continue
    }
    if (isCardDue(card, now)) due += 1
    if (card.state === 'new') fresh += 1
    if (card.stability >= 21) longTerm += 1
  }
  return { total: cards.length, due, fresh, suspended, longTerm }
}

/** "Suspended", "New", "Due now", "Due tomorrow", "Due in 4 days". */
export function cardDueLabel(card: Pick<Card, 'due' | 'suspended' | 'state'>, now: Date): string {
  if (card.suspended) return 'Suspended'
  if (card.state === 'new') return 'New'
  if (parseDate(card.due).getTime() <= now.getTime()) return 'Due now'
  const relative = formatRelativeDays(card.due, now)
  return relative === 'today' ? 'Due later today' : `Due ${relative}`
}

// Pure helpers for today's session (/session): which part runs, what each
// part takes from the plan, and how weak-spot quizzes are split per notebook.

import { WEAK_SPOT_QUESTIONS, weakSpotQuizSize } from '@shared/learning'
import { QUESTION_TYPES, type ID, type QuizSettings, type TodayPlan, type TopicProgress } from '@shared/types'
import { pluralize } from '../../lib/format'

export const SESSION_PARTS = ['review', 'weak', 'learn'] as const
export type SessionPart = (typeof SESSION_PARTS)[number]

export const SESSION_PART_LABELS: Record<SessionPart, string> = {
  review: 'Mixed review',
  weak: 'Fix weak spots',
  learn: 'Learn something new'
}

export function parseSessionPart(value: string | null | undefined): SessionPart {
  return (SESSION_PARTS as readonly string[]).includes(value ?? '') ? (value as SessionPart) : 'review'
}

export function partNumber(part: SessionPart): number {
  return SESSION_PARTS.indexOf(part) + 1
}

export function nextSessionPart(part: SessionPart): SessionPart | null {
  return SESSION_PARTS[SESSION_PARTS.indexOf(part) + 1] ?? null
}

/** Whole-session progress 0-100: finished parts plus the fraction of the current one. */
export function sessionProgress(part: SessionPart, partFraction: number): number {
  const done = SESSION_PARTS.indexOf(part)
  const fraction = Math.min(1, Math.max(0, partFraction))
  return Math.round(((done + fraction) / SESSION_PARTS.length) * 100)
}

function unique(ids: readonly ID[]): ID[] {
  return [...new Set(ids)]
}

/** Cards of the plan's review blocks, in plan order. */
export function planReviewCardIds(plan: Pick<TodayPlan, 'blocks'>): ID[] {
  return unique(plan.blocks.filter((b) => b.kind === 'review').flatMap((b) => b.cardIds))
}

export function planWeakTopicIds(plan: Pick<TodayPlan, 'blocks'>): ID[] {
  return unique(plan.blocks.filter((b) => b.kind === 'weak').flatMap((b) => b.topicIds))
}

/** Topics to learn today (one per learn block, usually one). */
export function planLearnTopicIds(plan: Pick<TodayPlan, 'blocks'>): ID[] {
  return unique(plan.blocks.filter((b) => b.kind === 'learn').flatMap((b) => b.topicIds))
}

/**
 * Cards still due now. The plan may be a few minutes old, or the learner may
 * have reviewed some of its cards elsewhere since; those are not shown again.
 */
export function stillDue<T extends { due: string }>(cards: readonly T[], now: number): T[] {
  return cards.filter((card) => {
    const due = Date.parse(card.due)
    return Number.isNaN(due) || due <= now
  })
}

export interface NotebookGroup {
  notebookId: ID
  topicIds: ID[]
}

/**
 * A quiz belongs to one notebook, so weak topics from several subjects are
 * split into one quiz per notebook, keeping the plan's order (the first
 * group is the notebook of the plan's first weak topic).
 */
export function groupTopicsByNotebook(order: readonly ID[], topics: readonly { id: ID; notebookId: ID }[]): NotebookGroup[] {
  const notebookOf = new Map(topics.map((t) => [t.id, t.notebookId]))
  const groups: NotebookGroup[] = []
  for (const topicId of order) {
    const notebookId = notebookOf.get(topicId)
    if (!notebookId) continue
    const group = groups.find((g) => g.notebookId === notebookId)
    if (group) group.topicIds.push(topicId)
    else groups.push({ notebookId, topicIds: [topicId] })
  }
  return groups
}

// The same rule sizes the weak block of Today's plan (its minutes estimate), so it lives in @shared/learning.
export const WEAK_QUIZ_COUNT = WEAK_SPOT_QUESTIONS

/** 8 questions in one quiz; split across notebooks without dropping below 4 each. */
export function weakQuizCount(groupCount: number): number {
  return weakSpotQuizSize(groupCount)
}

export function weakQuizSettings(count: number): QuizSettings {
  return {
    types: [...QUESTION_TYPES],
    count,
    difficulty: 'mixed',
    focusWeak: true,
    interleave: false,
    timeLimitMin: null
  }
}

/** localStorage key remembering today's weak-spot quiz for a notebook, so a reload resumes it. */
export function weakQuizStorageKey(planDate: string, notebookId: ID): string {
  return `study:session:${planDate}:weak:${notebookId}`
}

/** Why a topic is in the weak-spot quiz, in a few words ("sure but wrong 3 times", "missed 5 of 9"). */
export function weakTopicNote(progress: Pick<TopicProgress, 'overconfidentCount' | 'missedCount' | 'answeredCount' | 'mastery'>): string {
  if (progress.overconfidentCount > 0) return `sure but wrong ${pluralize(progress.overconfidentCount, 'time')}`
  if (progress.answeredCount > 0 && progress.missedCount > 0) return `missed ${progress.missedCount} of ${progress.answeredCount}`
  return `${Math.round(progress.mastery)}% mastery`
}

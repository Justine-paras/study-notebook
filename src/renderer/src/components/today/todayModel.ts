// Pure display logic for the Today screen (unit-tested in Node, no DOM).

import type { NotebookSummary, PlanBlock, PlanBlockKind, TodayOverview, UpcomingExam } from '@shared/types'
import type { PomodoroPhase, PomodoroStatus } from '../../lib/pomodoroCore'
import { formatList, formatMinutes, formatRelativeDays, pluralize, pomodoroCount } from '../../lib/format'
import { ROUTES } from '../../lib/routes'

/** Where a plan block takes the learner. Null when the block has nothing to open (should not happen). */
export function planBlockLink(block: Pick<PlanBlock, 'kind' | 'topicIds' | 'notebookIds'>): string | null {
  switch (block.kind) {
    case 'review':
      return ROUTES.session('review')
    case 'weak':
      return ROUTES.session('weak')
    case 'learn': {
      const topicId = block.topicIds[0]
      return topicId ? ROUTES.topic(topicId) : null
    }
    case 'exam_prep': {
      const notebookId = block.notebookIds[0]
      return notebookId ? ROUTES.notebook(notebookId) : null
    }
  }
}

/** Short verb for the block's link, read after the title by screen readers. */
export const PLAN_BLOCK_ACTIONS: Record<PlanBlockKind, string> = {
  review: 'Start reviewing',
  weak: 'Practice weak spots',
  learn: 'Open topic',
  exam_prep: 'Open notebook'
}

/** "about 45 min · 2 Pomodoros" as parts, so the minutes can be bold. */
export function planTotals(totalMinutes: number, focusMinutes: number): { minutes: string; pomodoros: string | null } {
  const count = pomodoroCount(totalMinutes, focusMinutes)
  return {
    minutes: formatMinutes(totalMinutes),
    pomodoros: count > 0 ? pluralize(count, 'Pomodoro') : null
  }
}

export type TodayState = 'no_notebooks' | 'nothing_due' | 'plan'

export function todayState(overview: Pick<TodayOverview, 'plan' | 'notebooks'>): TodayState {
  if (overview.notebooks.length === 0) return 'no_notebooks'
  if (overview.plan.blocks.length === 0) return 'nothing_due'
  return 'plan'
}

/**
 * Where "Learn a new topic" goes when nothing is due: straight into the only
 * notebook, else into the least-mastered one (most likely to have topics
 * left), or the shelf when there is no notebook.
 */
export function nothingDueTarget(notebooks: Pick<NotebookSummary, 'id' | 'mastery' | 'archived'>[]): string {
  const active = notebooks.filter((n) => !n.archived)
  if (active.length === 0) return ROUTES.notebooks
  const weakest = active.reduce((low, n) => (n.mastery < low.mastery ? n : low))
  return ROUTES.notebook(weakest.id)
}

/**
 * The line under an exam in "Coming up": weakest covered topics and how many
 * are not started, e.g. "Weakest: Paging, Deadlocks · 2 topics not started yet".
 */
export function examNote(exam: Pick<UpcomingExam, 'weakestTopics' | 'notStartedCount'>): string {
  const parts: string[] = []
  if (exam.weakestTopics.length > 0) parts.push(`Weakest: ${formatList(exam.weakestTopics.map((t) => t.title))}`)
  if (exam.notStartedCount > 0) parts.push(`${pluralize(exam.notStartedCount, 'topic')} not started yet`)
  return parts.length > 0 ? parts.join(' · ') : 'Every covered topic is under way'
}

/** "in 4 days" -> urgency, so an exam this week reads as more pressing. */
export function examUrgency(daysLeft: number): 'soon' | 'later' {
  return daysLeft <= 7 ? 'soon' : 'later'
}

export type SessionTimerAction = 'none' | 'start' | 'skip_break_and_start'

/**
 * What "Start today's session" does to the Pomodoro: leave a running timer
 * alone (focus or a deserved break), resume or start a focus phase, and skip
 * a paused or waiting break so studying starts with focus time.
 */
export function sessionTimerAction(phase: PomodoroPhase, status: PomodoroStatus): SessionTimerAction {
  if (status === 'running') return 'none'
  return phase === 'break' ? 'skip_break_and_start' : 'start'
}

/**
 * The small line at the bottom of a shelf cover: what needs attention in that
 * notebook, e.g. "12 cards due · Midterm in 9 days".
 */
export function shelfFooter(
  notebook: Pick<NotebookSummary, 'dueCards' | 'nextExam' | 'topicCount' | 'sourceCount' | 'archived'>,
  now: Date = new Date()
): string {
  if (notebook.archived) return 'Archived'
  const parts: string[] = []
  if (notebook.dueCards > 0) parts.push(`${pluralize(notebook.dueCards, 'card')} due`)
  if (notebook.nextExam) parts.push(`${notebook.nextExam.name} ${formatRelativeDays(notebook.nextExam.examDate, now)}`)
  if (parts.length > 0) return parts.join(' · ')
  if (notebook.sourceCount === 0) return 'Add your course files'
  if (notebook.topicCount === 0) return 'No topics yet'
  return 'Nothing due'
}

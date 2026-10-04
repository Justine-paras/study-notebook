// The Today screen: one daily plan plus exams, notebooks and memory stats.

import { buildTodayPlan, daysBetween, examReadiness, localDate, type PlanCard, type PlanTopic } from '@shared/learning'
import type { ID, Notebook, TodayOverview, UpcomingExam } from '@shared/types'
import type { AppContext } from '../context'
import { listDueCards } from '../db/repositories/cards'
import { listUpcomingExamRows } from '../db/repositories/exams'
import { listNotebookRows } from '../db/repositories/notebooks'
import { buildSummaries, loadAllTopicsByNotebook } from './progress'
import { readStoredSettings } from './settings'
import { longTermCards, recallRate7d, studyMinutesToday, studyStreak } from './stats'

export async function getToday(ctx: AppContext): Promise<TodayOverview> {
  const now = ctx.now()
  const today = localDate(now)
  const settings = readStoredSettings(ctx)
  // Archived notebooks are put away: they stay out of the plan, the exams and the shelf.
  const notebooks = listNotebookRows(ctx.db).filter((n) => !n.archived)
  const notebookById = new Map<ID, Notebook>(notebooks.map((n) => [n.id, n]))
  const topicsByNotebook = loadAllTopicsByNotebook(ctx, 'unarchived')

  const topics: PlanTopic[] = notebooks.flatMap((n) =>
    (topicsByNotebook.get(n.id) ?? []).map((t) => ({ ...t, notebookName: n.name, notebookCode: n.code }))
  )
  const dueCards: PlanCard[] = listDueCards(ctx.db, now.toISOString()).flatMap((card) => {
    const notebook = notebookById.get(card.notebookId)
    return notebook ? [{ ...card, notebookName: notebook.name, notebookCode: notebook.code }] : []
  })
  const exams = listUpcomingExamRows(ctx.db, today).filter((e) => notebookById.has(e.notebookId))

  const plan = buildTodayPlan({
    now,
    dueCards,
    topics,
    exams,
    newTopicsPerDay: settings.newTopicsPerDay,
    maxReviewsPerDay: settings.maxReviewsPerDay
  })

  const upcoming: UpcomingExam[] = exams
    .map((exam) => {
      const notebook = notebookById.get(exam.notebookId) as Notebook
      const readiness = examReadiness(exam, topicsByNotebook.get(exam.notebookId) ?? [])
      return {
        ...exam,
        notebookName: notebook.name,
        notebookColor: notebook.color,
        daysLeft: daysBetween(today, exam.examDate),
        readiness: readiness.readiness,
        weakestTopics: readiness.weakest,
        notStartedCount: readiness.notStartedCount
      }
    })
    .sort((a, b) => a.examDate.localeCompare(b.examDate) || a.name.localeCompare(b.name))

  return {
    plan,
    exams: upcoming,
    notebooks: buildSummaries(ctx, notebooks, topicsByNotebook),
    recallRate7d: recallRate7d(ctx),
    longTermCards: longTermCards(ctx),
    streakDays: studyStreak(ctx),
    studyMinutesToday: studyMinutesToday(ctx)
  }
}

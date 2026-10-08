// Insights: weak topics across subjects, calibration, forecast, mistakes, study time.

import { calibration, daysBetween, forecastDue, localDate, weakTopicReason } from '@shared/learning'
import type { Exam, ID, Insights, Notebook, TopicWithProgress, WeakTopic } from '@shared/types'
import type { AppContext } from '../context'
import { listRatedAnswerFactsSince, listRecentMistakes } from '../db/repositories/answers'
import { listDueTimesBefore } from '../db/repositories/cards'
import { listUpcomingExamRows } from '../db/repositories/exams'
import { listFocusSessionsSince } from '../db/repositories/focusSessions'
import { listNotebookRows } from '../db/repositories/notebooks'
import { DAY_MS, startOfLocalDayOffset } from './common'
import { isWeakTopic, loadAllTopicsByNotebook } from './progress'
import { focusMinutesByDate, longTermCards, recallRate7d, studyStreak } from './stats'

const MAX_WEAK_TOPICS = 20
const MISTAKE_LOG_SIZE = 50
const CALIBRATION_DAYS = 30
const FORECAST_DAYS = 7
const STUDY_DAYS = 14
const SUBJECT_DAYS = 30

/** The soonest upcoming exam covering `topic` (an exam with no topic list covers every topic). */
function nearestExamFor(topic: TopicWithProgress, exams: Exam[]): Exam | null {
  return exams.find((e) => e.notebookId === topic.notebookId && (e.topicIds.length === 0 || e.topicIds.includes(topic.id))) ?? null
}

export async function getInsights(ctx: AppContext): Promise<Insights> {
  const now = ctx.now()
  const today = localDate(now)
  const allNotebooks = listNotebookRows(ctx.db)
  const active = allNotebooks.filter((n) => !n.archived)
  const notebookById = new Map<ID, Notebook>(allNotebooks.map((n) => [n.id, n]))
  const topicsByNotebook = loadAllTopicsByNotebook(ctx, 'unarchived')
  const exams = listUpcomingExamRows(ctx.db, today)

  const weakTopics: WeakTopic[] = active
    .flatMap((n) => (topicsByNotebook.get(n.id) ?? []).filter(isWeakTopic).map((t) => ({ notebook: n, topic: t })))
    .sort(
      (a, b) =>
        a.topic.progress.mastery - b.topic.progress.mastery ||
        b.topic.progress.overconfidentCount - a.topic.progress.overconfidentCount ||
        a.topic.orderIndex - b.topic.orderIndex
    )
    .slice(0, MAX_WEAK_TOPICS)
    .map(({ notebook, topic }) => {
      const exam = nearestExamFor(topic, exams)
      return {
        topicId: topic.id,
        notebookId: notebook.id,
        notebookName: notebook.name,
        notebookCode: notebook.code,
        title: topic.title,
        mastery: topic.progress.mastery,
        accuracy: topic.progress.recentAccuracy,
        missedCount: topic.progress.missedCount,
        answeredCount: topic.progress.answeredCount,
        overconfidentCount: topic.progress.overconfidentCount,
        why: weakTopicReason(topic.progress, exam ? { name: exam.name, daysLeft: daysBetween(today, exam.examDate) } : null)
      }
    })

  const ratedAnswers = listRatedAnswerFactsSince(ctx.db, new Date(now.getTime() - CALIBRATION_DAYS * DAY_MS).toISOString())
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString()
  const overconfidentLast7Days = ratedAnswers.filter((a) => a.answeredAt >= weekAgo && a.confidence === 'sure' && !a.correct).length

  const minutesByDate = focusMinutesByDate(ctx, STUDY_DAYS - 1)
  const studyMinutesByDay = Array.from({ length: STUDY_DAYS }, (_, i) => {
    const date = localDate(startOfLocalDayOffset(now, i - (STUDY_DAYS - 1)))
    return { date, minutes: Math.round(minutesByDate.get(date) ?? 0) }
  })

  const bySubject = new Map<ID, number>()
  for (const session of listFocusSessionsSince(ctx.db, startOfLocalDayOffset(now, -(SUBJECT_DAYS - 1)).toISOString(), 'focus')) {
    if (session.notebookId) bySubject.set(session.notebookId, (bySubject.get(session.notebookId) ?? 0) + session.minutes)
  }
  const studyMinutesBySubject = [...bySubject]
    .flatMap(([notebookId, minutes]) => {
      const notebook = notebookById.get(notebookId)
      return notebook ? [{ notebookId, name: notebook.name, color: notebook.color, minutes: Math.round(minutes) }] : []
    })
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name))

  return {
    weakTopics,
    calibration: calibration(ratedAnswers),
    overconfidentLast7Days,
    // Only the cards due before the end of the forecast window (overdue ones land on day 0).
    forecast: forecastDue(listDueTimesBefore(ctx.db, startOfLocalDayOffset(now, FORECAST_DAYS).toISOString()), now, FORECAST_DAYS),
    mistakes: listRecentMistakes(ctx.db, MISTAKE_LOG_SIZE),
    studyMinutesByDay,
    studyMinutesBySubject,
    recallRate7d: recallRate7d(ctx),
    longTermCards: longTermCards(ctx),
    streakDays: studyStreak(ctx)
  }
}

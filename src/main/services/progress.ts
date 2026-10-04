// Topic progress and notebook summaries, computed in bulk: one query per
// table for a notebook (or for everything), then grouped in memory, instead
// of a round of queries per topic.

import { computeTopicProgress, examReadiness, localDate } from '@shared/learning'
import type { AnswerRecord, Card, Exam, ID, Notebook, NotebookSummary, ReviewLog, Topic, TopicWithProgress } from '@shared/types'
import type { AppContext } from '../context'
import { lastStudiedByNotebook } from '../db/repositories/activity'
import { listTopicAnswers } from '../db/repositories/answers'
import { countDueCardsByNotebook, listActiveTopicCards } from '../db/repositories/cards'
import { listUpcomingExamRows } from '../db/repositories/exams'
import { listReviewLogs } from '../db/repositories/reviewLogs'
import { countSourcesByNotebook } from '../db/repositories/sources'
import { listAllTopicRows, listTopicRows } from '../db/repositories/topics'

function groupBy<T>(items: T[], key: (item: T) => ID | null): Map<ID, T[]> {
  const groups = new Map<ID, T[]>()
  for (const item of items) {
    const k = key(item)
    if (k === null) continue
    const list = groups.get(k)
    if (list) list.push(item)
    else groups.set(k, [item])
  }
  return groups
}

/** Attaches progress to `topics` using pre-loaded answers, cards and review logs. */
export function withProgress(topics: Topic[], answers: AnswerRecord[], cards: Card[], reviews: ReviewLog[], now: Date): TopicWithProgress[] {
  const answersByTopic = groupBy(answers, (a) => a.topicId)
  const cardsByTopic = groupBy(cards, (c) => c.topicId)
  const reviewsByCard = groupBy(reviews, (r) => r.cardId)
  return topics.map((topic) => {
    const topicCards = cardsByTopic.get(topic.id) ?? []
    const topicReviews = topicCards.flatMap((card) => reviewsByCard.get(card.id) ?? [])
    const progress = computeTopicProgress({
      topic,
      answers: answersByTopic.get(topic.id) ?? [],
      cards: topicCards,
      reviews: topicReviews,
      now
    })
    return { ...topic, progress }
  })
}

/** Topics of one notebook, in course order, with progress. */
export function loadNotebookTopics(ctx: AppContext, notebookId: ID): TopicWithProgress[] {
  const { db } = ctx
  return withProgress(
    listTopicRows(db, notebookId),
    listTopicAnswers(db, notebookId),
    listActiveTopicCards(db, notebookId),
    listReviewLogs(db, notebookId),
    ctx.now()
  )
}

/** Every topic of every notebook, with progress, grouped by notebook id (each in course order). */
export function loadAllTopicsByNotebook(ctx: AppContext): Map<ID, TopicWithProgress[]> {
  const { db } = ctx
  const topics = withProgress(listAllTopicRows(db), listTopicAnswers(db, null), listActiveTopicCards(db, null), listReviewLogs(db, null), ctx.now())
  return groupBy(topics, (t) => t.notebookId)
}

/** True when the learner has answered or reviewed anything for this topic. */
export function hasProgressData(topic: TopicWithProgress): boolean {
  return topic.progress.answeredCount > 0 || topic.progress.lastPracticedAt !== null
}

/** Weak by state, or below 60% mastery with evidence behind it. */
export function isWeakTopic(topic: TopicWithProgress): boolean {
  return topic.progress.state === 'weak' || (topic.progress.mastery < 60 && hasProgressData(topic))
}

/** Mean mastery where not-started topics count as 0. */
export function meanMastery(topics: TopicWithProgress[]): number {
  if (topics.length === 0) return 0
  const total = topics.reduce((sum, t) => sum + (t.progress.state === 'not_started' ? 0 : t.progress.mastery), 0)
  return Math.round(total / topics.length)
}

/**
 * Summaries for `notebooks`. Pass `topicsByNotebook` when it is already
 * loaded (Today), otherwise topics are loaded here in bulk.
 */
export function buildSummaries(ctx: AppContext, notebooks: Notebook[], topicsByNotebook?: Map<ID, TopicWithProgress[]>): NotebookSummary[] {
  if (notebooks.length === 0) return []
  const { db } = ctx
  const now = ctx.now()
  const topicsMap =
    topicsByNotebook ?? (notebooks.length === 1 ? new Map([[notebooks[0].id, loadNotebookTopics(ctx, notebooks[0].id)]]) : loadAllTopicsByNotebook(ctx))
  const sourceCounts = countSourcesByNotebook(db)
  const dueCounts = countDueCardsByNotebook(db, now.toISOString())
  const lastStudied = lastStudiedByNotebook(db)
  const upcoming = groupBy(listUpcomingExamRows(db, localDate(now)), (e) => e.notebookId)

  return notebooks.map((notebook) => {
    const topics = topicsMap.get(notebook.id) ?? []
    const nextExam: Exam | null = upcoming.get(notebook.id)?.[0] ?? null
    return {
      ...notebook,
      sourceCount: sourceCounts.get(notebook.id) ?? 0,
      topicCount: topics.length,
      mastery: meanMastery(topics),
      dueCards: dueCounts.get(notebook.id) ?? 0,
      nextExam,
      nextExamReadiness: nextExam ? examReadiness(nextExam, topics).readiness : null,
      lastStudiedAt: lastStudied.get(notebook.id) ?? null
    }
  })
}

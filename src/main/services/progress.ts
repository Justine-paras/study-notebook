// Topic progress and notebook summaries, computed in bulk: one query per
// table for a notebook (or for everything), then grouped in memory, instead
// of a round of queries per topic.

import { computeTopicProgress, examReadiness, localDate } from '@shared/learning'
import type { Card, Exam, ID, Notebook, NotebookSummary, ReviewLog, Topic, TopicWithProgress } from '@shared/types'
import type { AppContext } from '../context'
import { lastStudiedByNotebook } from '../db/repositories/activity'
import { listTopicAnswerFacts, type AnswerFact } from '../db/repositories/answers'
import { countDueCardsByNotebook, listActiveTopicCards } from '../db/repositories/cards'
import { listUpcomingExamRows } from '../db/repositories/exams'
import { listReviewLogsIn } from '../db/repositories/reviewLogs'
import { countSourcesByNotebook } from '../db/repositories/sources'
import { listTopicRowsIn } from '../db/repositories/topics'
import type { NotebookScope } from '../db/sql'

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
export function withProgress(topics: Topic[], answers: AnswerFact[], cards: Card[], reviews: ReviewLog[], now: Date): TopicWithProgress[] {
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

function loadTopics(ctx: AppContext, scope: NotebookScope): TopicWithProgress[] {
  const { db } = ctx
  return withProgress(
    listTopicRowsIn(db, scope),
    listTopicAnswerFacts(db, scope),
    listActiveTopicCards(db, scope),
    listReviewLogsIn(db, scope),
    ctx.now()
  )
}

/** Topics of one notebook, in course order, with progress. */
export function loadNotebookTopics(ctx: AppContext, notebookId: ID): TopicWithProgress[] {
  return loadTopics(ctx, { notebookId })
}

/**
 * Topics with progress, grouped by notebook id (each in course order). Today
 * and Insights pass 'unarchived': archived subjects stay out of both, so their
 * whole history needn't be loaded on every refresh.
 */
export function loadAllTopicsByNotebook(ctx: AppContext, scope: 'unarchived' | 'all' = 'all'): Map<ID, TopicWithProgress[]> {
  return groupBy(loadTopics(ctx, scope), (t) => t.notebookId)
}

/** True when the learner has answered or reviewed anything for this topic. */
export function hasProgressData(topic: TopicWithProgress): boolean {
  return topic.progress.answeredCount > 0 || topic.progress.lastPracticedAt !== null
}

/**
 * Weak by state, or below 60% mastery with accuracy evidence behind it (at
 * least 3 scored answers or reviews). The evidence matters: a topic someone
 * has only warmed up on, or is part way through learning, has a low mastery
 * from its path alone (at most 10%), and is not weak.
 */
export function isWeakTopic(topic: TopicWithProgress): boolean {
  return topic.progress.state === 'weak' || (topic.progress.mastery < 60 && topic.progress.recentAccuracy !== null)
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

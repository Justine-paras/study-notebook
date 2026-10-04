// Service behaviour that depends on the real learning rules (no learning
// fake): what counts as weak, how a Hard review is logged, how a weak topic's
// cards are queued for an early review, what Today and Insights leave out,
// and the study streak walked day by day.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CardState, ID, Question } from '@shared/types'
import { services } from '../../src/main/services'
import { createTestContext, type TestContext } from './helpers/context'
import { FakeAi } from './helpers/fakeAi'

const NOW = new Date(2026, 9, 14, 10, 0, 0)
const DAY = 24 * 60 * 60 * 1000

let ctx: TestContext
let ai: FakeAi
beforeEach(() => {
  ai = new FakeAi()
  ctx = createTestContext({ now: NOW, ai })
})
afterEach(() => ctx.cleanup())

function tf(id: string, topicId: string): Question {
  return { id, type: 'tf', prompt: `Is ${id} true?`, options: ['True', 'False'], answer: 'True', acceptable: [], explanation: '', topicId, difficulty: 'easy', sourceRef: '' }
}

async function notebookWithTopic(title = 'Deadlocks') {
  const notebook = await services.createNotebook(ctx, { name: 'Operating Systems', code: 'CS 330', color: 'teal' })
  const topic = await services.createTopic(ctx, notebook.id, { title, description: `All about ${title}` })
  return { notebook, topic }
}

describe('weak topics', () => {
  it('does not call a topic weak just because it was started (warm-up guesses, path progress only)', async () => {
    const { topic } = await notebookWithTopic()
    const lesson = await services.generateLesson(ctx, topic.id)
    for (const question of lesson.content.warmup) {
      await services.recordAnswer(ctx, { topicId: topic.id, source: 'warmup', question, response: 'no idea', confidence: null })
    }
    await services.setTopicStep(ctx, topic.id, 'learn', 1)
    expect((await services.getTopic(ctx, topic.id)).progress).toMatchObject({ state: 'learning', recentAccuracy: null })
    expect((await services.getInsights(ctx)).weakTopics).toEqual([])
  })

  it('does list a topic being learned once its answers show it is going badly', async () => {
    const { topic } = await notebookWithTopic()
    await services.setTopicStep(ctx, topic.id, 'practice')
    for (let i = 0; i < 4; i++) {
      await services.recordAnswer(ctx, { topicId: topic.id, source: 'check', question: tf(`q${i}`, topic.id), response: 'False', confidence: 'unsure' })
    }
    expect((await services.getInsights(ctx)).weakTopics.map((w) => w.topicId)).toEqual([topic.id])
  })
})

describe('card reviews', () => {
  it('logs a Hard review as recalled, and mastery agrees', async () => {
    const { notebook, topic } = await notebookWithTopic()
    const cards = []
    for (let i = 0; i < 3; i++) cards.push(await services.createCard(ctx, { notebookId: notebook.id, topicId: topic.id, front: `Q${i}`, back: `A${i}` }))
    for (const card of cards) await services.reviewCard(ctx, { cardId: card.id, rating: 2, confidence: 'unsure', response: '' })
    const logged = ctx.db.prepare("SELECT correct FROM answers WHERE source = 'review'").all()
    expect(logged).toEqual([{ correct: 1 }, { correct: 1 }, { correct: 1 }])
    expect((await services.getTopic(ctx, topic.id)).progress).toMatchObject({ recentAccuracy: 100, missedCount: 0 })
    expect((await services.getToday(ctx)).recallRate7d).toBe(100)

    // Good while guessing is logged as Hard: still recalled.
    const guessed = await services.createCard(ctx, { notebookId: notebook.id, topicId: topic.id, front: 'G', back: 'g' })
    await services.reviewCard(ctx, { cardId: guessed.id, rating: 3, confidence: 'guess', response: '' })
    expect(ctx.db.prepare('SELECT rating FROM review_logs WHERE card_id = ?').get(guessed.id)).toEqual({ rating: 2 })
  })
})

describe('weak topic card review', () => {
  // A card's memory as FSRS would have left it: reviewed `reviewedDaysAgo` days ago, due `dueInDays` from now.
  function setSchedule(
    cardId: ID,
    s: { state?: CardState; stability: number; reviewedDaysAgo: number; dueInDays: number }
  ): void {
    ctx.db
      .prepare(
        `UPDATE cards SET state = ?, stability = ?, difficulty = 5, reps = 3, learning_steps = 0, scheduled_days = ?,
           last_review = ?, due = ? WHERE id = ?`
      )
      .run(
        s.state ?? 'review',
        s.stability,
        Math.max(0, Math.round(s.dueInDays + s.reviewedDaysAgo)),
        new Date(NOW.getTime() - s.reviewedDaysAgo * DAY).toISOString(),
        new Date(NOW.getTime() + s.dueInDays * DAY).toISOString(),
        cardId
      )
  }

  async function topicWithCards() {
    const { notebook, topic } = await notebookWithTopic()
    const other = await services.createTopic(ctx, notebook.id, { title: 'Paging' })
    const card = async (front: string, topicId: ID | null = topic.id) =>
      (await services.createCard(ctx, { notebookId: notebook.id, topicId, front, back: `${front} answer` })).id
    // Created in a jumbled order, so the queue's order can't come from creation time.
    const safe = await card('safe')
    const lessOverdue = await card('less overdue')
    const shaky = await card('shaky')
    const mostOverdue = await card('most overdue')
    const middling = await card('middling')
    const justMissed = await card('just missed')
    const suspended = await card('suspended')
    const otherTopic = await card('other topic', other.id)
    const noTopic = await card('no topic', null)
    const fresh = await card('fresh')
    setSchedule(mostOverdue, { stability: 5, reviewedDaysAgo: 8, dueInDays: -3 })
    setSchedule(lessOverdue, { stability: 5, reviewedDaysAgo: 6, dueInDays: -1 })
    // Not due yet: two days since the last review on a two-day memory is the most at risk...
    setSchedule(shaky, { stability: 2, reviewedDaysAgo: 2, dueInDays: 0.25 })
    setSchedule(middling, { stability: 10, reviewedDaysAgo: 4, dueInDays: 6 })
    setSchedule(safe, { stability: 60, reviewedDaysAgo: 1, dueInDays: 59 })
    // ...while a card missed a minute ago is due again soonest but still fresh in memory.
    setSchedule(justMissed, { state: 'relearning', stability: 1, reviewedDaysAgo: 1 / 1440, dueInDays: 9 / 1440 })
    setSchedule(otherTopic, { stability: 5, reviewedDaysAgo: 8, dueInDays: -3 })
    await services.updateCard(ctx, suspended, { suspended: true })
    return { notebook, topic, other, ids: { safe, lessOverdue, shaky, mostOverdue, middling, justMissed, suspended, otherTopic, noTopic, fresh } }
  }

  it("queues the topic's cards: due first (most overdue first), then the rest by lowest retrievability", async () => {
    const { topic, other, ids } = await topicWithCards()
    const queue = await services.getReviewQueue(ctx, { topicIds: [topic.id] })
    // `fresh` was created due now, so it is due, just the least overdue.
    expect(queue.map((c) => c.id)).toEqual([ids.mostOverdue, ids.lessOverdue, ids.fresh, ids.shaky, ids.middling, ids.safe, ids.justMissed])
    expect(queue.every((c) => c.topicTitle === 'Deadlocks' && c.previews.length === 4)).toBe(true)

    // Capped at the limit, keeping the front of that order.
    expect((await services.getReviewQueue(ctx, { topicIds: [topic.id], limit: 4 })).map((c) => c.id)).toEqual([
      ids.mostOverdue,
      ids.lessOverdue,
      ids.fresh,
      ids.shaky
    ])
    // Several topics, listed twice: every card once.
    const both = await services.getReviewQueue(ctx, { topicIds: [other.id, topic.id, other.id] })
    expect(both.map((c) => c.id)).toEqual([ids.mostOverdue, ids.otherTopic, ids.lessOverdue, ids.fresh, ids.shaky, ids.middling, ids.safe, ids.justMissed])
  })

  it('caps a topic queue at the daily review limit by default', async () => {
    const { notebook, topic } = await topicWithCards()
    for (let i = 0; i < 5; i++) await services.createCard(ctx, { notebookId: notebook.id, topicId: topic.id, front: `Extra ${i}`, back: 'x' })
    await services.updateSettings(ctx, { maxReviewsPerDay: 10 })
    expect(await services.getReviewQueue(ctx, { topicIds: [topic.id] })).toHaveLength(10)
  })

  it('leaves the normal queue as it was: due cards only, every topic', async () => {
    const { ids } = await topicWithCards()
    const queue = (await services.getReviewQueue(ctx)).map((c) => c.id)
    expect(queue).toEqual([ids.mostOverdue, ids.otherTopic, ids.lessOverdue, ids.noTopic, ids.fresh])
  })

  it('keeps to the notebook when one is given too', async () => {
    const { topic } = await topicWithCards()
    const elsewhere = await services.createNotebook(ctx, { name: 'Networks', code: '', color: 'blue' })
    expect(await services.getReviewQueue(ctx, { topicIds: [topic.id], notebookId: elsewhere.id })).toEqual([])
    expect(await services.getReviewQueue(ctx, { topicIds: [topic.id], notebookId: topic.notebookId })).toHaveLength(7)
  })

  it('previews and schedules a card reviewed before it is due through the normal review path', async () => {
    const { topic, ids } = await topicWithCards()
    const queue = await services.getReviewQueue(ctx, { topicIds: [topic.id] })
    const early = queue.find((c) => c.id === ids.middling)!
    expect(early.due > NOW.toISOString()).toBe(true)

    // Again relearns within minutes; each better grade waits longer, and Good outlasts what was left of the old interval.
    const dues = early.previews.map((p) => new Date(p.due).getTime())
    expect(early.previews.map((p) => p.rating)).toEqual([1, 2, 3, 4])
    expect(dues[0] - NOW.getTime()).toBeLessThan(60 * 60 * 1000)
    expect(dues[0]).toBeLessThan(dues[1])
    expect(dues[1]).toBeLessThanOrEqual(dues[2])
    expect(dues[2]).toBeLessThan(dues[3])
    expect(dues[2]).toBeGreaterThan(new Date(early.due).getTime())
    expect(early.previews.every((p) => /^\d+(\.\d)? (min|hr|days?|wk|mo|yr)$/.test(p.intervalLabel))).toBe(true)

    const reviewed = await services.reviewCard(ctx, { cardId: early.id, rating: 3, confidence: 'sure', response: '' })
    expect(reviewed).toMatchObject({ reps: 4, state: 'review', lastReview: NOW.toISOString(), due: early.previews[2].due })
    expect(reviewed.stability).toBeGreaterThan(early.stability)
    const log = ctx.db.prepare('SELECT rating, state_before, elapsed_days FROM review_logs WHERE card_id = ?').get(early.id)
    expect(log).toEqual({ rating: 3, state_before: 'review', elapsed_days: 4 })
    const answer = ctx.db.prepare("SELECT source, correct FROM answers WHERE card_id = ?").get(early.id)
    expect(answer).toEqual({ source: 'review', correct: 1 })

    // Just reviewed, it now has the freshest memory of the topic's cards, so it goes to the back.
    const after = await services.getReviewQueue(ctx, { topicIds: [topic.id] })
    expect(after.map((c) => c.id)).toEqual([ids.mostOverdue, ids.lessOverdue, ids.fresh, ids.shaky, ids.safe, ids.justMissed, ids.middling])
  })
})

describe('archived notebooks', () => {
  it('stay out of Today and Insights but keep their own progress', async () => {
    const { notebook, topic } = await notebookWithTopic()
    await services.setTopicStep(ctx, topic.id, 'practice')
    for (let i = 0; i < 4; i++) {
      await services.recordAnswer(ctx, { topicId: topic.id, source: 'check', question: tf(`q${i}`, topic.id), response: 'False', confidence: 'sure' })
    }
    await services.createCard(ctx, { notebookId: notebook.id, topicId: topic.id, front: 'Due', back: 'now' })
    await services.updateNotebook(ctx, notebook.id, { archived: true })

    const today = await services.getToday(ctx)
    expect(today.notebooks).toEqual([])
    expect(today.plan.blocks).toEqual([])
    const insights = await services.getInsights(ctx)
    expect(insights.weakTopics).toEqual([])
    expect(insights.forecast.every((d) => d.due === 0)).toBe(true)
    // The notebook itself still shows what was learned.
    expect((await services.getNotebook(ctx, notebook.id)).topicCount).toBe(1)
    expect((await services.listTopics(ctx, notebook.id))[0].progress.answeredCount).toBe(4)
  })

  it('forecasts only cards due within the window, overdue ones on day 0', async () => {
    const { notebook, topic } = await notebookWithTopic()
    const overdue = await services.createCard(ctx, { notebookId: notebook.id, topicId: topic.id, front: 'old', back: 'x' })
    const later = await services.createCard(ctx, { notebookId: notebook.id, topicId: topic.id, front: 'later', back: 'x' })
    ctx.db.prepare('UPDATE cards SET due = ? WHERE id = ?').run(new Date(NOW.getTime() - 3 * DAY).toISOString(), overdue.id)
    ctx.db.prepare('UPDATE cards SET due = ? WHERE id = ?').run(new Date(NOW.getTime() + 10 * DAY).toISOString(), later.id)
    const forecast = (await services.getInsights(ctx)).forecast
    expect(forecast.map((d) => d.due)).toEqual([1, 0, 0, 0, 0, 0, 0])
  })
})

describe('study streak', () => {
  async function studyAt(date: Date, notebookId: string | null, kind: 'focus' | 'break' = 'focus'): Promise<void> {
    await services.logFocusSession(ctx, { notebookId, kind, startedAt: date.toISOString(), endedAt: new Date(date.getTime() + 25 * 60_000).toISOString(), minutes: 25 })
  }

  it('counts consecutive local days back from today, or from yesterday before studying today', async () => {
    const { notebook, topic } = await notebookWithTopic()
    const day = (back: number, hour: number): Date => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - back, hour, 30)
    // An answer today (10:00), a focus session late yesterday, a card review just after midnight the day
    // before, then only a break (which doesn't count) and older study.
    await services.recordAnswer(ctx, { topicId: topic.id, source: 'check', question: tf('q', topic.id), response: 'True', confidence: null })
    await studyAt(day(1, 23), notebook.id)
    const card = await services.createCard(ctx, { notebookId: notebook.id, topicId: topic.id, front: 'F', back: 'B' })
    ctx.setNow(day(2, 0))
    await services.reviewCard(ctx, { cardId: card.id, rating: 3, confidence: null, response: '' })
    ctx.setNow(NOW)
    await studyAt(day(3, 9), null, 'break')
    await studyAt(day(5, 12), null)
    expect((await services.getToday(ctx)).streakDays).toBe(3)
    expect((await services.getInsights(ctx)).streakDays).toBe(3)

    // Tomorrow morning, before studying: the streak still stands.
    ctx.setNow(new Date(NOW.getTime() + DAY - 2 * 60 * 60 * 1000))
    expect((await services.getToday(ctx)).streakDays).toBe(3)
    // The day after, it has lapsed.
    ctx.setNow(new Date(NOW.getTime() + 2 * DAY))
    expect((await services.getToday(ctx)).streakDays).toBe(0)
  })
})

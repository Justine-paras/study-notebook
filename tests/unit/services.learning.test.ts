// Service behaviour that depends on the real learning rules (no learning
// fake): what counts as weak, how a Hard review is logged, what Today and
// Insights leave out, and the study streak walked day by day.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Question } from '@shared/types'
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

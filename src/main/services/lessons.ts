// The topic learning path: lesson, warm-up/check answers, explain-it grading
// and the Remember step.

import type { FinishTopicResult, RecordAnswerInput } from '@shared/api'
import { isAppError } from '@shared/errors'
import { applyRating, gradeResponse, localDate, newCardSchedule, reviewPlanLabels } from '@shared/learning'
import type { AnswerRecord, Card, ExplanationFeedback, ID, Lesson, Question, Topic } from '@shared/types'
import type { AiSourceDoc, GeneratedCard } from '../ai'
import type { AppContext } from '../context'
import { insertAnswer, listAnswersForTopic } from '../db/repositories/answers'
import { listCardsForTopic } from '../db/repositories/cards'
import { findLessonByTopic, upsertLesson } from '../db/repositories/lessons'
import { findTopicNoteByKind, insertNote, updateNoteRow } from '../db/repositories/notes'
import { findTopic, listTopicRows, updateTopicRow } from '../db/repositories/topics'
import { transaction } from '../db/sql'
import { insertDedupedCards, type NewCardInput } from './cards'
import {
  invalid,
  newId,
  notFound,
  nowIso,
  requireConfidence,
  requireNotebook,
  requireText,
  requireTopic,
  runAiJob,
  startOfNextLocalDay,
  topicBrief
} from './common'
import { readStoredSettings } from './settings'
import { selectTopicSources } from './topicSources'

const LESSON_FLASHCARDS = 8
const REVIEW_PLAN_LENGTH = 5
const EXPLANATION_MAX = 20_000

function requireLesson(ctx: AppContext, topicId: ID): Lesson {
  const lesson = findLessonByTopic(ctx.db, topicId)
  if (!lesson) throw invalid('Create the lesson for this topic first.')
  return lesson
}

/** Every question the lesson asks (warm-up and chunk checks). */
function lessonQuestions(lesson: Lesson): Question[] {
  return [...lesson.content.warmup, ...lesson.content.chunks.map((c) => c.check)]
}

export async function getLesson(ctx: AppContext, topicId: ID): Promise<Lesson | null> {
  requireTopic(ctx, topicId)
  return findLessonByTopic(ctx.db, topicId)
}

export async function generateLesson(ctx: AppContext, topicId: ID, options: { regenerate?: boolean } = {}): Promise<Lesson> {
  const topic = requireTopic(ctx, topicId)
  const existing = findLessonByTopic(ctx.db, topicId)
  if (existing && !options?.regenerate) return existing

  const notebook = requireNotebook(ctx, topic.notebookId)
  const selection = selectTopicSources(ctx, topic)
  const otherTopics = listTopicRows(ctx.db, topic.notebookId)
    .filter((t) => t.id !== topic.id)
    .map(topicBrief)
  const content = await runAiJob(ctx, 'lesson', `Writing your lesson on ${topic.title}`, (callOptions) =>
    ctx.ai.generateLesson({ notebookName: notebook.name, topic: topicBrief(topic), sources: selection.docs, otherTopics }, callOptions)
  )

  const lesson: Lesson = {
    id: newId(),
    topicId,
    // The backend knows exactly what it sent (including page cuts); the model's own list may not.
    content: { ...content, sourcesUsed: selection.labels },
    createdAt: nowIso(ctx)
  }
  transaction(ctx.db, () => {
    const current = findTopic(ctx.db, topicId)
    if (!current) throw notFound('Topic')
    upsertLesson(ctx.db, lesson)
    const restartChunks = existing !== null && current.chunkIndex >= content.chunks.length
    if (current.pathStep === null || restartChunks) {
      updateTopicRow(ctx.db, {
        ...current,
        pathStep: current.pathStep ?? 'warmup',
        // A regenerated lesson can have fewer parts than the learner had reached.
        chunkIndex: restartChunks ? 0 : current.chunkIndex,
        startedAt: current.startedAt ?? lesson.createdAt
      })
    }
  })
  return lesson
}

function requireQuestion(value: unknown): Question {
  if (typeof value !== 'object' || value === null) throw invalid('The question is missing.')
  const q = value as Partial<Question>
  if (typeof q.prompt !== 'string' || typeof q.answer !== 'string' || typeof q.type !== 'string') {
    throw invalid('The question is incomplete.')
  }
  return {
    id: typeof q.id === 'string' ? q.id : newId(),
    type: q.type,
    prompt: q.prompt,
    options: Array.isArray(q.options) ? q.options.filter((o): o is string => typeof o === 'string') : [],
    answer: q.answer,
    acceptable: Array.isArray(q.acceptable) ? q.acceptable.filter((a): a is string => typeof a === 'string') : [],
    explanation: typeof q.explanation === 'string' ? q.explanation : '',
    topicId: typeof q.topicId === 'string' ? q.topicId : null,
    difficulty: q.difficulty ?? 'medium',
    sourceRef: typeof q.sourceRef === 'string' ? q.sourceRef : ''
  }
}

export async function recordAnswer(ctx: AppContext, input: RecordAnswerInput): Promise<{ correct: boolean; record: AnswerRecord }> {
  if (typeof input !== 'object' || input === null) throw invalid('Answer details are required.')
  const topic = requireTopic(ctx, input.topicId)
  if (input.source !== 'warmup' && input.source !== 'check') throw invalid('Answers can only be recorded for warm-up or check questions.')
  const question = requireQuestion(input.question)
  const response = typeof input.response === 'string' ? input.response : ''
  const correct = gradeResponse(question, response)
  const record: AnswerRecord = {
    id: newId(),
    notebookId: topic.notebookId,
    topicId: topic.id,
    quizId: null,
    cardId: null,
    source: input.source,
    questionType: question.type,
    prompt: question.prompt,
    userAnswer: response,
    correctAnswer: question.answer,
    correct,
    confidence: requireConfidence(input.confidence),
    answeredAt: nowIso(ctx)
  }
  insertAnswer(ctx.db, record)
  return { correct, record }
}

function bulletList(items: string[]): string {
  return items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : '- (none)'
}

/** The explanation note's Markdown body: the learner's words, then the feedback. */
export function explanationNoteBody(explanation: string, feedback: ExplanationFeedback): string {
  return [
    explanation.trim(),
    '',
    '## Feedback',
    '',
    `**Score:** ${Math.round(feedback.score)}/100`,
    '',
    '**Got it**',
    '',
    bulletList(feedback.covered),
    '',
    '**Missing**',
    '',
    bulletList(feedback.missing),
    '',
    '**Misconceptions**',
    '',
    bulletList(feedback.misconceptions),
    '',
    '**Try**',
    '',
    feedback.suggestion.trim() || '(none)'
  ].join('\n')
}

export async function gradeExplanation(ctx: AppContext, topicId: ID, explanation: string): Promise<ExplanationFeedback> {
  const topic = requireTopic(ctx, topicId)
  const text = requireText(explanation, 'Your explanation', EXPLANATION_MAX)
  const lesson = requireLesson(ctx, topicId)
  let sources: AiSourceDoc[] = []
  try {
    sources = selectTopicSources(ctx, topic).docs
  } catch (err) {
    // The rubric alone is enough to grade against when the files are gone.
    if (!isAppError(err) || err.code !== 'NO_SOURCES') throw err
  }
  const feedback = await runAiJob(ctx, 'explanation', 'Reading your explanation', (options) =>
    ctx.ai.gradeExplanation(
      { topic: topicBrief(topic), prompt: lesson.content.explainPrompt, rubric: lesson.content.explainRubric, explanation: text, sources },
      options
    )
  )

  const now = nowIso(ctx)
  const title = `My explanation: ${topic.title}`
  const body = explanationNoteBody(text, feedback)
  transaction(ctx.db, () => {
    if (!findTopic(ctx.db, topicId)) throw notFound('Topic')
    const existing = findTopicNoteByKind(ctx.db, topicId, 'explanation')
    if (existing) {
      updateNoteRow(ctx.db, { ...existing, title, body, updatedAt: now })
    } else {
      insertNote(ctx.db, {
        id: newId(),
        notebookId: topic.notebookId,
        topicId,
        sourceId: null,
        kind: 'explanation',
        title,
        body,
        createdAt: now,
        updatedAt: now
      })
    }
  })
  return feedback
}

/** Cards for warm-up/check questions the learner got wrong (each prompt once). */
function mistakeCardInputs(answers: AnswerRecord[], lesson: Lesson): NewCardInput[] {
  const questions = new Map(lessonQuestions(lesson).map((q) => [q.prompt, q]))
  const seen = new Set<string>()
  const inputs: NewCardInput[] = []
  for (const answer of answers) {
    if ((answer.source !== 'warmup' && answer.source !== 'check') || answer.correct || seen.has(answer.prompt)) continue
    seen.add(answer.prompt)
    const question = questions.get(answer.prompt)
    const explanation = question?.explanation.trim()
    inputs.push({
      front: answer.prompt,
      back: explanation ? `${answer.correctAnswer}\n\n${explanation}` : answer.correctAnswer,
      sourceRef: question?.sourceRef ?? ''
    })
  }
  return inputs
}

/**
 * Upcoming review dates for a card first seen at `firstDue`, simulating a
 * learner who answers Good each time (distinct days only, since early
 * learning steps fall on the same day).
 */
export function simulateReviewPlan(firstDue: Date, now: Date, desiredRetention: number): { label: string; date: string }[] {
  let schedule = newCardSchedule(firstDue)
  let at = firstDue
  const days = new Set<string>()
  const dueDates: string[] = []
  for (let step = 0; step < 30 && dueDates.length < REVIEW_PLAN_LENGTH; step++) {
    const day = localDate(at)
    if (!days.has(day)) {
      days.add(day)
      dueDates.push(at.toISOString())
    }
    schedule = applyRating(schedule, 3, at, desiredRetention).schedule
    const next = new Date(schedule.due)
    // Guard against a schedule that doesn't move forward.
    at = next.getTime() > at.getTime() ? next : new Date(at.getTime() + 60_000)
  }
  return reviewPlanLabels(dueDates, now)
}

export async function finishTopic(ctx: AppContext, topicId: ID): Promise<FinishTopicResult> {
  const topic = requireTopic(ctx, topicId)
  const notebook = requireNotebook(ctx, topic.notebookId)
  const lesson = requireLesson(ctx, topicId)
  const settings = readStoredSettings(ctx)

  // Finishing again must not duplicate cards: only call the AI when this
  // lesson (it may have been regenerated) has no lesson cards yet.
  const hasLessonCards = listCardsForTopic(ctx.db, topicId).some((c) => c.origin === 'lesson' && c.createdAt >= lesson.createdAt)
  let generated: GeneratedCard[] = []
  if (!hasLessonCards) {
    const selection = selectTopicSources(ctx, topic)
    generated = await runAiJob(ctx, 'flashcards', `Making flashcards for ${topic.title}`, (options) =>
      ctx.ai.generateFlashcards(
        { notebookName: notebook.name, topic: topicBrief(topic), lesson: lesson.content, sources: selection.docs, count: LESSON_FLASHCARDS },
        options
      )
    )
  }

  const now = ctx.now()
  // The learner just studied this material, so the first review is tomorrow, not now.
  const firstDue = startOfNextLocalDay(now)
  const firstSchedule = { ...newCardSchedule(now), due: firstDue.toISOString() }

  const { updatedTopic, inserted } = transaction(ctx.db, () => {
    const current = findTopic(ctx.db, topicId)
    if (!current) throw notFound('Topic')
    const target = { notebookId: current.notebookId, topicId }
    const lessonCards = insertDedupedCards(ctx, { ...target, origin: 'lesson' }, generated, () => firstSchedule)
    const mistakeCards = insertDedupedCards(
      ctx,
      { ...target, origin: 'mistake' },
      mistakeCardInputs(listAnswersForTopic(ctx.db, topicId), lesson),
      () => firstSchedule
    )
    const finished: Topic = {
      ...current,
      pathStep: 'done',
      startedAt: current.startedAt ?? now.toISOString(),
      completedAt: current.completedAt ?? now.toISOString()
    }
    updateTopicRow(ctx.db, finished)
    return { updatedTopic: finished, inserted: [...lessonCards, ...mistakeCards] }
  })

  // On a repeat call nothing new is inserted; report the topic's lesson cards so the Remember step isn't empty.
  const insertedIds = new Set(inserted.map((c) => c.id))
  const cardsCreated: Card[] = [
    ...listCardsForTopic(ctx.db, topicId).filter((c) => c.origin === 'lesson' && !insertedIds.has(c.id)),
    ...inserted
  ]
  return {
    topic: updatedTopic,
    cardsCreated,
    reviewPlan: simulateReviewPlan(firstDue, now, settings.desiredRetention)
  }
}

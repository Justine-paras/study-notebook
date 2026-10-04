// Flashcards and spaced-repetition reviews.

import { adjustRatingForConfidence, applyRating, interleaveByNotebook, isRecalledRating, newCardSchedule, previewRatings } from '@shared/learning'
import type { Card, CardOrigin, CardSchedule, ID, Notebook, Rating, ReviewCard, ReviewLog } from '@shared/types'
import type { ReviewInput } from '@shared/api'
import type { AppContext } from '../context'
import { insertAnswer } from '../db/repositories/answers'
import {
  deleteCardRow,
  findCard,
  findCards,
  insertCard,
  listCardRows,
  listCardsForTopic,
  listDueCards,
  updateCardRow
} from '../db/repositories/cards'
import { findNotebook, listNotebookRows } from '../db/repositories/notebooks'
import { insertReviewLog } from '../db/repositories/reviewLogs'
import { findTopic, findTopicTitles } from '../db/repositories/topics'
import { transaction } from '../db/sql'
import {
  cardKey,
  invalid,
  newId,
  notFound,
  nowIso,
  optionalId,
  optionalText,
  requireConfidence,
  requireNotebook,
  requireText,
  scheduleOf
} from './common'
import { readStoredSettings } from './settings'

const FRONT_MAX = 2_000
const BACK_MAX = 8_000

export interface NewCardInput {
  front: string
  back: string
  sourceRef: string
}

/**
 * Inserts cards for one topic (or the notebook's topic-less cards when
 * `topicId` is null), skipping any whose normalised front already exists
 * there or earlier in the batch. `onExisting` is told about each input that
 * matched a card already stored. Call inside a transaction.
 */
export function insertDedupedCards(
  ctx: AppContext,
  target: { notebookId: ID; topicId: ID | null; origin: CardOrigin },
  inputs: NewCardInput[],
  scheduleFor: (input: NewCardInput) => CardSchedule,
  onExisting?: (card: Card, input: NewCardInput) => void
): Card[] {
  const existing =
    target.topicId !== null
      ? listCardsForTopic(ctx.db, target.topicId)
      : listCardRows(ctx.db, target.notebookId).filter((c) => c.topicId === null)
  // null marks a front first seen earlier in this batch.
  const seen = new Map<string, Card | null>(existing.map((c) => [cardKey(c.front), c]))
  const createdAt = nowIso(ctx)
  const created: Card[] = []
  for (const input of inputs) {
    const front = input.front.trim()
    const back = input.back.trim()
    const key = cardKey(front)
    if (!front || !back || !key) continue
    if (seen.has(key)) {
      const stored = seen.get(key)
      if (stored) onExisting?.(stored, input)
      continue
    }
    seen.set(key, null)
    const card: Card = {
      ...scheduleFor(input),
      id: newId(),
      notebookId: target.notebookId,
      topicId: target.topicId,
      front: front.slice(0, FRONT_MAX),
      back: back.slice(0, BACK_MAX),
      origin: target.origin,
      sourceRef: input.sourceRef.trim(),
      suspended: false,
      createdAt
    }
    insertCard(ctx.db, card)
    created.push(card)
  }
  return created
}

function requireCard(ctx: AppContext, id: ID): Card {
  const card = typeof id === 'string' ? findCard(ctx.db, id) : null
  if (!card) throw notFound('Flashcard')
  return card
}

/** A topic id that must belong to `notebookId` (or null for a notebook-wide card). */
function requireTopicInNotebook(ctx: AppContext, notebookId: ID, topicId: unknown): ID | null {
  if (topicId === null || topicId === undefined) return null
  if (typeof topicId !== 'string') throw invalid('Topic must be an id or null.')
  const topic = findTopic(ctx.db, topicId)
  if (!topic) throw notFound('Topic')
  if (topic.notebookId !== notebookId) throw invalid('That topic belongs to another notebook.')
  return topicId
}

function requireRating(value: unknown): Rating {
  if (value === 1 || value === 2 || value === 3 || value === 4) return value
  throw invalid('Rating must be 1 (Again), 2 (Hard), 3 (Good) or 4 (Easy).')
}

export async function getReviewQueue(
  ctx: AppContext,
  options: { limit?: number; notebookId?: ID; cardIds?: ID[] } = {}
): Promise<ReviewCard[]> {
  const opts = options ?? {}
  const settings = readStoredSettings(ctx)
  const now = ctx.now()

  let cards: Card[]
  if (opts.cardIds !== undefined) {
    if (!Array.isArray(opts.cardIds) || opts.cardIds.some((id) => typeof id !== 'string')) throw invalid('Card ids must be a list of ids.')
    // A session holds card ids from when it started: cards deleted since then are skipped.
    const byId = new Map(findCards(ctx.db, opts.cardIds).map((c) => [c.id, c]))
    cards = opts.cardIds.map((id) => byId.get(id)).filter((c): c is Card => c !== undefined)
  } else {
    if (opts.notebookId !== undefined) requireNotebook(ctx, opts.notebookId)
    const limit = opts.limit ?? settings.maxReviewsPerDay
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) throw invalid('Limit must be a whole number above 0.')
    // listDueCards is ordered most overdue first; cap before interleaving so the cap keeps the most urgent cards.
    cards = interleaveByNotebook(listDueCards(ctx.db, now.toISOString(), opts.notebookId).slice(0, limit))
  }
  return toReviewCards(ctx, cards, now, settings.desiredRetention)
}

function toReviewCards(ctx: AppContext, cards: Card[], now: Date, retention: number): ReviewCard[] {
  if (cards.length === 0) return []
  const notebooks = new Map<ID, Notebook>(listNotebookRows(ctx.db).map((n) => [n.id, n]))
  const topicTitles = findTopicTitles(ctx.db, [...new Set(cards.map((c) => c.topicId).filter((id): id is ID => id !== null))])
  return cards.map((card) => {
    const notebook = notebooks.get(card.notebookId)
    return {
      ...card,
      notebookName: notebook?.name ?? '',
      notebookColor: notebook?.color ?? 'slate',
      topicTitle: card.topicId ? (topicTitles.get(card.topicId) ?? null) : null,
      previews: previewRatings(scheduleOf(card), now, retention)
    }
  })
}

export async function reviewCard(ctx: AppContext, input: ReviewInput): Promise<Card> {
  if (typeof input !== 'object' || input === null) throw invalid('Review details are required.')
  const card = requireCard(ctx, input.cardId)
  const confidence = requireConfidence(input.confidence)
  const rating = adjustRatingForConfidence(requireRating(input.rating), confidence)
  const response = optionalText(input.response, 'Answer', BACK_MAX)
  const settings = readStoredSettings(ctx)
  const now = ctx.now()
  const reviewedAt = now.toISOString()

  const { schedule, log } = applyRating(scheduleOf(card), rating, now, settings.desiredRetention)
  const updated: Card = { ...card, ...schedule }
  const reviewLog: ReviewLog = { id: newId(), cardId: card.id, rating, confidence, ...log, reviewedAt }

  transaction(ctx.db, () => {
    updateCardRow(ctx.db, updated)
    insertReviewLog(ctx.db, reviewLog, card.notebookId)
    insertAnswer(ctx.db, {
      id: newId(),
      notebookId: card.notebookId,
      topicId: card.topicId,
      quizId: null,
      cardId: card.id,
      source: 'review',
      questionType: 'recall',
      prompt: card.front,
      userAnswer: response,
      correctAnswer: card.back,
      correct: isRecalledRating(rating),
      confidence,
      answeredAt: reviewedAt
    })
  })
  return updated
}

export async function listCards(ctx: AppContext, notebookId: ID, topicId?: ID): Promise<Card[]> {
  requireNotebook(ctx, notebookId)
  return listCardRows(ctx.db, notebookId, optionalId(topicId, 'Topic'))
}

export async function createCard(ctx: AppContext, input: { notebookId: ID; topicId: ID | null; front: string; back: string }): Promise<Card> {
  if (typeof input !== 'object' || input === null) throw invalid('Card details are required.')
  requireNotebook(ctx, input.notebookId)
  const topicId = requireTopicInNotebook(ctx, input.notebookId, input.topicId)
  const now = ctx.now()
  const card: Card = {
    ...newCardSchedule(now),
    id: newId(),
    notebookId: input.notebookId,
    topicId,
    front: requireText(input.front, 'Front', FRONT_MAX),
    back: requireText(input.back, 'Back', BACK_MAX),
    origin: 'manual',
    sourceRef: '',
    suspended: false,
    createdAt: now.toISOString()
  }
  insertCard(ctx.db, card)
  return card
}

export async function updateCard(
  ctx: AppContext,
  id: ID,
  patch: Partial<Pick<Card, 'front' | 'back' | 'suspended' | 'topicId'>>
): Promise<Card> {
  const card = requireCard(ctx, id)
  if (typeof patch !== 'object' || patch === null) throw invalid('Nothing to update.')
  if (patch.suspended !== undefined && typeof patch.suspended !== 'boolean') throw invalid('Suspended must be true or false.')
  if (!findNotebook(ctx.db, card.notebookId)) throw notFound('Notebook')
  const updated: Card = {
    ...card,
    front: patch.front !== undefined ? requireText(patch.front, 'Front', FRONT_MAX) : card.front,
    back: patch.back !== undefined ? requireText(patch.back, 'Back', BACK_MAX) : card.back,
    suspended: patch.suspended ?? card.suspended,
    topicId: patch.topicId !== undefined ? requireTopicInNotebook(ctx, card.notebookId, patch.topicId) : card.topicId
  }
  updateCardRow(ctx.db, updated)
  return updated
}

export async function deleteCard(ctx: AppContext, id: ID): Promise<void> {
  requireCard(ctx, id)
  deleteCardRow(ctx.db, id)
}

import type { DatabaseSync } from 'node:sqlite'
import type { Card, CardOrigin, CardState, ID } from '@shared/types'
import { bool, fromBool, num, prepare, str, strOrNull, type Row } from '../sql'

function toCard(row: Row): Card {
  return {
    id: str(row, 'id'),
    notebookId: str(row, 'notebook_id'),
    topicId: strOrNull(row, 'topic_id'),
    front: str(row, 'front'),
    back: str(row, 'back'),
    origin: str(row, 'origin') as CardOrigin,
    sourceRef: str(row, 'source_ref'),
    suspended: bool(row, 'suspended'),
    createdAt: str(row, 'created_at'),
    due: str(row, 'due'),
    stability: num(row, 'stability'),
    difficulty: num(row, 'difficulty'),
    elapsedDays: num(row, 'elapsed_days'),
    scheduledDays: num(row, 'scheduled_days'),
    learningSteps: num(row, 'learning_steps'),
    reps: num(row, 'reps'),
    lapses: num(row, 'lapses'),
    state: str(row, 'state') as CardState,
    lastReview: strOrNull(row, 'last_review')
  }
}

export function insertCard(db: DatabaseSync, card: Card): void {
  prepare(
    db,
    `INSERT INTO cards (id, notebook_id, topic_id, front, back, origin, source_ref, suspended, created_at, due, stability, difficulty,
       elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    card.id,
    card.notebookId,
    card.topicId,
    card.front,
    card.back,
    card.origin,
    card.sourceRef,
    fromBool(card.suspended),
    card.createdAt,
    card.due,
    card.stability,
    card.difficulty,
    card.elapsedDays,
    card.scheduledDays,
    card.learningSteps,
    card.reps,
    card.lapses,
    card.state,
    card.lastReview
  )
}

export function updateCardRow(db: DatabaseSync, card: Card): void {
  prepare(
    db,
    `UPDATE cards SET topic_id = ?, front = ?, back = ?, source_ref = ?, suspended = ?, due = ?, stability = ?, difficulty = ?,
       elapsed_days = ?, scheduled_days = ?, learning_steps = ?, reps = ?, lapses = ?, state = ?, last_review = ? WHERE id = ?`
  ).run(
    card.topicId,
    card.front,
    card.back,
    card.sourceRef,
    fromBool(card.suspended),
    card.due,
    card.stability,
    card.difficulty,
    card.elapsedDays,
    card.scheduledDays,
    card.learningSteps,
    card.reps,
    card.lapses,
    card.state,
    card.lastReview,
    card.id
  )
}

export function findCard(db: DatabaseSync, id: ID): Card | null {
  const row = prepare(db, 'SELECT * FROM cards WHERE id = ?').get(id)
  return row ? toCard(row) : null
}

export function findCards(db: DatabaseSync, ids: ID[]): Card[] {
  if (ids.length === 0) return []
  return prepare(db, 'SELECT * FROM cards WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids)).map(toCard)
}

/** Cards of a notebook (optionally one topic), oldest first. */
export function listCardRows(db: DatabaseSync, notebookId: ID, topicId?: ID): Card[] {
  const rows = topicId
    ? prepare(db, 'SELECT * FROM cards WHERE notebook_id = ? AND topic_id = ? ORDER BY created_at ASC, rowid ASC').all(notebookId, topicId)
    : prepare(db, 'SELECT * FROM cards WHERE notebook_id = ? ORDER BY created_at ASC, rowid ASC').all(notebookId)
  return rows.map(toCard)
}

export function listCardsForTopic(db: DatabaseSync, topicId: ID): Card[] {
  return prepare(db, 'SELECT * FROM cards WHERE topic_id = ? ORDER BY created_at ASC, rowid ASC').all(topicId).map(toCard)
}

/** Non-suspended cards tied to a topic, for mastery. One notebook, or all when `notebookId` is null. */
export function listActiveTopicCards(db: DatabaseSync, notebookId: ID | null): Card[] {
  const rows = notebookId
    ? prepare(db, 'SELECT * FROM cards WHERE notebook_id = ? AND topic_id IS NOT NULL AND suspended = 0').all(notebookId)
    : prepare(db, 'SELECT * FROM cards WHERE topic_id IS NOT NULL AND suspended = 0').all()
  return rows.map(toCard)
}

/** Every non-suspended card in non-archived notebooks. */
export function listActiveCards(db: DatabaseSync): Card[] {
  return prepare(
    db,
    `SELECT c.* FROM cards c JOIN notebooks n ON n.id = c.notebook_id
     WHERE c.suspended = 0 AND n.archived = 0`
  )
    .all()
    .map(toCard)
}

/** Non-suspended cards due at or before `nowIso`, most overdue first. Archived notebooks are skipped unless asked for by id. */
export function listDueCards(db: DatabaseSync, nowIso: string, notebookId?: ID): Card[] {
  const rows = notebookId
    ? prepare(db, 'SELECT * FROM cards WHERE notebook_id = ? AND suspended = 0 AND due <= ? ORDER BY due ASC, created_at ASC, rowid ASC').all(
        notebookId,
        nowIso
      )
    : prepare(
        db,
        `SELECT c.* FROM cards c JOIN notebooks n ON n.id = c.notebook_id
         WHERE c.suspended = 0 AND c.due <= ? AND n.archived = 0
         ORDER BY c.due ASC, c.created_at ASC, c.rowid ASC`
      ).all(nowIso)
  return rows.map(toCard)
}

export function countDueCardsByNotebook(db: DatabaseSync, nowIso: string): Map<ID, number> {
  const counts = new Map<ID, number>()
  for (const row of prepare(db, 'SELECT notebook_id, COUNT(*) AS n FROM cards WHERE suspended = 0 AND due <= ? GROUP BY notebook_id').all(nowIso)) {
    counts.set(str(row, 'notebook_id'), num(row, 'n'))
  }
  return counts
}

export function countLongTermCards(db: DatabaseSync, minStability: number): number {
  const row = prepare(
    db,
    `SELECT COUNT(*) AS n FROM cards c JOIN notebooks n ON n.id = c.notebook_id
     WHERE c.suspended = 0 AND n.archived = 0 AND c.stability >= ?`
  ).get(minStability)
  return row ? num(row, 'n') : 0
}

export function deleteCardRow(db: DatabaseSync, id: ID): boolean {
  return Number(prepare(db, 'DELETE FROM cards WHERE id = ?').run(id).changes) > 0
}

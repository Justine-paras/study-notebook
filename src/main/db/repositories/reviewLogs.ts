import type { DatabaseSync } from 'node:sqlite'
import type { CardState, Confidence, ID, Rating, ReviewLog } from '@shared/types'
import { num, prepare, str, strOrNull, type Row } from '../sql'

function toReviewLog(row: Row): ReviewLog {
  return {
    id: str(row, 'id'),
    cardId: str(row, 'card_id'),
    rating: num(row, 'rating') as Rating,
    confidence: strOrNull(row, 'confidence') as Confidence | null,
    stateBefore: str(row, 'state_before') as CardState,
    scheduledDays: num(row, 'scheduled_days'),
    elapsedDays: num(row, 'elapsed_days'),
    reviewedAt: str(row, 'reviewed_at')
  }
}

export function insertReviewLog(db: DatabaseSync, log: ReviewLog, notebookId: ID): void {
  prepare(
    db,
    `INSERT INTO review_logs (id, card_id, notebook_id, rating, confidence, state_before, scheduled_days, elapsed_days, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(log.id, log.cardId, notebookId, log.rating, log.confidence, log.stateBefore, log.scheduledDays, log.elapsedDays, log.reviewedAt)
}

/** Review logs of one notebook's cards, or of all cards when `notebookId` is null. */
export function listReviewLogs(db: DatabaseSync, notebookId: ID | null): ReviewLog[] {
  const rows = notebookId
    ? prepare(db, 'SELECT * FROM review_logs WHERE notebook_id = ? ORDER BY reviewed_at ASC').all(notebookId)
    : prepare(db, 'SELECT * FROM review_logs ORDER BY reviewed_at ASC').all()
  return rows.map(toReviewLog)
}

export function listReviewLogsForCard(db: DatabaseSync, cardId: ID): ReviewLog[] {
  return prepare(db, 'SELECT * FROM review_logs WHERE card_id = ? ORDER BY reviewed_at ASC, rowid ASC').all(cardId).map(toReviewLog)
}

export function listReviewLogsSince(db: DatabaseSync, sinceIso: string): ReviewLog[] {
  return prepare(db, 'SELECT * FROM review_logs WHERE reviewed_at >= ? ORDER BY reviewed_at ASC').all(sinceIso).map(toReviewLog)
}

export function reviewTimestampsSince(db: DatabaseSync, sinceIso: string): string[] {
  return prepare(db, 'SELECT reviewed_at FROM review_logs WHERE reviewed_at >= ?')
    .all(sinceIso)
    .map((row) => str(row, 'reviewed_at'))
}

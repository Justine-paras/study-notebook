// Cross-table activity queries (when did the learner last study?).

import type { DatabaseSync } from 'node:sqlite'
import type { ID } from '@shared/types'
import { prepare, str } from '../sql'

/** Latest answer, review or focus session per notebook (ISO timestamps). */
export function lastStudiedByNotebook(db: DatabaseSync): Map<ID, string> {
  const rows = prepare(
    db,
    `SELECT notebook_id, MAX(at) AS last_at FROM (
       SELECT notebook_id, MAX(answered_at) AS at FROM answers GROUP BY notebook_id
       UNION ALL SELECT notebook_id, MAX(reviewed_at) FROM review_logs GROUP BY notebook_id
       UNION ALL SELECT notebook_id, MAX(ended_at) FROM focus_sessions WHERE notebook_id IS NOT NULL GROUP BY notebook_id
     ) GROUP BY notebook_id`
  ).all()
  const result = new Map<ID, string>()
  for (const row of rows) {
    const at = str(row, 'last_at')
    if (at) result.set(str(row, 'notebook_id'), at)
  }
  return result
}

/** Start times of every focus session since `sinceIso` (both kinds count as studying). */
export function focusTimestampsSince(db: DatabaseSync, sinceIso: string): string[] {
  return prepare(db, "SELECT started_at FROM focus_sessions WHERE started_at >= ? AND kind = 'focus'")
    .all(sinceIso)
    .map((row) => str(row, 'started_at'))
}

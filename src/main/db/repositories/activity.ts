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

/**
 * True when the learner answered a question, reviewed a card or finished a
 * focus session (breaks don't count) in [fromIso, toIso). Three index probes,
 * so the streak can walk back day by day without loading any history.
 */
export function hasStudyActivityBetween(db: DatabaseSync, fromIso: string, toIso: string): boolean {
  const row = prepare(
    db,
    `SELECT EXISTS (SELECT 1 FROM answers WHERE answered_at >= ?1 AND answered_at < ?2)
         OR EXISTS (SELECT 1 FROM review_logs WHERE reviewed_at >= ?1 AND reviewed_at < ?2)
         OR EXISTS (SELECT 1 FROM focus_sessions WHERE kind = 'focus' AND started_at >= ?1 AND started_at < ?2) AS active`
  ).get(fromIso, toIso)
  return row ? Number(row.active) === 1 : false
}

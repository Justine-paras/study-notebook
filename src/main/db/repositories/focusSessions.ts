import type { DatabaseSync } from 'node:sqlite'
import type { FocusKind, FocusSession } from '@shared/types'
import { num, prepare, str, strOrNull, type Row } from '../sql'

function toFocusSession(row: Row): FocusSession {
  return {
    id: str(row, 'id'),
    notebookId: strOrNull(row, 'notebook_id'),
    kind: str(row, 'kind') as FocusKind,
    startedAt: str(row, 'started_at'),
    endedAt: str(row, 'ended_at'),
    minutes: num(row, 'minutes')
  }
}

export function insertFocusSession(db: DatabaseSync, session: FocusSession): void {
  prepare(db, 'INSERT INTO focus_sessions (id, notebook_id, kind, started_at, ended_at, minutes) VALUES (?, ?, ?, ?, ?, ?)').run(
    session.id,
    session.notebookId,
    session.kind,
    session.startedAt,
    session.endedAt,
    session.minutes
  )
}

export function listFocusSessionsSince(db: DatabaseSync, sinceIso: string, kind?: FocusKind): FocusSession[] {
  const rows = kind
    ? prepare(db, 'SELECT * FROM focus_sessions WHERE started_at >= ? AND kind = ? ORDER BY started_at ASC').all(sinceIso, kind)
    : prepare(db, 'SELECT * FROM focus_sessions WHERE started_at >= ? ORDER BY started_at ASC').all(sinceIso)
  return rows.map(toFocusSession)
}

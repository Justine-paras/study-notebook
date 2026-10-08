import type { DatabaseSync } from 'node:sqlite'
import type { ID, Note, NoteKind } from '@shared/types'
import { prepare, str, strOrNull, type Row } from '../sql'

function toNote(row: Row): Note {
  return {
    id: str(row, 'id'),
    notebookId: str(row, 'notebook_id'),
    topicId: strOrNull(row, 'topic_id'),
    sourceId: strOrNull(row, 'source_id'),
    kind: str(row, 'kind') as NoteKind,
    title: str(row, 'title'),
    body: str(row, 'body'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at')
  }
}

export function insertNote(db: DatabaseSync, note: Note): void {
  prepare(
    db,
    `INSERT INTO notes (id, notebook_id, topic_id, source_id, kind, title, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(note.id, note.notebookId, note.topicId, note.sourceId, note.kind, note.title, note.body, note.createdAt, note.updatedAt)
}

export function updateNoteRow(db: DatabaseSync, note: Note): void {
  prepare(db, 'UPDATE notes SET topic_id = ?, source_id = ?, title = ?, body = ?, updated_at = ? WHERE id = ?').run(
    note.topicId,
    note.sourceId,
    note.title,
    note.body,
    note.updatedAt,
    note.id
  )
}

export function findNote(db: DatabaseSync, id: ID): Note | null {
  const row = prepare(db, 'SELECT * FROM notes WHERE id = ?').get(id)
  return row ? toNote(row) : null
}

/** Most recently edited first. */
export function listNoteRows(db: DatabaseSync, notebookId: ID, topicId?: ID): Note[] {
  const rows = topicId
    ? prepare(db, 'SELECT * FROM notes WHERE notebook_id = ? AND topic_id = ? ORDER BY updated_at DESC, rowid DESC').all(notebookId, topicId)
    : prepare(db, 'SELECT * FROM notes WHERE notebook_id = ? ORDER BY updated_at DESC, rowid DESC').all(notebookId)
  return rows.map(toNote)
}

export function findTopicNoteByKind(db: DatabaseSync, topicId: ID, kind: NoteKind): Note | null {
  const row = prepare(db, 'SELECT * FROM notes WHERE topic_id = ? AND kind = ? ORDER BY created_at ASC, rowid ASC LIMIT 1').get(topicId, kind)
  return row ? toNote(row) : null
}

export function findSourceNoteByKind(db: DatabaseSync, sourceId: ID, kind: NoteKind): Note | null {
  const row = prepare(db, 'SELECT * FROM notes WHERE source_id = ? AND kind = ? ORDER BY created_at ASC, rowid ASC LIMIT 1').get(sourceId, kind)
  return row ? toNote(row) : null
}

export function deleteNoteRow(db: DatabaseSync, id: ID): boolean {
  return Number(prepare(db, 'DELETE FROM notes WHERE id = ?').run(id).changes) > 0
}

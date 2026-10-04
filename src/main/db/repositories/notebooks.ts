import type { DatabaseSync } from 'node:sqlite'
import type { ID, Notebook, NotebookColor } from '@shared/types'
import { bool, fromBool, prepare, str, type Row } from '../sql'

function toNotebook(row: Row): Notebook {
  return {
    id: str(row, 'id'),
    name: str(row, 'name'),
    code: str(row, 'code'),
    color: str(row, 'color') as NotebookColor,
    createdAt: str(row, 'created_at'),
    archived: bool(row, 'archived')
  }
}

export function insertNotebook(db: DatabaseSync, notebook: Notebook): void {
  prepare(db, 'INSERT INTO notebooks (id, name, code, color, archived, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    notebook.id,
    notebook.name,
    notebook.code,
    notebook.color,
    fromBool(notebook.archived),
    notebook.createdAt
  )
}

export function updateNotebookRow(db: DatabaseSync, notebook: Notebook): void {
  prepare(db, 'UPDATE notebooks SET name = ?, code = ?, color = ?, archived = ? WHERE id = ?').run(
    notebook.name,
    notebook.code,
    notebook.color,
    fromBool(notebook.archived),
    notebook.id
  )
}

export function findNotebook(db: DatabaseSync, id: ID): Notebook | null {
  const row = prepare(db, 'SELECT * FROM notebooks WHERE id = ?').get(id)
  return row ? toNotebook(row) : null
}

/** Active notebooks first, then archived; each group oldest first so the shelf order is stable. */
export function listNotebookRows(db: DatabaseSync): Notebook[] {
  return prepare(db, 'SELECT * FROM notebooks ORDER BY archived ASC, created_at ASC, rowid ASC').all().map(toNotebook)
}

export function deleteNotebookRow(db: DatabaseSync, id: ID): boolean {
  return Number(prepare(db, 'DELETE FROM notebooks WHERE id = ?').run(id).changes) > 0
}

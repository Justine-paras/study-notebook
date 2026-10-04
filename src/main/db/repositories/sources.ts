import type { DatabaseSync } from 'node:sqlite'
import type { ID, Source, SourceKind, SourceStatus, SupportedExtension } from '@shared/types'
import { num, numOrNull, prepare, str, strOrNull, type Row } from '../sql'

// Every column except the (potentially huge) extracted text, so listing
// sources never pulls megabytes of text into memory.
const SOURCE_COLUMNS =
  'id, notebook_id, file_name, ext, kind, size_bytes, stored_path, status, error, char_count, page_count, summary, added_at'

function toSource(row: Row): Source {
  return {
    id: str(row, 'id'),
    notebookId: str(row, 'notebook_id'),
    fileName: str(row, 'file_name'),
    ext: str(row, 'ext') as SupportedExtension,
    kind: str(row, 'kind') as SourceKind,
    sizeBytes: num(row, 'size_bytes'),
    storedPath: str(row, 'stored_path'),
    status: str(row, 'status') as SourceStatus,
    error: strOrNull(row, 'error'),
    charCount: num(row, 'char_count'),
    pageCount: numOrNull(row, 'page_count'),
    summary: strOrNull(row, 'summary'),
    addedAt: str(row, 'added_at')
  }
}

export interface SourceWithText {
  id: ID
  notebookId: ID
  fileName: string
  kind: SourceKind
  text: string
}

export function insertSource(db: DatabaseSync, source: Source, text = ''): void {
  prepare(
    db,
    `INSERT INTO sources (id, notebook_id, file_name, ext, kind, size_bytes, stored_path, status, error, text, char_count, page_count, summary, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    source.id,
    source.notebookId,
    source.fileName,
    source.ext,
    source.kind,
    source.sizeBytes,
    source.storedPath,
    source.status,
    source.error,
    text,
    source.charCount,
    source.pageCount,
    source.summary,
    source.addedAt
  )
}

/** Updates the metadata columns; the text column is only written by `setSourceText`. */
export function updateSourceRow(db: DatabaseSync, source: Source): void {
  prepare(
    db,
    `UPDATE sources SET file_name = ?, kind = ?, size_bytes = ?, stored_path = ?, status = ?, error = ?,
       char_count = ?, page_count = ?, summary = ? WHERE id = ?`
  ).run(
    source.fileName,
    source.kind,
    source.sizeBytes,
    source.storedPath,
    source.status,
    source.error,
    source.charCount,
    source.pageCount,
    source.summary,
    source.id
  )
}

export function setSourceText(db: DatabaseSync, id: ID, text: string): void {
  prepare(db, 'UPDATE sources SET text = ? WHERE id = ?').run(text, id)
}

export function findSource(db: DatabaseSync, id: ID): Source | null {
  const row = prepare(db, `SELECT ${SOURCE_COLUMNS} FROM sources WHERE id = ?`).get(id)
  return row ? toSource(row) : null
}

export function listSourceRows(db: DatabaseSync, notebookId: ID): Source[] {
  return prepare(db, `SELECT ${SOURCE_COLUMNS} FROM sources WHERE notebook_id = ? ORDER BY added_at ASC, rowid ASC`)
    .all(notebookId)
    .map(toSource)
}

export function getSourceTextRow(db: DatabaseSync, id: ID): string | null {
  const row = prepare(db, 'SELECT text FROM sources WHERE id = ?').get(id)
  return row ? str(row, 'text') : null
}

/** Ready sources of a notebook with their text, in the order they were added. */
export function listReadySourceTexts(db: DatabaseSync, notebookId: ID): SourceWithText[] {
  return prepare(
    db,
    `SELECT id, notebook_id, file_name, kind, text FROM sources
     WHERE notebook_id = ? AND status = 'ready' ORDER BY added_at ASC, rowid ASC`
  )
    .all(notebookId)
    .map((row) => ({
      id: str(row, 'id'),
      notebookId: str(row, 'notebook_id'),
      fileName: str(row, 'file_name'),
      kind: str(row, 'kind') as SourceKind,
      text: str(row, 'text')
    }))
}

export function deleteSourceRow(db: DatabaseSync, id: ID): boolean {
  return Number(prepare(db, 'DELETE FROM sources WHERE id = ?').run(id).changes) > 0
}

export function countSourcesByNotebook(db: DatabaseSync): Map<ID, number> {
  const counts = new Map<ID, number>()
  for (const row of prepare(db, 'SELECT notebook_id, COUNT(*) AS n FROM sources GROUP BY notebook_id').all()) {
    counts.set(str(row, 'notebook_id'), num(row, 'n'))
  }
  return counts
}

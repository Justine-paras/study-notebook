// Sources: uploaded files, their stored copies and extracted text.

import { basename } from 'node:path'
import { AppError } from '@shared/errors'
import type { ImportFileInput, ImportResult } from '@shared/api'
import { SOURCE_KINDS, type ID, type Note, type Source, type SourceKind, type SourceText } from '@shared/types'
import type { AppContext } from '../context'
import { detectExtension, extractText, guessSourceKind } from '../files/extract'
import { copyIntoLibrary, removeFromLibrary } from '../files/library'
import { findNotebook } from '../db/repositories/notebooks'
import { findSourceNoteByKind, insertNote, updateNoteRow } from '../db/repositories/notes'
import {
  deleteSourceRow,
  findSource,
  getSourceTextRow,
  insertSource,
  listSourceRows,
  setSourceText,
  updateSourceRow
} from '../db/repositories/sources'
import { listTopicRows, updateTopicRow } from '../db/repositories/topics'
import { transaction } from '../db/sql'
import { invalid, newId, notFound, nowIso, requireNotebook, runAiJob } from './common'
import { selectSources } from './sourceBudget'

function requireSource(ctx: AppContext, id: ID): Source {
  const source = typeof id === 'string' ? findSource(ctx.db, id) : null
  if (!source) throw notFound('File')
  return source
}

function requireKind(value: unknown): SourceKind {
  if (typeof value !== 'string' || !(SOURCE_KINDS as readonly string[]).includes(value)) {
    throw invalid(`Kind must be one of: ${SOURCE_KINDS.join(', ')}.`)
  }
  return value as SourceKind
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return String(err)
}

export async function pickFiles(ctx: AppContext): Promise<string[]> {
  return ctx.desktop.pickFiles()
}

/**
 * Imports files one by one so a bad file never blocks the rest: unsupported
 * or unreadable files are reported in `failed`; files that copy but fail to
 * extract are kept with status 'error' so the learner sees why.
 */
export async function importSources(ctx: AppContext, notebookId: ID, files: ImportFileInput[]): Promise<ImportResult> {
  requireNotebook(ctx, notebookId)
  if (!Array.isArray(files)) throw invalid('Choose at least one file.')
  const result: ImportResult = { sources: [], failed: [] }

  for (const file of files) {
    const path = typeof file?.path === 'string' ? file.path : ''
    if (!path) {
      result.failed.push({ path: String(file?.path ?? ''), reason: 'No file path was given.' })
      continue
    }
    const fileName = basename(path)
    const ext = detectExtension(fileName)
    if (!ext) {
      result.failed.push({ path, reason: 'Unsupported file type. Use PDF, PowerPoint, Word, text or Markdown files.' })
      continue
    }
    let kind: SourceKind
    try {
      kind = file.kind !== undefined && file.kind !== null ? requireKind(file.kind) : guessSourceKind(fileName)
    } catch (err) {
      result.failed.push({ path, reason: errorMessage(err) })
      continue
    }

    let stored: { storedPath: string; sizeBytes: number }
    try {
      stored = await copyIntoLibrary(ctx.paths.libraryDir, notebookId, path)
    } catch (err) {
      result.failed.push({ path, reason: `Couldn't copy the file: ${errorMessage(err)}` })
      continue
    }
    // The notebook may have been deleted while the copy was in flight.
    if (!findNotebook(ctx.db, notebookId)) {
      await removeFromLibrary(stored.storedPath)
      throw notFound('Notebook')
    }

    const source: Source = {
      id: newId(),
      notebookId,
      fileName,
      ext,
      kind,
      sizeBytes: stored.sizeBytes,
      storedPath: stored.storedPath,
      status: 'processing',
      error: null,
      charCount: 0,
      pageCount: null,
      summary: null,
      addedAt: nowIso(ctx)
    }
    insertSource(ctx.db, source)

    let finished: Source
    try {
      const extracted = await extractText(stored.storedPath, ext)
      finished = { ...source, status: 'ready', charCount: extracted.text.length, pageCount: extracted.pageCount }
      transaction(ctx.db, () => {
        setSourceText(ctx.db, source.id, extracted.text)
        updateSourceRow(ctx.db, finished)
      })
    } catch (err) {
      finished = { ...source, status: 'error', error: errorMessage(err) || "Couldn't read text from this file." }
      updateSourceRow(ctx.db, finished)
    }
    // Deleted mid-extraction: don't report a source that no longer exists.
    if (findSource(ctx.db, source.id)) result.sources.push(finished)
  }
  return result
}

export async function listSources(ctx: AppContext, notebookId: ID): Promise<Source[]> {
  requireNotebook(ctx, notebookId)
  return listSourceRows(ctx.db, notebookId)
}

export async function updateSource(ctx: AppContext, id: ID, patch: { kind?: SourceKind }): Promise<Source> {
  const source = requireSource(ctx, id)
  if (typeof patch !== 'object' || patch === null) throw invalid('Nothing to update.')
  const updated: Source = { ...source, kind: patch.kind !== undefined ? requireKind(patch.kind) : source.kind }
  updateSourceRow(ctx.db, updated)
  return updated
}

export async function deleteSource(ctx: AppContext, id: ID): Promise<void> {
  const source = requireSource(ctx, id)
  transaction(ctx.db, () => {
    // Topics keep their source links as JSON, which no foreign key can clean up.
    for (const topic of listTopicRows(ctx.db, source.notebookId)) {
      if (topic.sourceIds.includes(id)) updateTopicRow(ctx.db, { ...topic, sourceIds: topic.sourceIds.filter((s) => s !== id) })
    }
    deleteSourceRow(ctx.db, id)
  })
  await removeFromLibrary(source.storedPath)
}

export async function getSourceText(ctx: AppContext, id: ID): Promise<SourceText> {
  requireSource(ctx, id)
  return { sourceId: id, text: getSourceTextRow(ctx.db, id) ?? '' }
}

export async function summarizeSource(ctx: AppContext, id: ID): Promise<Note> {
  const source = requireSource(ctx, id)
  const notebook = requireNotebook(ctx, source.notebookId)
  const text = getSourceTextRow(ctx.db, id) ?? ''
  if (source.status !== 'ready' || !text.trim()) {
    throw new AppError('EXTRACT_FAILED', `${source.fileName} has no readable text to summarize.`)
  }
  // A summary covers the whole file, so with no topic to rank by, the cut keeps the opening pages.
  const selection = selectSources([{ id, fileName: source.fileName, kind: source.kind, text }], { titles: [], descriptions: [] })
  const doc = selection.docs[0]
  const result = await runAiJob(ctx, 'summary', `Summarizing ${source.fileName}`, (options) =>
    ctx.ai.summarizeSource({ notebookName: notebook.name, source: doc }, options)
  )

  const now = nowIso(ctx)
  const title = result.title.trim() || `Summary: ${source.fileName}`
  const cutNote = selection.labels[0] !== source.fileName ? `\n\n_Summarized from ${selection.labels[0]}._` : ''
  const body = result.summary + cutNote
  return transaction(ctx.db, () => {
    const current = findSource(ctx.db, id)
    if (!current) throw notFound('File')
    updateSourceRow(ctx.db, { ...current, summary: body })
    const existing = findSourceNoteByKind(ctx.db, id, 'summary')
    if (existing) {
      const updated: Note = { ...existing, title, body, updatedAt: now }
      updateNoteRow(ctx.db, updated)
      return updated
    }
    const note: Note = {
      id: newId(),
      notebookId: source.notebookId,
      topicId: null,
      sourceId: id,
      kind: 'summary',
      title,
      body,
      createdAt: now,
      updatedAt: now
    }
    insertNote(ctx.db, note)
    return note
  })
}

export async function openSource(ctx: AppContext, id: ID): Promise<void> {
  const source = requireSource(ctx, id)
  await ctx.desktop.openPath(source.storedPath)
}

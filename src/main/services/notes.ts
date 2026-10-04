// Personal notes (AI summaries and explanation notes are stored here too).

import type { ID, Note } from '@shared/types'
import type { AppContext } from '../context'
import { findTopic } from '../db/repositories/topics'
import { deleteNoteRow, findNote, insertNote, listNoteRows, updateNoteRow } from '../db/repositories/notes'
import { invalid, newId, notFound, nowIso, optionalId, optionalText, requireNotebook } from './common'

const TITLE_MAX = 200
const BODY_MAX = 200_000

function requireNote(ctx: AppContext, id: ID): Note {
  const note = typeof id === 'string' ? findNote(ctx.db, id) : null
  if (!note) throw notFound('Note')
  return note
}

function requireTopicInNotebook(ctx: AppContext, notebookId: ID, topicId: unknown): ID | null {
  if (topicId === null || topicId === undefined) return null
  if (typeof topicId !== 'string') throw invalid('Topic must be an id or null.')
  const topic = findTopic(ctx.db, topicId)
  if (!topic) throw notFound('Topic')
  if (topic.notebookId !== notebookId) throw invalid('That topic belongs to another notebook.')
  return topicId
}

export async function listNotes(ctx: AppContext, notebookId: ID, topicId?: ID): Promise<Note[]> {
  requireNotebook(ctx, notebookId)
  return listNoteRows(ctx.db, notebookId, optionalId(topicId, 'Topic'))
}

export async function createNote(ctx: AppContext, input: { notebookId: ID; topicId: ID | null; title: string; body: string }): Promise<Note> {
  if (typeof input !== 'object' || input === null) throw invalid('Note details are required.')
  requireNotebook(ctx, input.notebookId)
  const now = nowIso(ctx)
  const note: Note = {
    id: newId(),
    notebookId: input.notebookId,
    topicId: requireTopicInNotebook(ctx, input.notebookId, input.topicId),
    sourceId: null,
    kind: 'note',
    // A quick jot with no title is still worth keeping.
    title: optionalText(input.title, 'Title', TITLE_MAX) || 'Untitled note',
    body: optionalText(input.body, 'Note', BODY_MAX),
    createdAt: now,
    updatedAt: now
  }
  insertNote(ctx.db, note)
  return note
}

export async function updateNote(ctx: AppContext, id: ID, patch: Partial<Pick<Note, 'title' | 'body' | 'topicId'>>): Promise<Note> {
  const note = requireNote(ctx, id)
  if (typeof patch !== 'object' || patch === null) throw invalid('Nothing to update.')
  const updated: Note = {
    ...note,
    title: patch.title !== undefined ? optionalText(patch.title, 'Title', TITLE_MAX) || 'Untitled note' : note.title,
    body: patch.body !== undefined ? optionalText(patch.body, 'Note', BODY_MAX) : note.body,
    topicId: patch.topicId !== undefined ? requireTopicInNotebook(ctx, note.notebookId, patch.topicId) : note.topicId,
    updatedAt: nowIso(ctx)
  }
  updateNoteRow(ctx.db, updated)
  return updated
}

export async function deleteNote(ctx: AppContext, id: ID): Promise<void> {
  requireNote(ctx, id)
  deleteNoteRow(ctx.db, id)
}

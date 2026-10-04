// Notebooks: one per subject.

import { NOTEBOOK_COLORS, type ID, type Notebook, type NotebookColor, type NotebookSummary } from '@shared/types'
import type { AppContext } from '../context'
import { removeNotebookLibrary } from '../files/library'
import { deleteNotebookRow, insertNotebook, listNotebookRows, updateNotebookRow } from '../db/repositories/notebooks'
import { invalid, newId, nowIso, optionalText, requireNotebook, requireText } from './common'
import { buildSummaries } from './progress'

function requireColor(value: unknown): NotebookColor {
  if (typeof value !== 'string' || !(NOTEBOOK_COLORS as readonly string[]).includes(value)) {
    throw invalid(`Color must be one of: ${NOTEBOOK_COLORS.join(', ')}.`)
  }
  return value as NotebookColor
}

export async function listNotebooks(ctx: AppContext): Promise<NotebookSummary[]> {
  return buildSummaries(ctx, listNotebookRows(ctx.db))
}

export async function getNotebook(ctx: AppContext, id: ID): Promise<NotebookSummary> {
  return buildSummaries(ctx, [requireNotebook(ctx, id)])[0]
}

export async function createNotebook(ctx: AppContext, input: { name: string; code: string; color: NotebookColor }): Promise<Notebook> {
  if (typeof input !== 'object' || input === null) throw invalid('Notebook details are required.')
  const notebook: Notebook = {
    id: newId(),
    name: requireText(input.name, 'Notebook name', 120),
    code: optionalText(input.code, 'Course code', 40),
    color: requireColor(input.color),
    createdAt: nowIso(ctx),
    archived: false
  }
  insertNotebook(ctx.db, notebook)
  return notebook
}

export async function updateNotebook(
  ctx: AppContext,
  id: ID,
  patch: Partial<Pick<Notebook, 'name' | 'code' | 'color' | 'archived'>>
): Promise<Notebook> {
  const notebook = requireNotebook(ctx, id)
  if (typeof patch !== 'object' || patch === null) throw invalid('Nothing to update.')
  if (patch.archived !== undefined && typeof patch.archived !== 'boolean') throw invalid('Archived must be true or false.')
  const updated: Notebook = {
    ...notebook,
    name: patch.name !== undefined ? requireText(patch.name, 'Notebook name', 120) : notebook.name,
    code: patch.code !== undefined ? optionalText(patch.code, 'Course code', 40) : notebook.code,
    color: patch.color !== undefined ? requireColor(patch.color) : notebook.color,
    archived: patch.archived ?? notebook.archived
  }
  updateNotebookRow(ctx.db, updated)
  return updated
}

export async function deleteNotebook(ctx: AppContext, id: ID): Promise<void> {
  requireNotebook(ctx, id)
  // Rows first (cascades to everything in the notebook); a leftover folder is
  // harmless, a row pointing at deleted files is not.
  deleteNotebookRow(ctx.db, id)
  await removeNotebookLibrary(ctx.paths.libraryDir, id)
}

// Validation for the New / Edit notebook dialog (limits match the backend).

import type { NotebookColor } from '@shared/types'

export const NOTEBOOK_NAME_MAX = 120
export const NOTEBOOK_CODE_MAX = 40

export interface NotebookDraft {
  name: string
  code: string
  color: NotebookColor
}

export interface NotebookDraftErrors {
  name?: string
  code?: string
}

/** Collapses runs of whitespace so "  Data   Structures " is saved as "Data Structures". */
export function tidyText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function validateNotebookDraft(draft: NotebookDraft): NotebookDraftErrors {
  const errors: NotebookDraftErrors = {}
  const name = tidyText(draft.name)
  const code = tidyText(draft.code)
  if (!name) errors.name = 'Give the notebook a name, like "Operating Systems".'
  else if (name.length > NOTEBOOK_NAME_MAX) errors.name = `Keep the name under ${NOTEBOOK_NAME_MAX} characters.`
  if (code.length > NOTEBOOK_CODE_MAX) errors.code = `Keep the course code under ${NOTEBOOK_CODE_MAX} characters.`
  return errors
}

export function hasErrors(errors: NotebookDraftErrors): boolean {
  return errors.name !== undefined || errors.code !== undefined
}

/** The draft as the API expects it. */
export function cleanNotebookDraft(draft: NotebookDraft): NotebookDraft {
  return { name: tidyText(draft.name), code: tidyText(draft.code), color: draft.color }
}

/**
 * A color for the next new notebook: the first cover color not on the shelf
 * yet, so subjects are easy to tell apart; cycles when all are used.
 */
export function suggestNotebookColor(used: readonly NotebookColor[], palette: readonly NotebookColor[]): NotebookColor {
  const free = palette.find((color) => !used.includes(color))
  if (free) return free
  return palette[used.length % palette.length] ?? palette[0]!
}

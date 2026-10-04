// State of a batch of file imports (drag and drop or the Upload button).
// Files are imported one at a time so each gets its own progress line and
// result; this module is the pure reducer behind that list.

import { SUPPORTED_EXTENSIONS, type Source, type SourceKind } from '@shared/types'
import { SOURCE_KIND_LABELS } from '../../lib/format'

export type ImportStatus = 'queued' | 'importing' | 'done' | 'warning' | 'failed'

export interface ImportItem {
  /** Unique per item, even when the same file is added twice. */
  key: string
  path: string
  name: string
  status: ImportStatus
  /** Result line: "Added as Lecture", or why it failed. */
  message: string | null
}

export interface DroppedFile {
  /** Absolute path, or '' when the OS gave none (e.g. text dragged from a browser). */
  path: string
  name: string
}

export type ImportAction =
  | { type: 'add'; items: ImportItem[] }
  | { type: 'start'; key: string }
  | { type: 'done'; key: string; source: Pick<Source, 'kind' | 'status' | 'error'> }
  | { type: 'failed'; key: string; reason: string }
  | { type: 'dismiss'; key: string }
  | { type: 'clear-finished' }

/** "Lecture 05.pdf" from a Windows or POSIX path. */
export function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/** Lower-case extension without the dot, '' when none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isSupportedFile(name: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extensionOf(name))
}

export const UNSUPPORTED_REASON = 'Only PDF, PowerPoint (.pptx), Word (.docx), text and Markdown files can be added.'
export const NO_PATH_REASON = "Couldn't find this file on your computer. Try the Upload button instead."

/**
 * Items for newly added files. Files that can never import (no path, wrong
 * type) are marked failed straight away so the learner sees why at once.
 * Files already waiting or importing are skipped.
 */
export function createImportItems(files: readonly DroppedFile[], existing: readonly ImportItem[], nextKey: () => string): ImportItem[] {
  const pending = new Set(existing.filter((i) => i.status === 'queued' || i.status === 'importing').map((i) => i.path))
  const items: ImportItem[] = []
  for (const file of files) {
    const name = file.name || fileNameOf(file.path)
    if (file.path && pending.has(file.path)) continue
    if (file.path) pending.add(file.path)
    let status: ImportStatus = 'queued'
    let message: string | null = null
    if (!file.path) {
      status = 'failed'
      message = NO_PATH_REASON
    } else if (!isSupportedFile(name)) {
      status = 'failed'
      message = UNSUPPORTED_REASON
    }
    items.push({ key: nextKey(), path: file.path, name, status, message })
  }
  return items
}

function doneMessage(source: Pick<Source, 'kind' | 'status' | 'error'>): { status: ImportStatus; message: string } {
  if (source.status === 'error') {
    return {
      status: 'warning',
      message: source.error ? `Added, but its text couldn't be read: ${source.error}` : "Added, but its text couldn't be read."
    }
  }
  return { status: 'done', message: `Added as ${kindLabel(source.kind)}` }
}

function kindLabel(kind: SourceKind): string {
  return SOURCE_KIND_LABELS[kind]
}

export function importReducer(state: ImportItem[], action: ImportAction): ImportItem[] {
  const update = (key: string, patch: Partial<ImportItem>) => state.map((item) => (item.key === key ? { ...item, ...patch } : item))
  switch (action.type) {
    case 'add':
      return action.items.length > 0 ? [...state, ...action.items] : state
    case 'start':
      return update(action.key, { status: 'importing', message: null })
    case 'done':
      return update(action.key, doneMessage(action.source))
    case 'failed':
      return update(action.key, { status: 'failed', message: action.reason })
    case 'dismiss':
      return state.filter((item) => item.key !== action.key)
    case 'clear-finished':
      return state.filter((item) => item.status === 'queued' || item.status === 'importing')
  }
}

export interface ImportProgress {
  total: number
  finished: number
  added: number
  failed: number
  /** True while any file is waiting or importing. */
  active: boolean
}

export function importProgress(items: readonly ImportItem[]): ImportProgress {
  let finished = 0
  let added = 0
  let failed = 0
  for (const item of items) {
    if (item.status === 'done' || item.status === 'warning') {
      finished += 1
      added += 1
    } else if (item.status === 'failed') {
      finished += 1
      failed += 1
    }
  }
  return { total: items.length, finished, added, failed, active: finished < items.length }
}

// Keeps a private copy of every imported file under the app's library folder,
// so notebooks keep working if the original is moved or deleted.
// OWNER: files agent.

import { constants } from 'node:fs'
import { copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { AppError } from '@shared/errors'

export interface StoredFile {
  storedPath: string
  sizeBytes: number
}

// Windows refuses these names with any extension ("CON.pdf" included).
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i
// Keeps the full stored path comfortably under Windows' 260-character limit.
const MAX_NAME_LENGTH = 120
const MAX_COPY_ATTEMPTS = 1000

/**
 * Makes a file name safe on Windows (and everywhere else): removes
 * characters Windows forbids and control characters, trailing dots and
 * spaces, avoids reserved device names and caps the length while keeping the
 * extension.
 */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/g, '')
    .trim()
    .replace(/[. ]+$/, '')

  let ext = extname(cleaned)
  let stem = cleaned.slice(0, cleaned.length - ext.length).replace(/[. ]+$/, '')
  // Nothing left of the name itself (e.g. "<>" or "..pdf").
  if (!stem) stem = 'file'
  if (RESERVED_WINDOWS_NAMES.test(stem.split('.')[0]!.trim())) stem = `_${stem}`
  if (ext.length > 16) {
    stem += ext
    ext = ''
  }
  stem = truncate(stem, MAX_NAME_LENGTH - ext.length).replace(/[. ]+$/, '') || 'file'
  return stem + ext
}

/** Truncates by code point so a surrogate pair is never split. */
function truncate(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : chars.slice(0, max).join('')
}

/** "Lecture.pdf", 2 -> "Lecture (2).pdf". */
export function numberedName(name: string, n: number): string {
  if (n <= 1) return name
  const ext = extname(name)
  return `${name.slice(0, name.length - ext.length)} (${n})${ext}`
}

/** Rejects ids that would escape the library folder ("..", "a/b") before they reach the file system. */
function notebookFolder(libraryDir: string, notebookId: string): string {
  if (typeof notebookId !== 'string' || !notebookId || notebookId !== safeFileName(notebookId) || notebookId.startsWith('.')) {
    throw new AppError('INVALID_INPUT', 'That notebook id is not valid.')
  }
  return join(libraryDir, notebookId)
}

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code
}

/**
 * Copies `srcPath` to `<libraryDir>/<notebookId>/<uniqueName>` keeping the
 * original file name where possible (adds " (2)", " (3)"... on collision).
 * Creates folders as needed.
 */
export async function copyIntoLibrary(libraryDir: string, notebookId: string, srcPath: string): Promise<StoredFile> {
  const folder = notebookFolder(libraryDir, notebookId)

  const source = await stat(srcPath).catch((err: unknown) => {
    if (errorCode(err) === 'ENOENT') throw new AppError('NOT_FOUND', "The file couldn't be found. It may have been moved or deleted.")
    throw err
  })
  if (!source.isFile()) throw new AppError('INVALID_INPUT', 'That is a folder, not a file.')

  await mkdir(folder, { recursive: true })
  const name = safeFileName(basename(srcPath))

  for (let n = 1; n <= MAX_COPY_ATTEMPTS; n++) {
    const storedPath = join(folder, numberedName(name, n))
    try {
      // COPYFILE_EXCL makes "is the name free?" and "take it" one atomic step,
      // so parallel imports of same-named files can't overwrite each other.
      await copyFile(srcPath, storedPath, constants.COPYFILE_EXCL)
    } catch (err) {
      if (errorCode(err) === 'EEXIST') continue
      // Don't leave a half-written copy behind (e.g. disk full).
      await rm(storedPath, { force: true }).catch(() => undefined)
      throw err
    }
    const { size } = await stat(storedPath)
    return { storedPath, sizeBytes: size }
  }
  throw new AppError('UNKNOWN', `Too many files named "${name}" in this notebook.`)
}

/** Deletes a stored copy. Missing files are ignored. */
export async function removeFromLibrary(storedPath: string): Promise<void> {
  if (!storedPath) return
  // Retries cover Windows briefly locking a file that was just opened (antivirus, preview pane).
  await rm(storedPath, { force: true, maxRetries: 3, retryDelay: 100 })
}

/** Deletes a notebook's whole library folder. Missing folders are ignored. */
export async function removeNotebookLibrary(libraryDir: string, notebookId: string): Promise<void> {
  await rm(notebookFolder(libraryDir, notebookId), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

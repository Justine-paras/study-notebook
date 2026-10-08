// Simple stand-ins for src/main/files (extract + library) used by
// services.isolated.test.ts. Every supported file is read as UTF-8 text, so
// tests can write "PDFs" as text files containing [Page N] markers.

import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { AppError } from '@shared/errors'
import type { SourceKind, SupportedExtension } from '@shared/types'

export function detectExtension(fileName: string): SupportedExtension | null {
  const ext = fileName.split('.').pop()?.toLowerCase()
  return ext === 'pdf' || ext === 'pptx' || ext === 'docx' || ext === 'txt' || ext === 'md' ? ext : null
}

export function guessSourceKind(fileName: string): SourceKind {
  const name = fileName.toLowerCase()
  if (name.includes('syllabus')) return 'syllabus'
  if (/midterm|final|exam/.test(name)) return 'exam'
  if (name.includes('quiz')) return 'quiz'
  if (name.endsWith('.pptx')) return 'slides'
  if (/lecture|lesson|week/.test(name)) return 'lecture'
  if (name.includes('notes')) return 'notes'
  return 'other'
}

export async function extractText(filePath: string, ext: SupportedExtension): Promise<{ text: string; pageCount: number | null }> {
  void ext
  const text = await readFile(filePath, 'utf8')
  if (text.includes('CORRUPT')) throw new AppError('EXTRACT_FAILED', 'This PDF has no text layer (it may be scanned).')
  const pages = text.match(/^\[Page \d+\]$/gm)
  return { text, pageCount: pages ? pages.length : null }
}

export async function copyIntoLibrary(libraryDir: string, notebookId: string, srcPath: string): Promise<{ storedPath: string; sizeBytes: number }> {
  const folder = join(libraryDir, notebookId)
  await mkdir(folder, { recursive: true })
  const storedPath = join(folder, basename(srcPath))
  await copyFile(srcPath, storedPath)
  return { storedPath, sizeBytes: (await stat(storedPath)).size }
}

let removalError: Error | null = null

/** Makes the next library removal fail the way Windows does when a file is open in another app. */
export function failNextRemoval(): void {
  removalError = Object.assign(new Error("EBUSY: resource busy or locked, unlink 'Lecture.pdf'"), { code: 'EBUSY' })
}

function takeRemovalError(): void {
  const err = removalError
  removalError = null
  if (err) throw err
}

export async function removeFromLibrary(storedPath: string): Promise<void> {
  takeRemovalError()
  await rm(storedPath, { force: true })
}

export async function removeNotebookLibrary(libraryDir: string, notebookId: string): Promise<void> {
  takeRemovalError()
  await rm(join(libraryDir, notebookId), { recursive: true, force: true })
}

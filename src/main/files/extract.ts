// Text extraction for uploaded files. Runs in the Electron main process
// (Node 24). OWNER: files agent.

import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { AppError } from '@shared/errors'
import { SUPPORTED_EXTENSIONS, type SourceKind, type SupportedExtension } from '@shared/types'
import { extractDocx } from './docx'
import { extractPdf } from './pdf'
import { extractPptx } from './pptx'
import { countVisibleChars, decodeTextFile, tidyText } from './text'

export interface ExtractResult {
  /**
   * Full text. For PDFs each page starts with a line "[Page N]", for PPTX each
   * slide with "[Slide N]" (followed by the slide's notes, if any, after a
   * "Notes:" line). Pages/slides are separated by a blank line. Whitespace is
   * tidied (no runs of more than 2 blank lines, no trailing spaces).
   */
  text: string
  pageCount: number | null
}

/** Lower-case extension if supported, otherwise null. */
export function detectExtension(fileName: string): SupportedExtension | null {
  // basename first so both bare names and full Windows or POSIX paths work.
  const ext = extname(basename(fileName.trim().replace(/\\/g, '/'))).slice(1).toLowerCase()
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext) ? (ext as SupportedExtension) : null
}

/**
 * Splits a file name into lower-case words: separators, camelCase and
 * letter/digit boundaries all split ("CS201_MidtermExam" -> cs, 201, midterm, exam).
 */
export function fileNameWords(fileName: string): string[] {
  const stem = basename(fileName.replace(/\\/g, '/'), extname(fileName))
  return stem
    .replace(/(?<=\p{Ll})(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})|(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/gu, ' ')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

const SYLLABUS_WORDS = new Set(['syllabus', 'syllabi', 'syllabuses', 'curriculum'])
const EXAM_WORDS = new Set([
  'exam', 'exams', 'examination', 'examinations', 'midterm', 'midterms', 'midsem', 'final', 'finals',
  'prelim', 'prelims', 'prefinal', 'prefinals', 'test', 'tests'
])
// "Final project" or "final report" is coursework, not an exam.
const NOT_EXAM_AFTER_FINAL = new Set(['project', 'paper', 'report', 'essay', 'presentation', 'version', 'draft'])
const QUIZ_WORDS = new Set(['quiz', 'quizzes', 'quizes', 'quizz'])
const SLIDE_WORDS = new Set(['slides', 'slide', 'deck', 'ppt', 'pptx', 'powerpoint'])
const LECTURE_WORDS = new Set([
  'lecture', 'lectures', 'lec', 'lect', 'lesson', 'lessons', 'week', 'wk', 'module', 'chapter', 'chap', 'ch',
  'unit', 'topic', 'handout', 'handouts', 'reading', 'readings'
])
const NOTES_WORDS = new Set(['notes', 'note', 'reviewer', 'cheatsheet', 'summary', 'summaries', 'notebook'])

/** Best guess of the source kind from its file name (e.g. "syllabus" -> syllabus, "midterm"/"final"/"exam" -> exam, "quiz" -> quiz, .pptx -> slides, "lecture"/"lesson"/"week" -> lecture, "notes" -> notes). */
export function guessSourceKind(fileName: string): SourceKind {
  const words = fileNameWords(fileName)
  const has = (set: Set<string>): boolean => words.some((w) => set.has(w))
  // Names glued together without separators ("cs201syllabus", "midtermexam").
  const joined = words.join('')

  if (has(SYLLABUS_WORDS) || joined.includes('syllabus') || (words.includes('course') && (words.includes('outline') || words.includes('guide')))) return 'syllabus'

  const isExam = words.some((w, i) => EXAM_WORDS.has(w) && !(w.startsWith('final') && NOT_EXAM_AFTER_FINAL.has(words[i + 1] ?? '')))
  if (isExam || joined.includes('midterm')) return 'exam'
  if (has(QUIZ_WORDS) || joined.includes('quiz')) return 'quiz'

  const ext = detectExtension(fileName)
  if (ext === 'pptx' || has(SLIDE_WORDS)) return 'slides'
  if (has(LECTURE_WORDS)) return 'lecture'
  if (has(NOTES_WORDS) || (words.includes('cheat') && words.includes('sheet'))) return 'notes'
  // Loose text and Markdown files are almost always the learner's own notes.
  if (ext === 'md' || ext === 'txt') return 'notes'
  return 'other'
}

function unsupported(ext: unknown): AppError {
  return new AppError('UNSUPPORTED_FILE', `Files of type "${String(ext)}" are not supported. Use PDF, PowerPoint, Word, text or Markdown files.`)
}

async function extractPlainText(filePath: string): Promise<ExtractResult> {
  const text = tidyText(decodeTextFile(await readFile(filePath)))
  if (countVisibleChars(text) === 0) throw new AppError('EXTRACT_FAILED', 'This file is empty.')
  return { text, pageCount: null }
}

/**
 * Extracts text. Throws AppError('UNSUPPORTED_FILE') for unknown types and
 * AppError('EXTRACT_FAILED', reason) when the file is corrupt or has no text
 * (e.g. a scanned PDF with no text layer: say so in the message).
 */
export async function extractText(filePath: string, ext: SupportedExtension): Promise<ExtractResult> {
  // The IPC boundary means `ext` can be anything at run time.
  if (!(SUPPORTED_EXTENSIONS as readonly unknown[]).includes(ext)) throw unsupported(ext)
  try {
    // Checked up front so an empty download gets the same clear message whatever its type.
    if ((await stat(filePath)).size === 0) throw new AppError('EXTRACT_FAILED', 'This file is empty.')
    switch (ext) {
      case 'pdf':
        return await extractPdf(filePath)
      case 'pptx':
        return await extractPptx(filePath)
      case 'docx':
        return await extractDocx(filePath)
      case 'txt':
      case 'md':
        return await extractPlainText(filePath)
      default:
        throw unsupported(ext)
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    const code = (err as NodeJS.ErrnoException | null)?.code
    if (code === 'ENOENT') throw new AppError('EXTRACT_FAILED', "The file couldn't be found. It may have been moved or deleted.")
    if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') {
      throw new AppError('EXTRACT_FAILED', "The file couldn't be read. Close it in other apps and check you have permission to open it.")
    }
    if (code === 'EISDIR') throw new AppError('EXTRACT_FAILED', 'That is a folder, not a file.')
    const detail = err instanceof Error && err.message ? `: ${err.message}` : ''
    throw new AppError('EXTRACT_FAILED', `Couldn't read text from this file${detail}`)
  }
}

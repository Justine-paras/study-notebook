// Text extraction for uploaded files. Runs in the Electron main process
// (Node 24). OWNER: files agent.

import type { SourceKind, SupportedExtension } from '@shared/types'

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
  void fileName
  throw new Error('TODO')
}

/** Best guess of the source kind from its file name (e.g. "syllabus" -> syllabus, "midterm"/"final"/"exam" -> exam, "quiz" -> quiz, .pptx -> slides, "lecture"/"lesson"/"week" -> lecture, "notes" -> notes). */
export function guessSourceKind(fileName: string): SourceKind {
  void fileName
  throw new Error('TODO')
}

/**
 * Extracts text. Throws AppError('UNSUPPORTED_FILE') for unknown types and
 * AppError('EXTRACT_FAILED', reason) when the file is corrupt or has no text
 * (e.g. a scanned PDF with no text layer: say so in the message).
 */
export async function extractText(filePath: string, ext: SupportedExtension): Promise<ExtractResult> {
  void filePath
  void ext
  throw new Error('TODO')
}

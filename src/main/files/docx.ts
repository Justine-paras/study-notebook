// Word (.docx) text extraction with mammoth.

import mammoth from 'mammoth'
import { AppError } from '@shared/errors'
import { countVisibleChars, tidyText } from './text'
import type { ExtractResult } from './extract'

export async function extractDocx(filePath: string): Promise<ExtractResult> {
  let raw: string
  try {
    // extractRawText ends every paragraph (headings included) with a blank
    // line, which keeps headings on their own lines and paragraphs apart.
    const result = await mammoth.extractRawText({ path: filePath })
    raw = result.value
  } catch {
    // Encrypted .docx files are not zips at all, so they fail here too.
    throw new AppError(
      'EXTRACT_FAILED',
      "This Word document couldn't be opened. It may be damaged, password-protected or an old .doc file renamed to .docx."
    )
  }

  const text = tidyText(raw)
  if (countVisibleChars(text) === 0) {
    throw new AppError('EXTRACT_FAILED', 'This Word document has no text in it.')
  }
  return { text, pageCount: null }
}

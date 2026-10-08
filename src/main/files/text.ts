// Text clean-up shared by every extractor, so the AI and the source budget
// see the same shape of text whatever the file type.

// Keeps \t (0x09) and \n (0x0A); everything else in C0/C1 plus the Unicode
// noncharacters U+FFFE/U+FFFF only ever shows up as noise from broken encodings.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F￾￿]/g

/**
 * Normalises line endings, removes control characters, strips trailing
 * whitespace from every line, collapses runs of more than 2 blank lines and
 * trims blank lines at both ends.
 */
export function tidyText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    // Form feeds and vertical tabs separate pages/lines in some exports: keep the break.
    .replace(/[\f\v]/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(/[ \t 　]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/^\n+|\n+$/g, '')
}

/**
 * Joins words split across lines by a hyphen ("algo-\nrithm" -> "algorithm").
 * Only joins when the next line continues with a lower-case letter, so
 * "COVID-\n19" and dashes before capitalised words survive.
 */
export function dehyphenate(text: string): string {
  return text
    // Soft hyphens are invisible break hints: always join.
    .replace(/­\n(?=\p{L})/gu, '')
    .replace(/­/g, '')
    .replace(/(\p{L})[-‐]\n(?=\p{Ll})/gu, '$1')
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

/** Decodes the XML entities that can appear in Office XML text runs (single pass, so "&amp;lt;" stays "&lt;"). */
export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return ''
      return String.fromCodePoint(code)
    }
    return NAMED_ENTITIES[body] ?? match
  })
}

/** Counts characters that are not whitespace (used to spot PDFs without a text layer). */
export function countVisibleChars(text: string): number {
  return text.replace(/\s+/g, '').length
}

/** Decodes a plain-text file: UTF-8 by default, UTF-16 when it has a byte-order mark (Windows Notepad "Unicode"). */
export function decodeTextFile(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }
  // TextDecoder strips a UTF-8 BOM by default; invalid bytes become U+FFFD instead of failing the import.
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '')
}

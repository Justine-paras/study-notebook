// PDF text extraction with pdfjs-dist (legacy build, the one meant for Node).

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AppError } from '@shared/errors'
import { importPackageEsm, resolvePackageDir, resolvePackageFile, toSlashDir } from './esm'
import { countVisibleChars, dehyphenate, tidyText } from './text'
import type { ExtractResult } from './extract'

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

/** The parts of a pdfjs TextItem the layout logic needs. */
export interface PdfTextItem {
  str: string
  /** [scaleX, skewY, skewX, scaleY, x, y] in PDF user space (y grows upwards). */
  transform: number[]
  width: number
  height: number
  hasEOL: boolean
}

/** Below this average of visible characters per page the PDF almost certainly has no text layer. */
export const MIN_CHARS_PER_PAGE = 20

export const SCANNED_PDF_MESSAGE = 'This PDF looks scanned (no text layer). Export it with text or use OCR first.'

let pdfjsPromise: Promise<PdfjsModule> | null = null

/** Loads pdfjs once per process. A failed load is retried on the next call. */
export function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= importPdfjs().catch((err: unknown) => {
    pdfjsPromise = null
    throw err
  })
  return pdfjsPromise
}

async function importPdfjs(): Promise<PdfjsModule> {
  // pdfjs warns once at load time when it can't polyfill canvas APIs; those
  // only matter for rendering, which this app never does.
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('Warning: Cannot')) return
    originalWarn(...args)
  }
  try {
    const pdfjs = await importPackageEsm<PdfjsModule>('pdfjs-dist/legacy/build/pdf.mjs')
    // In Node pdfjs runs its "worker" in-process by importing workerSrc. Point
    // it at the installed file explicitly rather than relying on a path
    // relative to pdf.mjs.
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(resolvePackageFile('pdfjs-dist/legacy/build/pdf.worker.mjs')).href
    return pdfjs
  } finally {
    console.warn = originalWarn
  }
}

/**
 * Rebuilds a page's text from pdfjs items, which come in content-stream
 * order (reading order for almost every real document). Line breaks come
 * from `hasEOL` and from baseline changes, a blank line marks a gap larger
 * than normal line spacing, and a space is inserted where two runs on the
 * same line are visibly apart but neither carries the space itself.
 */
export function pdfItemsToText(items: readonly PdfTextItem[]): string {
  let out = ''
  let pendingBreak = false
  let prev: { x: number; y: number; endX: number; size: number } | null = null

  for (const item of items) {
    if (!item.str) {
      if (item.hasEOL) pendingBreak = true
      continue
    }
    const [, , skewX = 0, scaleY = 0, x = 0, y = 0] = item.transform
    const size = Math.hypot(skewX, scaleY) || item.height || 10

    if (prev) {
      const lineHeight = Math.max(size, prev.size)
      const dy = Math.abs(y - prev.y)
      if (pendingBreak || dy > lineHeight * 0.5) {
        out += dy > lineHeight * 1.8 ? '\n\n' : '\n'
      } else if (x - prev.endX > size * 0.2 && !/\s$/.test(out) && !/^\s/.test(item.str)) {
        out += ' '
      }
    }

    out += item.str
    pendingBreak = item.hasEOL
    prev = { x, y, endX: x + item.width, size }
  }
  return out
}

/** Tidies one page's text and rejoins words hyphenated across lines. */
export function cleanPageText(raw: string): string {
  return tidyText(dehyphenate(tidyText(raw)))
}

function isPdfjsError(err: unknown, name: string): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === name
}

function toExtractError(err: unknown): AppError {
  if (err instanceof AppError) return err
  if (isPdfjsError(err, 'PasswordException')) {
    return new AppError('EXTRACT_FAILED', 'This PDF is password-protected. Remove the password (save an unlocked copy) and add it again.')
  }
  if (isPdfjsError(err, 'InvalidPDFException')) {
    return new AppError('EXTRACT_FAILED', "This file isn't a valid PDF or it is damaged. Try opening it and saving a fresh copy.")
  }
  const detail = err instanceof Error && err.message ? ` (${err.message})` : ''
  return new AppError('EXTRACT_FAILED', `Couldn't read this PDF. It may be damaged${detail}.`)
}

export async function extractPdf(filePath: string): Promise<ExtractResult> {
  const pdfjs = await loadPdfjs()
  // pdfjs refuses Node Buffers and takes ownership of the bytes it is given.
  const data = new Uint8Array(await readFile(filePath))
  const pdfjsDir = resolvePackageDir('pdfjs-dist')

  const task = pdfjs.getDocument({
    data,
    // Text only: no font loading or rendering. (pdfjs 6 dropped the old
    // isEvalSupported option: it no longer compiles fonts with eval.)
    useSystemFonts: false,
    disableFontFace: true,
    disableAutoFetch: true,
    disableStream: true,
    // CMaps decode text in CJK fonts; standard font data gives correct glyph widths for spacing.
    cMapUrl: toSlashDir(join(pdfjsDir, 'cmaps')),
    cMapPacked: true,
    standardFontDataUrl: toSlashDir(join(pdfjsDir, 'standard_fonts')),
    verbosity: pdfjs.VerbosityLevel.ERRORS
  })

  try {
    const doc = await task.promise
    const pages: string[] = []
    let visible = 0
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      try {
        const content = await page.getTextContent()
        const items = content.items.filter((item): item is Extract<typeof item, { str: string }> => 'str' in item)
        const text = cleanPageText(pdfItemsToText(items))
        visible += countVisibleChars(text)
        pages.push(text ? `[Page ${n}]\n${text}` : `[Page ${n}]`)
      } finally {
        page.cleanup()
      }
    }

    if (doc.numPages === 0) throw new AppError('EXTRACT_FAILED', 'This PDF has no pages.')
    if (visible < MIN_CHARS_PER_PAGE * doc.numPages) throw new AppError('EXTRACT_FAILED', SCANNED_PDF_MESSAGE)

    return { text: pages.join('\n\n'), pageCount: doc.numPages }
  } catch (err) {
    throw toExtractError(err)
  } finally {
    await task.destroy()
  }
}

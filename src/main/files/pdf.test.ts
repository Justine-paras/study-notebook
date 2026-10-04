import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { AppError } from '@shared/errors'
import { extractPdf, loadPdfjs, pdfItemsToText, SCANNED_PDF_MESSAGE, type PdfTextItem } from './pdf'
import { makeEncryptedPdf, makePdf, makeTempDir, rawPdf, writeFixture } from './testFixtures'

function item(str: string, x: number, y: number, options: Partial<PdfTextItem> = {}): PdfTextItem {
  const size = 12
  return { str, transform: [size, 0, 0, size, x, y], width: str.length * 6, height: size, hasEOL: false, ...options }
}

describe('pdfItemsToText', () => {
  it('breaks lines when the baseline moves', () => {
    expect(pdfItemsToText([item('First line', 72, 700), item('Second line', 72, 686)])).toBe('First line\nSecond line')
  })

  it('inserts a blank line for paragraph-sized gaps', () => {
    expect(pdfItemsToText([item('Heading', 72, 700), item('Body', 72, 660)])).toBe('Heading\n\nBody')
  })

  it('honours hasEOL even on the same baseline and skips empty EOL markers', () => {
    const items = [item('a', 72, 700, { hasEOL: true }), item('b', 72, 700), item('', 0, 0, { hasEOL: true }), item('c', 72, 686)]
    expect(pdfItemsToText(items)).toBe('a\nb\nc')
  })

  it('adds a space between separate runs on one line, but not inside words', () => {
    const items = [item('Big', 72, 700, { width: 18 }), item('O', 100, 700, { width: 6 }), item('n', 106, 700)]
    expect(pdfItemsToText(items)).toBe('Big On')
  })

  it('does not double spaces that pdfjs already emitted', () => {
    const items = [item('word ', 72, 700, { width: 30 }), item('next', 110, 700)]
    expect(pdfItemsToText(items)).toBe('word next')
  })

  it('keeps superscripts and subscripts on their line', () => {
    const items = [item('x', 72, 700, { width: 6 }), item('2', 78, 704, { width: 4, transform: [7, 0, 0, 7, 78, 704] }), item(' + y', 82, 700)]
    expect(pdfItemsToText(items)).toBe('x2 + y')
  })

  it('returns an empty string for no items', () => {
    expect(pdfItemsToText([])).toBe('')
  })
})

describe('loadPdfjs', () => {
  it('loads pdfjs once and points the in-process worker at the installed worker file', async () => {
    const first = await loadPdfjs()
    expect(await loadPdfjs()).toBe(first)
    expect(first.GlobalWorkerOptions.workerSrc).toMatch(/^file:\/\/.*pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs$/)
  })
})

describe('extractPdf', () => {
  let dir: string
  let cleanup: () => Promise<void>
  beforeAll(async () => ({ dir, cleanup } = await makeTempDir()))
  afterAll(() => cleanup())

  async function expectFailure(name: string, data: Uint8Array, message: RegExp | string): Promise<void> {
    const path = await writeFixture(dir, name, data)
    const err = await extractPdf(path).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('EXTRACT_FAILED')
    expect((err as AppError).message).toMatch(message)
  }

  it('extracts every page in order with [Page N] markers and de-hyphenates line breaks', async () => {
    const pdf = await makePdf([
      ['Lecture 5: Sorting', '', 'The merge sort algo-', 'rithm splits the array in halves.', 'It runs in O(n log n) time.'],
      ['Quicksort picks a pivot and partitions the array around it.'],
      ['Café crème — résumé: average case is fast, worst case is quadratic.']
    ])
    const path = await writeFixture(dir, 'lecture.pdf', pdf)
    const result = await extractPdf(path)
    expect(result.pageCount).toBe(3)
    expect(result.text).toBe(
      [
        '[Page 1]\nLecture 5: Sorting\n\nThe merge sort algorithm splits the array in halves.\nIt runs in O(n log n) time.',
        '[Page 2]\nQuicksort picks a pivot and partitions the array around it.',
        '[Page 3]\nCafé crème — résumé: average case is fast, worst case is quadratic.'
      ].join('\n\n')
    )
  })

  it('keeps a marker for a blank page between text pages', async () => {
    const text = 'This page has more than enough characters to count as real text.'
    const path = await writeFixture(dir, 'blank-middle.pdf', await makePdf([[text, text], [], [text, text]]))
    const result = await extractPdf(path)
    expect(result.pageCount).toBe(3)
    expect(result.text).toContain('[Page 2]\n\n[Page 3]')
  })

  it('rejects PDFs without a text layer as scanned', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    page.drawRectangle({ x: 50, y: 50, width: 500, height: 700 })
    doc.addPage([612, 792])
    await expectFailure('scan.pdf', await doc.save(), SCANNED_PDF_MESSAGE)
  })

  it('rejects PDFs with almost no text per page as scanned', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    for (let i = 1; i <= 3; i++) doc.addPage([612, 792]).drawText(`p. ${i}`, { x: 500, y: 40, size: 10, font })
    await expectFailure('page-numbers-only.pdf', await doc.save(), SCANNED_PDF_MESSAGE)
  })

  it('explains password-protected PDFs', async () => {
    await expectFailure('locked.pdf', makeEncryptedPdf(), /password-protected/)
  })

  it('explains files that are not PDFs at all', async () => {
    await expectFailure('not-a.pdf', Buffer.from('this is plain text pretending to be a PDF'), /isn't a valid PDF or it is damaged/)
  })

  it('explains truncated PDFs', async () => {
    const pdf = await makePdf([['Some text that will be cut off before the end of the file.']])
    await expectFailure('truncated.pdf', pdf.subarray(0, 60), /isn't a valid PDF or it is damaged/)
  })

  it('reports a PDF with no pages', async () => {
    const empty = rawPdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>'])
    await expectFailure('no-pages.pdf', empty, 'This PDF has no pages.')
  })
})

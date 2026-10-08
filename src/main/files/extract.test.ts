import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '@shared/errors'
import type { SupportedExtension } from '@shared/types'
import { detectExtension, extractText, fileNameWords, guessSourceKind } from './extract'
import { makeDocx, makePdf, makePptx, makeTempDir, writeFixture } from './testFixtures'

describe('detectExtension', () => {
  it.each([
    ['CS201_Syllabus_2026.pdf', 'pdf'],
    ['Week 05 - BST.PPTX', 'pptx'],
    ['Quiz 3.Docx', 'docx'],
    ['My notes.md', 'md'],
    ['readme.TXT', 'txt'],
    ['C:\\Users\\Justine\\Downloads\\Midterm Exam 2025.pdf', 'pdf'],
    ['/home/justine/lecture.v2.final.pdf', 'pdf'],
    ['  spaced.pdf  ', 'pdf']
  ])('%s -> %s', (name, ext) => {
    expect(detectExtension(name)).toBe(ext)
  })

  it.each(['slides.ppt', 'essay.doc', 'archive.tar.gz', 'image.png', 'no-extension', 'pdf', '.pdf.zip', ''])(
    'rejects %s',
    (name) => {
      expect(detectExtension(name)).toBeNull()
    }
  )
})

describe('fileNameWords', () => {
  it('splits on separators, camelCase, acronyms and letter/digit boundaries', () => {
    expect(fileNameWords('CS201_MidtermExam-v2.pdf')).toEqual(['cs', '201', 'midterm', 'exam', 'v', '2'])
    expect(fileNameWords('PDFNotes week5.md')).toEqual(['pdf', 'notes', 'week', '5'])
  })
})

describe('guessSourceKind', () => {
  it.each([
    ['CS201_Syllabus_2026.pdf', 'syllabus'],
    ['syllabus.docx', 'syllabus'],
    ['cs201syllabus.pdf', 'syllabus'],
    ['Course Outline - Data Structures.pdf', 'syllabus'],
    ['Midterm Exam 2025.pdf', 'exam'],
    ['midtermexam.pdf', 'exam'],
    ['Final Exam Review.pptx', 'exam'],
    ['finals_2024.pdf', 'exam'],
    ['Prelim Exam.docx', 'exam'],
    ['Long Test 2.pdf', 'exam'],
    ['Quiz 3.docx', 'quiz'],
    ['Quiz3_answers.pdf', 'quiz'],
    ['Week 07 Quiz.pptx', 'quiz'],
    ['Week 05 - BST.pptx', 'slides'],
    ['Deadlocks.pptx', 'slides'],
    ['Lecture 4 slides.pdf', 'slides'],
    ['Lecture 05 – Deadlocks.pdf', 'lecture'],
    ['Week 3 Graphs.pdf', 'lecture'],
    ['Lesson2-Recursion.docx', 'lecture'],
    ['Chapter 6 Hashing.pdf', 'lecture'],
    ['Final Project Guidelines.pdf', 'other'],
    ['My notes.md', 'notes'],
    ['Reviewer - Sorting.docx', 'notes'],
    ['cheat sheet.pdf', 'notes'],
    ['scratch.txt', 'notes'],
    ['random.pdf', 'other'],
    ['Assignment 1.docx', 'other']
  ])('%s -> %s', (name, kind) => {
    expect(guessSourceKind(name)).toBe(kind)
  })
})

describe('extractText', () => {
  let dir: string
  let cleanup: () => Promise<void>
  beforeAll(async () => ({ dir, cleanup } = await makeTempDir()))
  afterAll(() => cleanup())

  async function failure(path: string, ext: SupportedExtension): Promise<AppError> {
    const err = await extractText(path, ext).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppError)
    return err as AppError
  }

  it('reads UTF-8 text with a BOM, CRLF line endings, control characters and blank-line runs', async () => {
    const raw = '\uFEFF# Graphs\r\n\r\nBFS uses a queue.   \r\n\r\n\r\n\r\n\r\nDFS uses a stack\u0000.\r\nÜnïcödé 日本語 🙂\r\n'
    const path = await writeFixture(dir, 'notes.md', Buffer.from(raw, 'utf8'))
    expect(await extractText(path, 'md')).toEqual({
      text: '# Graphs\n\nBFS uses a queue.\n\n\nDFS uses a stack.\nÜnïcödé 日本語 🙂',
      pageCount: null
    })
  })

  it('reads UTF-16 text files saved by Windows Notepad', async () => {
    const data = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Heap sort\r\nis in place', 'utf16le')])
    const path = await writeFixture(dir, 'heap.txt', data)
    expect((await extractText(path, 'txt')).text).toBe('Heap sort\nis in place')
  })

  it('rejects empty and whitespace-only files', async () => {
    for (const [name, content] of [['empty.txt', ''], ['blank.md', ' \r\n\t\r\n'], ['empty.pdf', '']] as const) {
      const ext = name.endsWith('pdf') ? 'pdf' : name.endsWith('md') ? 'md' : 'txt'
      const err = await failure(await writeFixture(dir, name, content), ext)
      expect(err.code).toBe('EXTRACT_FAILED')
      expect(err.message).toBe('This file is empty.')
    }
  })

  it('dispatches PDF, PPTX and DOCX files to their extractors', async () => {
    const pdf = await writeFixture(dir, 'a.pdf', await makePdf([['A page with a reasonable amount of text on it.']]))
    expect(await extractText(pdf, 'pdf')).toEqual({ text: '[Page 1]\nA page with a reasonable amount of text on it.', pageCount: 1 })
    const pptx = await writeFixture(dir, 'a.pptx', await makePptx([{ title: 'Slide text' }]))
    expect(await extractText(pptx, 'pptx')).toEqual({ text: '[Slide 1]\nSlide text', pageCount: 1 })
    const docx = await writeFixture(dir, 'a.docx', await makeDocx([{ text: 'Word text' }]))
    expect(await extractText(docx, 'docx')).toEqual({ text: 'Word text', pageCount: null })
  })

  it('rejects unsupported types with UNSUPPORTED_FILE', async () => {
    const err = await failure(join(dir, 'whatever.doc'), 'doc' as SupportedExtension)
    expect(err.code).toBe('UNSUPPORTED_FILE')
    expect(err.message).toContain('"doc"')
  })

  it('explains missing files and folders', async () => {
    const missing = await failure(join(dir, 'gone.pdf'), 'pdf')
    expect(missing.code).toBe('EXTRACT_FAILED')
    expect(missing.message).toMatch(/couldn't be found/)

    const folder = join(dir, 'folder.txt')
    await mkdir(folder)
    const isDir = await failure(folder, 'txt')
    expect(isDir.code).toBe('EXTRACT_FAILED')
    expect(isDir.message).toMatch(/folder/)
  })
})

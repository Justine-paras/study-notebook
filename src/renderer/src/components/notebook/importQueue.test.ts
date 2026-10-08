import { describe, expect, it } from 'vitest'
import {
  NO_PATH_REASON,
  UNSUPPORTED_REASON,
  createImportItems,
  extensionOf,
  fileNameOf,
  importProgress,
  importReducer,
  isSupportedFile,
  type ImportItem
} from './importQueue'

function keys() {
  let n = 0
  return () => `k${++n}`
}

describe('file names', () => {
  it('reads names and extensions from Windows and POSIX paths', () => {
    expect(fileNameOf('C:\\Users\\Justine\\Lecture 05.PDF')).toBe('Lecture 05.PDF')
    expect(fileNameOf('/home/j/notes.md')).toBe('notes.md')
    expect(extensionOf('Lecture 05.PDF')).toBe('pdf')
    expect(extensionOf('README')).toBe('')
    expect(extensionOf('.hidden')).toBe('')
    expect(isSupportedFile('Slides.pptx')).toBe(true)
    expect(isSupportedFile('photo.png')).toBe(false)
  })
})

describe('createImportItems', () => {
  it('queues supported files and fails the rest straight away', () => {
    const items = createImportItems(
      [
        { path: 'C:\\a\\Syllabus.pdf', name: 'Syllabus.pdf' },
        { path: 'C:\\a\\photo.png', name: 'photo.png' },
        { path: '', name: 'dragged.txt' }
      ],
      [],
      keys()
    )
    expect(items).toEqual([
      { key: 'k1', path: 'C:\\a\\Syllabus.pdf', name: 'Syllabus.pdf', status: 'queued', message: null },
      { key: 'k2', path: 'C:\\a\\photo.png', name: 'photo.png', status: 'failed', message: UNSUPPORTED_REASON },
      { key: 'k3', path: '', name: 'dragged.txt', status: 'failed', message: NO_PATH_REASON }
    ])
  })

  it('falls back to the path for the name and skips files already in flight', () => {
    const existing: ImportItem[] = [{ key: 'x', path: '/a/b.pdf', name: 'b.pdf', status: 'importing', message: null }]
    const items = createImportItems(
      [
        { path: '/a/b.pdf', name: '' },
        { path: '/a/c.docx', name: '' },
        { path: '/a/c.docx', name: '' }
      ],
      existing,
      keys()
    )
    expect(items.map((i) => [i.name, i.status])).toEqual([['c.docx', 'queued']])
  })

  it('lets a finished file be added again', () => {
    const existing: ImportItem[] = [{ key: 'x', path: '/a/b.pdf', name: 'b.pdf', status: 'failed', message: 'no' }]
    expect(createImportItems([{ path: '/a/b.pdf', name: 'b.pdf' }], existing, keys())).toHaveLength(1)
  })
})

describe('importReducer', () => {
  const start: ImportItem[] = [
    { key: 'a', path: '/a.pdf', name: 'a.pdf', status: 'queued', message: null },
    { key: 'b', path: '/b.pdf', name: 'b.pdf', status: 'queued', message: null },
    { key: 'c', path: '/c.pdf', name: 'c.pdf', status: 'queued', message: null }
  ]

  it('walks each file through importing to a result', () => {
    let state = importReducer(start, { type: 'start', key: 'a' })
    expect(state[0]!.status).toBe('importing')
    state = importReducer(state, { type: 'done', key: 'a', source: { kind: 'syllabus', status: 'ready', error: null } })
    expect(state[0]).toMatchObject({ status: 'done', message: 'Added as Syllabus' })
    state = importReducer(state, { type: 'done', key: 'b', source: { kind: 'lecture', status: 'error', error: 'Scanned PDF' } })
    expect(state[1]).toMatchObject({ status: 'warning', message: "Added, but its text couldn't be read: Scanned PDF" })
    expect(importProgress(state)).toEqual({ total: 3, finished: 2, added: 2, failed: 0, active: true })
    state = importReducer(state, { type: 'failed', key: 'c', reason: 'Too big' })
    expect(state[2]).toMatchObject({ status: 'failed', message: 'Too big' })
    expect(importProgress(state)).toEqual({ total: 3, finished: 3, added: 2, failed: 1, active: false })
  })

  it('dismisses one item or clears every finished one', () => {
    let state = importReducer(start, { type: 'failed', key: 'a', reason: 'x' })
    state = importReducer(state, { type: 'start', key: 'b' })
    expect(importReducer(state, { type: 'dismiss', key: 'a' }).map((i) => i.key)).toEqual(['b', 'c'])
    expect(importReducer(state, { type: 'clear-finished' }).map((i) => i.key)).toEqual(['b', 'c'])
    expect(importReducer(state, { type: 'add', items: [] })).toBe(state)
  })
})

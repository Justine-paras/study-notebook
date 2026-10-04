import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { AppError } from '@shared/errors'
import { copyIntoLibrary, numberedName, removeFromLibrary, removeNotebookLibrary, safeFileName } from './library'
import { makeTempDir, writeFixture } from './testFixtures'

describe('safeFileName', () => {
  it.each([
    ['Lecture 05 – Deadlocks.pdf', 'Lecture 05 – Deadlocks.pdf'],
    ['what<is>this:"file"|really?*.pdf', 'whatisthisfilereally.pdf'],
    ['tab\tand\u0000nul\u001F.txt', 'tabandnul.txt'],
    ['trailing dots... ', 'trailing dots'],
    ['notes .md', 'notes.md'],
    ['CON', '_CON'],
    ['con.txt', '_con.txt'],
    ['NUL.tar.gz', '_NUL.tar.gz'],
    ['com1.pdf', '_com1.pdf'],
    ['LPT9.docx', '_LPT9.docx'],
    ['console.pdf', 'console.pdf'],
    ['', 'file'],
    ['<>?', 'file'],
    ['..pdf', 'file.pdf'],
    ['日本語のノート.md', '日本語のノート.md']
  ])('%j -> %j', (input, expected) => {
    expect(safeFileName(input)).toBe(expected)
  })

  it('caps long names but keeps the extension', () => {
    const name = safeFileName(`${'a'.repeat(300)}.pptx`)
    expect(name.length).toBeLessThanOrEqual(120)
    expect(name.endsWith('.pptx')).toBe(true)
  })

  it('never splits a surrogate pair when shortening', () => {
    const name = safeFileName(`${'🙂'.repeat(200)}.md`)
    expect(name.endsWith('🙂.md')).toBe(true)
    expect(name).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })
})

describe('numberedName', () => {
  it('adds a counter before the extension', () => {
    expect(numberedName('Quiz 3.docx', 1)).toBe('Quiz 3.docx')
    expect(numberedName('Quiz 3.docx', 2)).toBe('Quiz 3 (2).docx')
    expect(numberedName('README', 3)).toBe('README (3)')
  })
})

describe('library', () => {
  let root: string
  let cleanup: () => Promise<void>
  let libraryDir: string
  let originals: string
  beforeAll(async () => {
    ;({ dir: root, cleanup } = await makeTempDir())
    libraryDir = join(root, 'library')
    originals = join(root, 'originals')
    await mkdir(originals)
  })
  afterAll(() => cleanup())

  it('copies into <library>/<notebook>/ keeping the name, contents and size', async () => {
    const src = await writeFixture(originals, 'Week 05 - BST.pptx', 'slide bytes')
    const stored = await copyIntoLibrary(libraryDir, 'nb-1', src)
    expect(stored).toEqual({ storedPath: join(libraryDir, 'nb-1', 'Week 05 - BST.pptx'), sizeBytes: 11 })
    expect(await readFile(stored.storedPath, 'utf8')).toBe('slide bytes')
    expect(await readFile(src, 'utf8')).toBe('slide bytes')
  })

  it('numbers copies of files with the same name instead of overwriting', async () => {
    const src = await writeFixture(originals, 'Quiz 3.docx', 'v1')
    const first = await copyIntoLibrary(libraryDir, 'nb-2', src)
    const second = await copyIntoLibrary(libraryDir, 'nb-2', src)
    const third = await copyIntoLibrary(libraryDir, 'nb-2', src)
    expect([first, second, third].map((s) => basename(s.storedPath))).toEqual(['Quiz 3.docx', 'Quiz 3 (2).docx', 'Quiz 3 (3).docx'])
  })

  it('gives parallel imports of the same name distinct files', async () => {
    const src = await writeFixture(originals, 'Same.pdf', 'x')
    const stored = await Promise.all(Array.from({ length: 8 }, () => copyIntoLibrary(libraryDir, 'nb-parallel', src)))
    expect(new Set(stored.map((s) => s.storedPath)).size).toBe(8)
    expect(await readdir(join(libraryDir, 'nb-parallel'))).toHaveLength(8)
  })

  it('stores files with Windows-unsafe names under a safe name', async () => {
    const src = await writeFixture(originals, 'what? notes*.md ', '# hi')
    const stored = await copyIntoLibrary(libraryDir, 'nb-3', src)
    expect(basename(stored.storedPath)).toBe('what notes.md')
    expect(dirname(stored.storedPath)).toBe(join(libraryDir, 'nb-3'))
  })

  it('reports empty files with size 0', async () => {
    const src = await writeFixture(originals, 'empty.txt', '')
    expect((await copyIntoLibrary(libraryDir, 'nb-4', src)).sizeBytes).toBe(0)
  })

  it('rejects missing files and folders', async () => {
    const missing = await copyIntoLibrary(libraryDir, 'nb-5', join(originals, 'nope.pdf')).catch((e: unknown) => e)
    expect(missing).toBeInstanceOf(AppError)
    expect((missing as AppError).code).toBe('NOT_FOUND')

    const folder = await copyIntoLibrary(libraryDir, 'nb-5', originals).catch((e: unknown) => e)
    expect(folder).toBeInstanceOf(AppError)
    expect((folder as AppError).code).toBe('INVALID_INPUT')
  })

  it.each(['..', '.', '', 'a/b', 'a\\b', '../escape'])('refuses notebook id %j that would leave the library', async (id) => {
    const src = await writeFixture(originals, 'ok.txt', 'ok')
    const err = await copyIntoLibrary(libraryDir, id, src).catch((e: unknown) => e)
    expect((err as AppError).code).toBe('INVALID_INPUT')
    await expect(removeNotebookLibrary(libraryDir, id)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('removes a stored copy and ignores files that are already gone', async () => {
    const src = await writeFixture(originals, 'remove-me.txt', 'bye')
    const { storedPath } = await copyIntoLibrary(libraryDir, 'nb-6', src)
    await removeFromLibrary(storedPath)
    await expect(stat(storedPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(removeFromLibrary(storedPath)).resolves.toBeUndefined()
    await expect(removeFromLibrary('')).resolves.toBeUndefined()
  })

  it("removes a notebook's whole folder and ignores missing folders", async () => {
    const src = await writeFixture(originals, 'keep-or-not.txt', 'data')
    await copyIntoLibrary(libraryDir, 'nb-7', src)
    await copyIntoLibrary(libraryDir, 'nb-8', src)
    await removeNotebookLibrary(libraryDir, 'nb-7')
    await expect(stat(join(libraryDir, 'nb-7'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(join(libraryDir, 'nb-8'))).toEqual(['keep-or-not.txt'])
    await expect(removeNotebookLibrary(libraryDir, 'nb-7')).resolves.toBeUndefined()
    await expect(removeNotebookLibrary(join(root, 'no-library'), 'nb-1')).resolves.toBeUndefined()
  })
})

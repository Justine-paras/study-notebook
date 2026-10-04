import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppError } from '@shared/errors'
import { extractDocx } from './docx'
import { makeDocx, makePptx, makeTempDir, writeFixture } from './testFixtures'

describe('extractDocx', () => {
  let dir: string
  let cleanup: () => Promise<void>
  beforeAll(async () => ({ dir, cleanup } = await makeTempDir()))
  afterAll(() => cleanup())

  async function expectFailure(name: string, data: Uint8Array, message: RegExp): Promise<void> {
    const err = await extractDocx(await writeFixture(dir, name, data)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('EXTRACT_FAILED')
    expect((err as AppError).message).toMatch(message)
  }

  it('keeps headings and paragraphs on their own lines', async () => {
    const docx = await makeDocx([
      { text: 'CS 201 Quiz 3', style: 'Heading1' },
      { text: 'Answer every question.   ' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: 'Part A: Hashing', style: 'Heading2' },
      { text: 'What is the load factor α = n / m? Ünïcödé 日本語 🙂 & <tags>' }
    ])
    const result = await extractDocx(await writeFixture(dir, 'quiz.docx', docx))
    expect(result.pageCount).toBeNull()
    expect(result.text).toBe(
      'CS 201 Quiz 3\n\nAnswer every question.\n\n\nPart A: Hashing\n\nWhat is the load factor α = n / m? Ünïcödé 日本語 🙂 & <tags>'
    )
  })

  it('rejects documents without text', async () => {
    await expectFailure('blank.docx', await makeDocx([{ text: '' }, { text: '   ' }]), /has no text/)
  })

  it('rejects corrupt and non-Word files', async () => {
    await expectFailure('corrupt.docx', Buffer.from('PK\u0003\u0004 broken'), /couldn't be opened/)
    await expectFailure('slides.docx', await makePptx([{ title: 'Not Word' }]), /couldn't be opened/)
  })
})

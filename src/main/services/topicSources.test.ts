import { afterEach, describe, expect, it } from 'vitest'
import type { Source } from '@shared/types'
import { createTestContext, type TestContext } from '../../../tests/unit/helpers/context'
import { insertSource } from '../db/repositories/sources'
import { services } from './index'
import { SOURCE_CHAR_BUDGET } from './sourceBudget'
import { selectTopicSources, sourceCharBudget } from './topicSources'

let ctx: TestContext | null = null

afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

function bigSource(notebookId: string, pages: number): { source: Source; text: string } {
  const text = Array.from({ length: pages }, (_, i) => `[Page ${i + 1}]\n${'Deadlocks need four conditions to hold at once. '.repeat(200)}`).join('\n\n')
  const source: Source = {
    id: 'src-big',
    notebookId,
    fileName: 'Big Textbook.pdf',
    ext: 'pdf',
    kind: 'lecture',
    sizeBytes: text.length,
    storedPath: '/library/Big Textbook.pdf',
    status: 'ready',
    error: null,
    charCount: text.length,
    pageCount: pages,
    summary: null,
    addedAt: '2026-10-01T10:00:00.000Z'
  }
  return { source, text }
}

describe('sourceCharBudget', () => {
  it('keeps the full budget for Opus and Sonnet and a smaller one for Haiku (200K context)', () => {
    expect(sourceCharBudget('claude-opus-5-5')).toBe(SOURCE_CHAR_BUDGET)
    expect(sourceCharBudget('claude-sonnet-5-5')).toBe(SOURCE_CHAR_BUDGET)
    expect(sourceCharBudget('claude-haiku-4-5')).toBeLessThan(SOURCE_CHAR_BUDGET / 1.5)
  })

  it('cuts a large file harder when the learner picked Haiku', async () => {
    ctx = createTestContext()
    const notebook = await services.createNotebook(ctx, { name: 'Operating Systems', code: '', color: 'teal' })
    const topic = await services.createTopic(ctx, notebook.id, { title: 'Deadlocks' })
    const { source, text } = bigSource(notebook.id, 100)
    insertSource(ctx.db, source, text)
    expect(text.length).toBeGreaterThan(SOURCE_CHAR_BUDGET)

    const opus = selectTopicSources(ctx, topic)
    expect(opus.usedChars).toBeLessThanOrEqual(SOURCE_CHAR_BUDGET)

    await services.updateSettings(ctx, { model: 'claude-haiku-4-5' })
    const haiku = selectTopicSources(ctx, topic)
    expect(haiku.usedChars).toBeLessThanOrEqual(sourceCharBudget('claude-haiku-4-5'))
    expect(haiku.usedChars).toBeLessThan(opus.usedChars)
    expect(haiku.labels[0]).toMatch(/^Big Textbook\.pdf, pages /)
  })
})

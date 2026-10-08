import { afterEach, describe, expect, it } from 'vitest'
import type { Source } from '@shared/types'
import { createTestContext, type TestContext } from '../../../tests/unit/helpers/context'
import { FakeAi } from '../../../tests/unit/helpers/fakeAi'
import { insertSource } from '../db/repositories/sources'
import { OLLAMA_CONTEXT_SIZES } from '@shared/types'
import { ollamaSourceCharBudget, ollamaSourceChars } from '../ai/ollama'
import { services } from './index'
import { SOURCE_CHAR_BUDGET } from './sourceBudget'
import { budgetFor, selectQuizSources, selectTopicSources, selectWholeFile, singleSourceBudget, sourceCharBudget } from './topicSources'

let ctx: TestContext | null = null

afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

function bigSource(
  notebookId: string,
  pages: number,
  overrides: Partial<Source> = {},
  sentence = 'Deadlocks need four conditions to hold at once. '
): { source: Source; text: string } {
  const text = Array.from({ length: pages }, (_, i) => `[Page ${i + 1}]\n${sentence.repeat(200)}`).join('\n\n')
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
    addedAt: '2026-10-01T10:00:00.000Z',
    ...overrides
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

describe('budget by provider', () => {
  it('uses the context window for Ollama and the model for Claude', async () => {
    ctx = createTestContext()
    expect(budgetFor(ctx)).toBe(SOURCE_CHAR_BUDGET)
    expect(singleSourceBudget(ctx)).toBe(SOURCE_CHAR_BUDGET)
    await services.updateSettings(ctx, { model: 'claude-haiku-4-5' })
    expect(budgetFor(ctx)).toBe(sourceCharBudget('claude-haiku-4-5'))
    // Reading one whole file keeps the full budget on Claude, as before.
    expect(singleSourceBudget(ctx)).toBe(SOURCE_CHAR_BUDGET)

    await services.updateSettings(ctx, { aiProvider: 'ollama' })
    for (const size of OLLAMA_CONTEXT_SIZES) {
      await services.updateSettings(ctx, { ollamaContextTokens: size })
      expect(budgetFor(ctx)).toBe(ollamaSourceCharBudget(size))
      expect(singleSourceBudget(ctx)).toBe(ollamaSourceCharBudget(size))
    }
  })

  it('cuts files to fit a local model, and keeps style examples to a quarter of its budget', async () => {
    ctx = createTestContext()
    const notebook = await services.createNotebook(ctx, { name: 'Operating Systems', code: '', color: 'teal' })
    const topic = await services.createTopic(ctx, notebook.id, { title: 'Deadlocks' })
    const lecture = bigSource(notebook.id, 40)
    insertSource(ctx.db, lecture.source, lecture.text)
    const exam = bigSource(notebook.id, 10, { id: 'src-exam', fileName: 'Old exam.pdf', kind: 'exam' })
    insertSource(ctx.db, exam.source, exam.text)
    await services.updateSettings(ctx, { aiProvider: 'ollama', ollamaContextTokens: 16384 })
    const budget = ollamaSourceCharBudget(16384)

    const lesson = selectTopicSources(ctx, topic)
    expect(lesson.usedChars).toBeLessThanOrEqual(budget)
    expect(lesson.usedChars).toBeGreaterThan(budget / 2)
    expect(lesson.labels[0]).toMatch(/^Big Textbook\.pdf, pages? /)

    const quiz = selectQuizSources(ctx, notebook.id, [topic], true)
    expect(quiz.usedChars).toBeLessThanOrEqual(budget)
    const examIndex = quiz.labels.findIndex((l) => l.startsWith('Old exam.pdf'))
    expect(examIndex).toBeGreaterThanOrEqual(0)
    expect(quiz.docs[examIndex].text.length).toBeLessThanOrEqual(budget / 4)
  })
})

describe('fitting the files to the provider', () => {
  it("keeps Claude's past-exam share at 90,000 characters whatever the model", async () => {
    ctx = createTestContext()
    const notebook = await services.createNotebook(ctx, { name: 'Operating Systems', code: '', color: 'teal' })
    const topic = await services.createTopic(ctx, notebook.id, { title: 'Deadlocks' })
    const lecture = bigSource(notebook.id, 5)
    insertSource(ctx.db, lecture.source, lecture.text)
    const exam = bigSource(notebook.id, 12, { id: 'src-exam', fileName: 'Old exam.pdf', kind: 'exam' })
    insertSource(ctx.db, exam.source, exam.text)
    for (const model of ['claude-opus-5-5', 'claude-haiku-4-5'] as const) {
      await services.updateSettings(ctx, { model })
      const quiz = selectQuizSources(ctx, notebook.id, [topic], true)
      const examDoc = quiz.docs[quiz.labels.findIndex((l) => l.startsWith('Old exam.pdf'))]
      expect(examDoc.text.length).toBeLessThanOrEqual(90_000)
      expect(examDoc.text.length).toBeGreaterThan(80_000)
    }
  })

  it('reads less of a file in another script on a local model, so it still fits the context window', async () => {
    ctx = createTestContext()
    const notebook = await services.createNotebook(ctx, { name: 'Operating Systems', code: '', color: 'teal' })
    const topic = await services.createTopic(ctx, notebook.id, { title: 'Deadlocks' })
    const { source, text } = bigSource(notebook.id, 40, {}, '死锁需要四个条件同时成立。')
    insertSource(ctx.db, source, text)
    const candidate = { id: source.id, fileName: source.fileName, kind: source.kind, text }

    // Claude counts characters, as before: the whole file fits.
    expect(selectTopicSources(ctx, topic).docs[0].text).toBe(text)

    await services.updateSettings(ctx, { aiProvider: 'ollama', ollamaContextTokens: 16384 })
    const budget = ollamaSourceCharBudget(16384)
    for (const selection of [selectTopicSources(ctx, topic), selectWholeFile(ctx, candidate)]) {
      const size = selection.docs.reduce((sum, doc) => sum + ollamaSourceChars(doc.text), 0)
      expect(size).toBeLessThanOrEqual(budget)
      expect(size).toBeGreaterThan(budget / 2)
      expect(selection.labels[0]).toMatch(/^Big Textbook\.pdf, pages? /)
    }
  })
})

describe('whole-file calls on a local model', () => {
  it('cuts the syllabus and a summarized file to the context window', async () => {
    const ai = new FakeAi()
    ctx = createTestContext({ ai })
    const notebook = await services.createNotebook(ctx, { name: 'Operating Systems', code: '', color: 'teal' })
    const { source, text } = bigSource(notebook.id, 30, { kind: 'syllabus', fileName: 'Syllabus.pdf' })
    insertSource(ctx.db, source, text)
    await services.updateSettings(ctx, { aiProvider: 'ollama', ollamaContextTokens: 32768 })

    await services.extractTopicsFromSyllabus(ctx, notebook.id, source.id)
    await services.summarizeSource(ctx, source.id)
    const sent = [ai.callsTo('extractSyllabus')[0].sources[0], ai.callsTo('summarizeSource')[0].sources[0]]
    for (const doc of sent) {
      expect(doc.text.length).toBeLessThanOrEqual(ollamaSourceCharBudget(32768))
      expect(doc.text.startsWith('[Page 1]')).toBe(true)
    }
  })
})

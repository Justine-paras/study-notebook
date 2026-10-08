// Services are called straight from IPC with whatever the renderer sends.
// Junk arguments must come back as AppErrors (INVALID_INPUT, NOT_FOUND...),
// never as SQLite binding errors or TypeErrors, which the renderer can only
// show as "Something went wrong".

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STUDY_API_METHODS, type StudyApiMethod } from '@shared/api'
import { AppError } from '@shared/errors'
import { services } from '../../src/main/services'
import { createTestContext, type TestContext } from './helpers/context'

const JUNK: unknown[] = [
  undefined, null, 0, -1, 1.5, Number.NaN, '', 'x', {}, [], [1], { a: 1 }, true, { topicId: {} }, { topicIds: [{}] }, { kind: {} }, { title: {}, body: {} }
]
// Desktop-only actions (dialogs, opening files) and the API check have nothing to validate.
const SKIP = new Set<StudyApiMethod>(['pickFiles', 'openSource', 'openDataFolder', 'exportBackup', 'testApiKey'])

let ctx: TestContext
beforeEach(() => {
  ctx = createTestContext({ now: new Date(2026, 9, 4, 10) })
})
afterEach(() => ctx.cleanup())

async function unexpectedErrors(call: () => Promise<unknown>, label: string, into: string[]): Promise<void> {
  try {
    await call()
  } catch (err) {
    if (!(err instanceof AppError)) into.push(`${label}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

describe('service input from IPC', () => {
  it('turns junk arguments into AppErrors for every method', async () => {
    const notebook = await services.createNotebook(ctx, { name: 'OS', code: '', color: 'teal' })
    const topic = await services.createTopic(ctx, notebook.id, { title: 'Deadlocks', description: 'Waiting forever' })
    const card = await services.createCard(ctx, { notebookId: notebook.id, topicId: topic.id, front: 'Q', back: 'A' })
    const ids = [notebook.id, topic.id, card.id]
    const problems: string[] = []
    // Deletes run last so the other methods see real ids alongside the junk.
    const methods = [...STUDY_API_METHODS.filter((m) => !m.startsWith('delete')), ...STUDY_API_METHODS.filter((m) => m.startsWith('delete'))]
    for (const method of methods) {
      if (SKIP.has(method)) continue
      const fn = services[method] as (c: TestContext, ...args: unknown[]) => Promise<unknown>
      for (const first of [...JUNK, ...ids]) {
        for (const second of [...JUNK, ...ids]) {
          await unexpectedErrors(() => fn(ctx, first, second), `${method}(${JSON.stringify(first)}, ${JSON.stringify(second)})`, problems)
        }
      }
    }
    expect(problems).toEqual([])
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { IPC_PREFIX, STUDY_API_METHODS, type ApiResult, type ImportResult } from '@shared/api'
import type { Notebook } from '@shared/types'
import { createTestContext, type TestContext } from '../../tests/unit/helpers/context'
import { PATH_GRANT_CHANNEL } from '../preload/channels'
import { FileGrants } from './files/access'
import { NOT_CHOSEN_REASON, registerIpc, type IpcOptions } from './ipc'

type Handler = (event: unknown, args: unknown) => Promise<ApiResult<unknown>>
type Listener = (event: { senderFrame: unknown; returnValue?: unknown }, ...args: unknown[]) => void

const electron = vi.hoisted(() => ({
  handlers: new Map<string, unknown>(),
  listeners: new Map<string, unknown>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: unknown) => electron.handlers.set(channel, handler),
    on: (channel: string, listener: unknown) => electron.listeners.set(channel, listener)
  }
}))

const APP_FRAME = { url: 'file:///app/out/renderer/index.html#/notebooks', parent: null }
const app = { senderFrame: APP_FRAME }

let ctx: TestContext

function setup(options?: IpcOptions): void {
  electron.handlers.clear()
  electron.listeners.clear()
  registerIpc(ctx, options)
}

function call<T>(method: string, args: unknown, event: unknown = app): Promise<ApiResult<T>> {
  const handler = electron.handlers.get(IPC_PREFIX + method) as Handler | undefined
  if (!handler) throw new Error(`no handler for ${method}`)
  return handler(event, args) as Promise<ApiResult<T>>
}

function data<T>(result: ApiResult<unknown>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.data as T
}

function grantViaPreload(path: unknown, senderFrame: unknown = APP_FRAME): { returnValue?: unknown } {
  const listener = electron.listeners.get(PATH_GRANT_CHANNEL) as Listener
  const event: { senderFrame: unknown; returnValue?: unknown } = { senderFrame }
  listener(event, path)
  return event
}

beforeEach(() => {
  ctx = createTestContext()
})
afterEach(() => ctx.cleanup())

describe('registerIpc', () => {
  it('registers exactly the StudyApi methods, nothing from the prototype', () => {
    setup()
    expect([...electron.handlers.keys()].sort()).toEqual(STUDY_API_METHODS.map((m) => IPC_PREFIX + m).sort())
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(electron.handlers.has(IPC_PREFIX + name)).toBe(false)
    }
  })

  it('wraps results and expected errors in envelopes', async () => {
    setup()
    const notebook = data<Notebook>(await call('createNotebook', [{ name: 'Operating Systems', code: 'CS 140', color: 'blue' }]))
    expect(notebook.name).toBe('Operating Systems')
    expect(await call('getNotebook', ['missing'])).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'Notebook was not found.' } })
  })

  it('treats a missing or malformed argument list as no arguments', async () => {
    setup()
    for (const args of [undefined, null, 'x', { 0: 'a' }]) expect(data<unknown[]>(await call('listNotebooks', args))).toEqual([])
  })

  it('refuses calls from frames that are not the app page', async () => {
    setup()
    for (const senderFrame of [null, { url: 'https://evil.example/', parent: null }, { url: APP_FRAME.url, parent: APP_FRAME }]) {
      const result = await call('listNotebooks', [], { senderFrame })
      expect(result.ok).toBe(false)
    }
    const destroyed = {
      get senderFrame(): never {
        throw new Error('Render frame was disposed')
      }
    }
    expect((await call('listNotebooks', [], destroyed)).ok).toBe(false)
  })

  it('trusts the dev server page only when one is configured', async () => {
    setup({ enforceFileGrants: false, devServerUrl: 'http://localhost:5173' })
    expect((await call('listNotebooks', [], { senderFrame: { url: 'http://localhost:5173/#/', parent: null } })).ok).toBe(true)
    setup()
    expect((await call('listNotebooks', [], { senderFrame: { url: 'http://localhost:5173/#/', parent: null } })).ok).toBe(false)
  })
})

describe('file grants', () => {
  let notebookId: string
  let lecture: string

  beforeEach(async () => {
    lecture = join(ctx.tempDir, 'Lecture 3 – Scheduling.md')
    writeFileSync(lecture, '# Scheduling\n\nRound robin gives every process a time slice in turn.')
    setup({ enforceFileGrants: true })
    notebookId = data<Notebook>(await call('createNotebook', [{ name: 'OS', code: '', color: 'teal' }])).id
  })

  it('refuses to import a path the learner never chose', async () => {
    const result = data<ImportResult>(await call('importSources', [notebookId, [{ path: lecture }, { path: '\\\\attacker\\share\\x.pdf' }]]))
    expect(result.sources).toEqual([])
    expect(result.failed).toEqual([
      { path: lecture, reason: NOT_CHOSEN_REASON },
      { path: '\\\\attacker\\share\\x.pdf', reason: NOT_CHOSEN_REASON }
    ])
    expect(data<unknown[]>(await call('listSources', [notebookId]))).toEqual([])
  })

  it('imports files returned by the file picker', async () => {
    ctx.desktop.pickedFiles = [lecture]
    expect(data<string[]>(await call('pickFiles', []))).toEqual([lecture])
    const result = data<ImportResult>(await call('importSources', [notebookId, [{ path: lecture }]]))
    expect(result.failed).toEqual([])
    expect(result.sources.map((s) => s.fileName)).toEqual(['Lecture 3 – Scheduling.md'])
  })

  it('imports files dropped on the window (granted by the preload)', async () => {
    expect(grantViaPreload(lecture).returnValue).toBeNull()
    const result = data<ImportResult>(await call('importSources', [notebookId, [{ path: lecture }]]))
    expect(result.sources).toHaveLength(1)
  })

  it('ignores grants from untrusted frames but still answers them', async () => {
    const event = grantViaPreload(lecture, { url: 'https://evil.example/', parent: null })
    expect(event).toHaveProperty('returnValue', null)
    const result = data<ImportResult>(await call('importSources', [notebookId, [{ path: lecture }]]))
    expect(result.failed[0]?.reason).toBe(NOT_CHOSEN_REASON)
  })

  it('reports chosen and refused files together, and keeps the usual checks', async () => {
    grantViaPreload(lecture)
    const result = data<ImportResult>(await call('importSources', [notebookId, [{ path: lecture }, { path: '/etc/hosts.txt' }, { path: '' }]]))
    expect(result.sources).toHaveLength(1)
    expect(result.failed[0]).toEqual({ path: '/etc/hosts.txt', reason: NOT_CHOSEN_REASON })
    // An empty path is left to importSources to explain.
    expect(result.failed[1]?.path).toBe('')
    expect(result.failed[1]?.reason).not.toBe(NOT_CHOSEN_REASON)
    expect(await call('importSources', ['missing', [{ path: lecture }]])).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(await call('importSources', [notebookId, 'nope'])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
  })

  it('does not restrict imports when enforcement is off (development, e2e)', async () => {
    setup({ enforceFileGrants: false, grants: new FileGrants() })
    const result = data<ImportResult>(await call('importSources', [notebookId, [{ path: lecture }]]))
    expect(result.sources).toHaveLength(1)
  })
})

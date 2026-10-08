// End-to-end run of the Ollama provider: launches the built app without the
// demo AI and without an Anthropic key, connects it in Settings to a fake
// Ollama server (tests/e2e/fakeOllama.ts), summarizes a file with it and
// checks what the app sent. Then Ollama "goes away" and Settings says so.
//
// Run: npx electron-vite build && xvfb-run -a npx playwright test tests/e2e/ollama.spec.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { StudyBridge } from '../../src/shared/api'
import { FAKE_SUMMARY_MARK, closedPort, startFakeOllama, type FakeOllama } from './fakeOllama'

// The renderer's globals, for code passed to page.evaluate (this file compiles without the DOM lib).
declare const window: { studyBridge: StudyBridge }
declare const document: { fonts: { ready: Promise<unknown> } }

const ROOT = resolve(__dirname, '../..')
const MAIN = join(ROOT, 'out/main/index.js')
const SHOTS = join(ROOT, 'test-results/screens')

const MODEL = 'llama3.2:3b'
const CONTEXT = 32768
const FILE = 'Lecture 4 - Stacks and queues.md'

test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
let ollama: FakeOllama
let dataDir: string
let fixturesDir: string
const problems: string[] = []

async function shot(name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(SHOTS, `ollama-${name}.png`) })
}

async function invoke<T>(method: string, args: unknown[]): Promise<T> {
  const result = await page.evaluate(([m, a]) => window.studyBridge.invoke(m as never, a as unknown[]), [method, args] as const)
  if (!result.ok) throw new Error(`${method} failed: ${result.error.code} ${result.error.message}`)
  return result.data as T
}

async function dismissToasts(): Promise<void> {
  const closers = page.locator('.toast').getByRole('button', { name: /dismiss|close/i })
  for (let i = (await closers.count()) - 1; i >= 0; i -= 1) await closers.nth(i).click().catch(() => undefined)
}

/** Types an address into the Ollama address field and saves it with Enter. */
async function setAddress(url: string): Promise<void> {
  const address = page.getByLabel('Ollama address')
  await address.fill(url)
  await address.press('Enter')
  await expect(page.getByText('Ollama address saved').last()).toBeVisible()
  await expect(address).toHaveValue(url)
}

test.beforeAll(async () => {
  ollama = await startFakeOllama()
  dataDir = mkdtempSync(join(tmpdir(), 'study-e2e-ollama-data-'))
  fixturesDir = mkdtempSync(join(tmpdir(), 'study-e2e-ollama-files-'))
  mkdirSync(SHOTS, { recursive: true })
  writeFileSync(
    join(fixturesDir, FILE),
    '# Lecture 4: Stacks and queues\n\nA stack is last in, first out. A queue is first in, first out.\n'
  )

  // No demo AI and no Anthropic key: every AI call must go to Ollama.
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value
  for (const name of ['STUDY_DEMO_AI', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']) delete env[name]
  const noProxy = ['127.0.0.1', 'localhost', env.NO_PROXY ?? env.no_proxy].filter(Boolean).join(',')
  app = await electron.launch({
    args: [MAIN],
    env: { ...env, STUDY_ALLOW_MULTIPLE: '1', STUDY_DATA_DIR: dataDir, NO_PROXY: noProxy, no_proxy: noProxy }
  })
  app.process().stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    if (text.includes('[ipc]')) problems.push(`main: ${text.trim()}`)
  })
  page = await app.firstWindow()
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1440, 900)
  })
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
})

test.afterEach(() => {
  const found = problems.splice(0)
  expect(found, found.join('\n')).toEqual([])
})

test.afterAll(async () => {
  await app?.close()
  await ollama?.close()
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(fixturesDir, { recursive: true, force: true })
})

test('connects to Ollama in Settings', async () => {
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()

  // Claude is the default, with the API key form.
  const provider = page.getByRole('radiogroup', { name: 'AI provider' })
  await expect(provider.getByRole('radio', { name: 'Claude' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByLabel('API key')).toBeVisible()

  await provider.getByRole('radio', { name: 'Ollama' }).click()
  await expect(page.getByText('AI provider saved')).toBeVisible()
  await expect(page.getByLabel('API key')).toBeHidden()
  const address = page.getByLabel('Ollama address')
  await expect(address).toHaveValue('http://127.0.0.1:11434')

  await setAddress(ollama.url)
  const model = page.getByLabel('Model', { exact: true })
  await expect(model).toBeEnabled()
  await expect(model.locator('option', { hasText: 'qwen3:8b · 8.2B · Q4_K_M · 5.2 GB' })).toHaveCount(1)
  await expect(model.locator('option', { hasText: 'llama3.2:3b · 3.2B · Q4_K_M · 2.0 GB' })).toHaveCount(1)
  await expect(page.getByText('Ollama is running. Choose a model.')).toBeVisible()

  await model.selectOption(MODEL)
  await expect(page.getByText('Ollama model saved')).toBeVisible()
  await page.getByLabel('Context size').selectOption(String(CONTEXT))
  await expect(page.getByText('Context size saved')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /^Ollama is running$/ })).toBeVisible()

  await page.getByRole('button', { name: 'Test connection' }).click()
  await expect(page.locator('.callout--good', { hasText: 'Connected' })).toBeVisible()

  const settings = await invoke<{ aiProvider: string; ollamaUrl: string; ollamaModel: string | null; ollamaContextTokens: number }>(
    'getSettings',
    []
  )
  expect(settings).toMatchObject({ aiProvider: 'ollama', ollamaUrl: ollama.url, ollamaModel: MODEL, ollamaContextTokens: CONTEXT })
  expect(ollama.requests.some((r) => r.method === 'GET' && r.path === '/api/tags')).toBe(true)

  await dismissToasts()
  await page.locator('.callout--good', { hasText: 'Connected' }).scrollIntoViewIfNeeded()
  await shot('settings')
})

test('summarizes a file with the chosen Ollama model', async () => {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Notebooks' }).click()
  await page.getByRole('button', { name: 'Create your first notebook' }).click()
  const dialog = page.getByRole('dialog', { name: 'New notebook' })
  await dialog.getByLabel('Name').fill('Data Structures')
  await dialog.getByRole('button', { name: 'Create notebook' }).click()
  await expect(page).toHaveURL(/#\/notebooks\/[\w-]+$/)
  const notebookId = page.url().split('/notebooks/')[1]!

  // Native file dialogs can't be driven here, so the file goes in through the API.
  const imported = await invoke<{ sources: { status: string }[]; failed: unknown[] }>('importSources', [
    notebookId,
    [{ path: join(fixturesDir, FILE) }]
  ])
  expect(imported.failed).toEqual([])
  expect(imported.sources.map((s) => s.status)).toEqual(['ready'])
  await page.reload()

  const chatsBefore = ollama.chats().length
  await page.getByRole('button', { name: `Summarize ${FILE}` }).click()
  const read = page.getByRole('button', { name: `Read the summary of ${FILE}` })
  const failed = page.locator('.error-notice')
  await expect(read.or(failed)).toBeVisible({ timeout: 60_000 })
  if (await failed.isVisible()) {
    await failed.getByRole('button', { name: 'Details' }).click()
    throw new Error(`Summarizing failed: ${await failed.innerText()}`)
  }
  await read.click()
  const summary = page.getByRole('dialog', { name: 'Summary' })
  await expect(summary.getByText(FAKE_SUMMARY_MARK)).toBeVisible()
  await summary.getByRole('button', { name: 'Close' }).last().click()

  const chats = ollama.chats().slice(chatsBefore)
  expect(chats.length).toBeGreaterThanOrEqual(1)
  const request = chats.at(-1)!
  expect(request.model).toBe(MODEL)
  expect((request.options as { num_ctx?: unknown } | undefined)?.num_ctx).toBe(CONTEXT)
  expect(typeof request.format).toBe('object')
  expect(request.format).not.toBeNull()
  expect(request.stream).toBe(true)
  const messages = request.messages as { role: string; content: string }[]
  expect(messages.map((m) => m.content).join('\n')).toContain('A stack is last in, first out.')
})

test('explains when Ollama can no longer be reached', async () => {
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'AI provider' }).getByRole('radio', { name: 'Ollama' })).toHaveAttribute(
    'aria-checked',
    'true'
  )

  await setAddress(`http://127.0.0.1:${await closedPort()}`)
  await expect(page.getByRole('status').filter({ hasText: "Can't reach Ollama" })).toBeVisible()
  await expect(page.getByText('How to get Ollama running')).toBeVisible()
  await expect(page.getByText('ollama pull qwen3:8b')).toBeVisible()
  // The saved model stays chosen; nothing can be said about it while Ollama is away.
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue(MODEL)

  await page.getByRole('button', { name: 'Test connection' }).click()
  const result = page.locator('.callout--bad', { hasText: "Couldn't connect" })
  await expect(result).toBeVisible()
  await expect(result).toContainText(/Ollama/)
  await expect(result).toContainText(/reach|running|start/i)

  // A bad address is explained under the field and not saved.
  const address = page.getByLabel('Ollama address')
  await address.fill('ftp://127.0.0.1:11434')
  await address.press('Enter')
  await expect(page.locator('.field__error', { hasText: /http/ })).toBeVisible()
  await page.getByRole('button', { name: 'Use the usual address' }).click()
  await expect(address).toHaveValue('http://127.0.0.1:11434')
  await expect(page.locator('.field__error')).toHaveCount(0)

  await setAddress(`http://127.0.0.1:${await closedPort()}`)
  await page.getByRole('button', { name: 'Test connection' }).click()
  await expect(result).toBeVisible()
  await dismissToasts()
  await result.scrollIntoViewIfNeeded()
  await shot('settings-unreachable')
})

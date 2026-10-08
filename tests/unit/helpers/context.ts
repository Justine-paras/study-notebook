// Builds an AppContext for service tests: in-memory database, a temp library
// folder, a recording fake DesktopAdapter, a controllable clock and the
// offline demo AI (unless a custom one is passed).

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AiProgressEvent, ThemePref } from '@shared/types'
import { StudyAi } from '../../../src/main/ai'
import type { AppContext, DesktopAdapter } from '../../../src/main/context'
import { openDatabase } from '../../../src/main/db/database'

export interface FakeDesktop extends DesktopAdapter {
  opened: string[]
  notifications: { title: string; body: string }[]
  themes: ThemePref[]
  /** What saveDialog resolves to (null = cancelled). */
  savePath: string | null
  pickedFiles: string[]
}

export function createFakeDesktop(): FakeDesktop {
  const desktop: FakeDesktop = {
    opened: [],
    notifications: [],
    themes: [],
    savePath: null,
    pickedFiles: [],
    async pickFiles() {
      return desktop.pickedFiles
    },
    async openPath(path) {
      desktop.opened.push(path)
    },
    showItemInFolder(path) {
      desktop.opened.push(path)
    },
    notify(title, body) {
      desktop.notifications.push({ title, body })
    },
    async saveDialog() {
      return desktop.savePath
    },
    // Reversible but not plain text, so tests can tell the stored value is not the raw key.
    encrypt(plain) {
      return 'test:' + Buffer.from(plain, 'utf8').toString('base64')
    },
    decrypt(cipher) {
      if (!cipher.startsWith('test:')) throw new Error('cannot decrypt')
      return Buffer.from(cipher.slice(5), 'base64').toString('utf8')
    },
    setTheme(theme) {
      desktop.themes.push(theme)
    }
  }
  return desktop
}

export interface TestContext extends AppContext {
  desktop: FakeDesktop
  progressEvents: AiProgressEvent[]
  /** Moves the clock. */
  setNow(date: Date): void
  /** Temp folder holding the library (and anything else a test writes). */
  tempDir: string
  cleanup(): void
}

export function createTestContext(options: { now?: Date; ai?: StudyAi; demoAi?: boolean } = {}): TestContext {
  const tempDir = mkdtempSync(join(tmpdir(), 'study-notebook-test-'))
  const libraryDir = join(tempDir, 'library')
  const db = openDatabase(':memory:')
  let now = options.now ?? new Date()
  const progressEvents: AiProgressEvent[] = []
  const ctx: TestContext = {
    db,
    ai: options.ai ?? new StudyAi(() => ({ provider: 'claude', apiKey: null, model: 'claude-opus-5-5', demo: true })),
    paths: { dataDir: tempDir, libraryDir, dbPath: ':memory:' },
    desktop: createFakeDesktop(),
    emitAiProgress: (event) => progressEvents.push(event),
    now: () => new Date(now.getTime()),
    demoAi: options.demoAi ?? true,
    progressEvents,
    setNow(date) {
      now = date
    },
    tempDir,
    cleanup() {
      try {
        db.close()
      } catch {
        // already closed
      }
      rmSync(tempDir, { recursive: true, force: true })
    }
  }
  return ctx
}

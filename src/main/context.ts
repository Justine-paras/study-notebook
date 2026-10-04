// Everything a service needs, passed explicitly so services can run in unit
// tests without Electron (tests build a context with an in-memory database,
// a temp library folder, demo AI and a fake DesktopAdapter).

import type { DatabaseSync } from 'node:sqlite'
import type { AiProgressEvent, ThemePref } from '@shared/types'
import type { StudyAi } from './ai'

/** Electron-only capabilities, injected so services stay testable. */
export interface DesktopAdapter {
  pickFiles(): Promise<string[]>
  openPath(path: string): Promise<void>
  showItemInFolder(path: string): void
  notify(title: string, body: string): void
  /** Save dialog; resolves the chosen path or null when cancelled. */
  saveDialog(defaultName: string): Promise<string | null>
  /** OS-keychain-backed encryption (Electron safeStorage). Falls back to plain base64 when unavailable. */
  encrypt(plain: string): string
  decrypt(cipher: string): string
  /** Applies the theme to native window chrome (Electron nativeTheme.themeSource). */
  setTheme(theme: ThemePref): void
}

export interface AppPaths {
  /** Root data folder (Electron userData/StudyNotebook). */
  dataDir: string
  /** Where imported files are copied. */
  libraryDir: string
  /** SQLite database file (":memory:" in tests). */
  dbPath: string
}

export interface AppContext {
  db: DatabaseSync
  ai: StudyAi
  paths: AppPaths
  desktop: DesktopAdapter
  /** Broadcasts AI progress to the renderer. */
  emitAiProgress: (event: AiProgressEvent) => void
  /** Current time; overridable in tests. */
  now: () => Date
  /** True when STUDY_DEMO_AI=1: AI calls return offline demo content. */
  demoAi: boolean
}

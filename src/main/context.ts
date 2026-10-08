// Everything a service needs, passed explicitly so services can run in unit
// tests without Electron (tests build a context with an in-memory database,
// a temp library folder, demo AI and a fake DesktopAdapter).

import type { DatabaseSync } from 'node:sqlite'
import type { AiProgressEvent, ThemePref } from '@shared/types'
import type { StudyAi } from './ai'

/** Electron-only capabilities, injected so services stay testable. */
export interface DesktopAdapter {
  pickFiles(): Promise<string[]>
  /** Opens a file or folder with its default app. Only paths inside the data folder are allowed. */
  openPath(path: string): Promise<void>
  /** Only paths inside the data folder are allowed. */
  showItemInFolder(path: string): void
  notify(title: string, body: string): void
  /** Save dialog; resolves the chosen path or null when cancelled. */
  saveDialog(defaultName: string): Promise<string | null>
  /** OS-backed encryption (Electron safeStorage: DPAPI on Windows). Falls back to plain base64 when unavailable. */
  encrypt(plain: string): string
  decrypt(cipher: string): string
  /** Applies the theme to native window chrome (Electron nativeTheme.themeSource). */
  setTheme(theme: ThemePref): void
}

export interface AppPaths {
  /** Root data folder: Electron's userData (%APPDATA%\Study Notebook on Windows), its "demo" subfolder in demo mode, or STUDY_DATA_DIR. */
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
  /** True with STUDY_DEMO_AI=1 or the --demo switch: AI calls return offline demo content. */
  demoAi: boolean
}

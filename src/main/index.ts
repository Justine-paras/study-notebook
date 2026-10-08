import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { app, BrowserWindow, dialog, Menu, nativeTheme, Notification, safeStorage, screen, session, shell, type WebContents } from 'electron'
import { AI_PROGRESS_CHANNEL } from '@shared/api'
import { AppError } from '@shared/errors'
import { StudyAi } from './ai'
import type { AppContext, AppPaths, DesktopAdapter } from './context'
import { openDatabase } from './db/database'
import { requireOwnPath } from './files/access'
import { registerIpc } from './ipc'
import { isAllowedPermission, isExternalWebUrl, isSamePage } from './security'
import { getAiConfig, getThemePreference } from './services/settings'
import { appMenuTemplate, parseWindowState, placeWindow, type WindowState } from './window'

/** Must match appId in electron-builder.yml: Windows ties notifications to the Start menu shortcut with this id. */
const APP_ID = 'com.justineparas.studynotebook'
const isDev = !app.isPackaged
// The Vite dev server (electron-vite dev). Never consulted in the installed app.
const devServerUrl = isDev ? process.env.ELECTRON_RENDERER_URL : undefined
// `--demo` works from any shell; PowerShell and cmd can't run `STUDY_DEMO_AI=1 npm run dev`.
const demoAi = process.env.STUDY_DEMO_AI === '1' || process.argv.includes('--demo')

app.setName('Study Notebook')
// A custom data folder (e2e tests, portable runs) also holds Chromium's own storage,
// so the renderer's localStorage (Pomodoro, drafts) never leaks between runs.
if (process.env.STUDY_DATA_DIR) app.setPath('userData', join(process.env.STUDY_DATA_DIR, 'chromium'))
// In development there is no Start menu shortcut for APP_ID, so the Electron binary's path stands in.
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath)

let mainWindow: BrowserWindow | null = null

function resolvePaths(): AppPaths {
  const base = process.env.STUDY_DATA_DIR || app.getPath('userData')
  // Demo mode gets its own folder so made-up lessons, quizzes and flashcards
  // never end up in the real study history (an explicit STUDY_DATA_DIR wins).
  const dataDir = demoAi && !process.env.STUDY_DATA_DIR ? join(base, 'demo') : base
  const libraryDir = join(dataDir, 'library')
  mkdirSync(libraryDir, { recursive: true })
  return { dataDir, libraryDir, dbPath: join(dataDir, 'study.db') }
}

function createDesktopAdapter(paths: AppPaths): DesktopAdapter {
  return {
    async pickFiles() {
      const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
        title: 'Add files to this notebook',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Study files', extensions: ['pdf', 'pptx', 'docx', 'txt', 'md'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
      return result.canceled ? [] : result.filePaths
    },
    async openPath(path) {
      // Only the app's own files are ever opened, whatever path a database row supplies.
      requireOwnPath(paths.dataDir, path)
      const error = await shell.openPath(path)
      if (error) throw new AppError('UNKNOWN', `Couldn't open it: ${error}`)
    },
    showItemInFolder(path) {
      requireOwnPath(paths.dataDir, path)
      shell.showItemInFolder(path)
    },
    notify(title, body) {
      if (Notification.isSupported()) new Notification({ title, body }).show()
    },
    async saveDialog(defaultName) {
      const result = await dialog.showSaveDialog(mainWindow ?? undefined!, {
        title: 'Save a backup',
        defaultPath: join(app.getPath('documents'), defaultName)
      })
      return result.canceled || !result.filePath ? null : result.filePath
    },
    encrypt(plain) {
      if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(plain).toString('base64')
      return 'b64:' + Buffer.from(plain, 'utf8').toString('base64')
    },
    decrypt(cipher) {
      if (cipher.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(cipher.slice(4), 'base64'))
      if (cipher.startsWith('b64:')) return Buffer.from(cipher.slice(4), 'base64').toString('utf8')
      return cipher
    },
    setTheme(theme) {
      nativeTheme.themeSource = theme
    }
  }
}

function readWindowState(file: string): WindowState | null {
  try {
    return parseWindowState(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

function saveWindowState(file: string, win: BrowserWindow): void {
  try {
    const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() }
    writeFileSync(file, JSON.stringify(state))
  } catch {
    // Losing the window position is not worth bothering the learner about.
  }
}

/**
 * Applies to every web page the app creates (the window, DevTools): no
 * webviews and no new windows. Web links open in the system browser instead.
 */
function guardWebContents(contents: WebContents): void {
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

/** The app window never navigates away from the app; a clicked web link opens in the browser. */
function guardNavigation(contents: WebContents): void {
  contents.on('will-navigate', (event, url) => {
    if (isSamePage(contents.getURL(), url)) return
    event.preventDefault()
    if (isExternalWebUrl(url)) void shell.openExternal(url)
  })
}

function createWindow(paths: AppPaths): BrowserWindow {
  const stateFile = join(paths.dataDir, 'window-state.json')
  const placement = placeWindow(
    readWindowState(stateFile),
    screen.getAllDisplays().map((display) => display.workArea),
    screen.getPrimaryDisplay().workArea
  )
  const win = new BrowserWindow({
    ...placement.bounds,
    minWidth: placement.minWidth,
    minHeight: placement.minHeight,
    show: false,
    title: 'Study Notebook',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1C1B19' : '#F7F4EC',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: isDev,
      // The Pomodoro clock runs in the page. Throttled timers in a minimized
      // window can notice the end of a phase a minute late, after which the
      // end-of-phase notification is skipped as stale.
      backgroundThrottling: false
    }
  })

  guardNavigation(win.webContents)
  win.once('ready-to-show', () => {
    if (placement.maximized) win.maximize()
    win.show()
  })
  win.on('close', () => saveWindowState(stateFile, win))
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  if (devServerUrl) {
    void win.loadURL(devServerUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

function startupFailed(err: unknown, dataDir: string | null): void {
  console.error('[startup] failed', err)
  const reason = err instanceof Error ? err.message : String(err)
  const where = dataDir ? `\n\nYour study data is in:\n${dataDir}` : ''
  dialog.showErrorBox('Study Notebook could not start', `${reason}${where}`)
  app.exit(1)
}

function start(): void {
  let paths: AppPaths | null = null
  try {
    paths = resolvePaths()
    const db = openDatabase(paths.dbPath)

    // The AI reads its config lazily so key/model changes apply immediately.
    let ctx: AppContext
    const ai = new StudyAi(() => getAiConfig(ctx))
    ctx = {
      db,
      ai,
      paths,
      desktop: createDesktopAdapter(paths),
      emitAiProgress: (event) => {
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send(AI_PROGRESS_CHANNEL, event)
      },
      now: () => new Date(),
      demoAi
    }

    try {
      nativeTheme.themeSource = getThemePreference(ctx)
    } catch {
      nativeTheme.themeSource = 'system'
    }

    // The page needs no browser permission except writing to the clipboard (Copy on code blocks);
    // notifications go through the main process.
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(isAllowedPermission(permission)))
    session.defaultSession.setPermissionCheckHandler((_contents, permission) => isAllowedPermission(permission))
    Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate(isDev)))

    registerIpc(ctx, { enforceFileGrants: app.isPackaged, devServerUrl })

    let dbClosed = false
    const closeDatabase = (): void => {
      if (dbClosed) return
      dbClosed = true
      try {
        // Closing checkpoints the WAL into study.db.
        db.close()
      } catch {
        // already closed
      }
    }
    app.on('will-quit', closeDatabase)

    const openWindow = (): void => {
      const win = createWindow(ctx.paths)
      // Windows shutdown or sign-out can end the process without will-quit.
      win.on('session-end', closeDatabase)
      mainWindow = win
    }
    openWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openWindow()
    })
  } catch (err) {
    startupFailed(err, paths?.dataDir ?? null)
  }
}

app.on('web-contents-created', (_event, contents) => guardWebContents(contents))

const gotLock = process.env.STUDY_ALLOW_MULTIPLE === '1' || app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
  })

  void app.whenReady().then(start)

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

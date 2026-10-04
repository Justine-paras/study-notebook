import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { app, BrowserWindow, dialog, nativeTheme, Notification, safeStorage, shell } from 'electron'
import { AI_PROGRESS_CHANNEL } from '@shared/api'
import { StudyAi } from './ai'
import type { AppContext, AppPaths, DesktopAdapter } from './context'
import { openDatabase } from './db/database'
import { registerIpc } from './ipc'
import { getAiConfig, getThemePreference } from './services/settings'

app.setName('Study Notebook')
// A custom data folder (e2e tests, portable runs) also holds Chromium's own storage,
// so the renderer's localStorage (Pomodoro, drafts) never leaks between runs.
if (process.env.STUDY_DATA_DIR) app.setPath('userData', join(process.env.STUDY_DATA_DIR, 'chromium'))
if (process.platform === 'win32') app.setAppUserModelId('com.justineparas.studynotebook')

let mainWindow: BrowserWindow | null = null

function resolvePaths(): AppPaths {
  const dataDir = process.env.STUDY_DATA_DIR || app.getPath('userData')
  const libraryDir = join(dataDir, 'library')
  mkdirSync(libraryDir, { recursive: true })
  return { dataDir, libraryDir, dbPath: join(dataDir, 'study.db') }
}

function createDesktopAdapter(): DesktopAdapter {
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
      const error = await shell.openPath(path)
      if (error) throw new Error(error)
    },
    showItemInFolder(path) {
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

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Study Notebook',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1C1B19' : '#F7F4EC',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // Links in lessons open in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault()
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

const gotLock = process.env.STUDY_ALLOW_MULTIPLE === '1' || app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    const paths = resolvePaths()
    const db = openDatabase(paths.dbPath)
    const demoAi = process.env.STUDY_DEMO_AI === '1'

    // The AI reads its config lazily so key/model changes apply immediately.
    let ctx: AppContext
    const ai = new StudyAi(() => getAiConfig(ctx))
    ctx = {
      db,
      ai,
      paths,
      desktop: createDesktopAdapter(),
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

    registerIpc(ctx)
    mainWindow = createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })

    app.on('will-quit', () => {
      try {
        db.close()
      } catch {
        // already closed
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

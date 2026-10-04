// The only bridge between the page and the main process: typed API calls,
// AI progress events, the path of a dropped file and the platform name.
// Runs sandboxed with context isolation, so nothing else from Electron or
// Node reaches the page.

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { AI_PROGRESS_CHANNEL, IPC_PREFIX, STUDY_API_METHODS, type ApiResult, type StudyBridge } from '@shared/api'
import type { AiProgressEvent } from '@shared/types'
import { PATH_GRANT_CHANNEL } from './channels'

const METHODS: ReadonlySet<string> = new Set(STUDY_API_METHODS)

const bridge: StudyBridge = {
  invoke: (method, args) => {
    // Unknown names never reach ipcRenderer (and so can't address other channels).
    if (typeof method !== 'string' || !METHODS.has(method)) {
      const result: ApiResult<unknown> = { ok: false, error: { code: 'INVALID_INPUT', message: `Unknown method "${String(method)}".` } }
      return Promise.resolve(result)
    }
    return ipcRenderer.invoke(IPC_PREFIX + method, Array.isArray(args) ? args : [])
  },
  onAiProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AiProgressEvent) => listener(payload)
    ipcRenderer.on(AI_PROGRESS_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(AI_PROGRESS_CHANNEL, handler)
    }
  },
  pathForFile: (file) => {
    const path = webUtils.getPathForFile(file)
    // Synchronous so the main process knows the file before the import call that follows.
    if (path) ipcRenderer.sendSync(PATH_GRANT_CHANNEL, path)
    return path
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('studyBridge', bridge)

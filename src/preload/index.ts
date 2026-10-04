import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { AI_PROGRESS_CHANNEL, IPC_PREFIX, type StudyBridge } from '@shared/api'
import type { AiProgressEvent } from '@shared/types'

const bridge: StudyBridge = {
  invoke: (method, args) => ipcRenderer.invoke(IPC_PREFIX + method, args),
  onAiProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AiProgressEvent) => listener(payload)
    ipcRenderer.on(AI_PROGRESS_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(AI_PROGRESS_CHANNEL, handler)
    }
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  platform: process.platform
}

contextBridge.exposeInMainWorld('studyBridge', bridge)

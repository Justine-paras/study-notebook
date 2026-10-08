import { ipcMain } from 'electron'
import { IPC_PREFIX, STUDY_API_METHODS, type ApiResult, type ImportFileInput, type ImportResult } from '@shared/api'
import { AppError } from '@shared/errors'
import type { ID } from '@shared/types'
import { PATH_GRANT_CHANNEL } from '../preload/channels'
import type { AppContext } from './context'
import { FileGrants } from './files/access'
import { isTrustedSender, type SenderFrame } from './security'
import { services } from './services'

export interface IpcOptions {
  /**
   * Import only files the learner picked in the file dialog or dropped on the
   * window this session. On in the installed app; off in development and e2e
   * runs, which import fixture files straight through the API.
   */
  enforceFileGrants: boolean
  /** The Vite dev server's URL in development, trusted like the bundled page. */
  devServerUrl?: string
  /** Shared with tests; a fresh set by default. */
  grants?: FileGrants
}

export const NOT_CHOSEN_REASON = 'Add files with the Upload button or by dropping them on the window.'

function senderIsTrusted(event: { senderFrame: SenderFrame | null }, devServerUrl: string | undefined): boolean {
  try {
    return isTrustedSender(event.senderFrame, devServerUrl)
  } catch {
    // The frame was destroyed while the message was in flight.
    return false
  }
}

/** importSources restricted to granted paths; the rest are reported as failed, like any other unusable file. */
async function importChosenFiles(ctx: AppContext, grants: FileGrants, args: unknown[]): Promise<ImportResult> {
  const [notebookId, files] = args
  if (!Array.isArray(files)) return services.importSources(ctx, notebookId as ID, files as ImportFileInput[])
  const chosen: ImportFileInput[] = []
  const refused: ImportResult['failed'] = []
  for (const file of files as unknown[]) {
    const path = (file as Partial<ImportFileInput> | null | undefined)?.path
    // Missing paths go through so the service explains them as usual.
    if (typeof path === 'string' && path && !grants.has(path)) refused.push({ path, reason: NOT_CHOSEN_REASON })
    else chosen.push(file as ImportFileInput)
  }
  const result = await services.importSources(ctx, notebookId as ID, chosen)
  return refused.length === 0 ? result : { sources: result.sources, failed: [...refused, ...result.failed] }
}

/**
 * Registers one IPC handler per StudyApi method. Errors are returned, never
 * thrown across the bridge. Only the names in STUDY_API_METHODS get a
 * channel, so the renderer can't reach anything else on `services`
 * ("constructor", "__proto__", ...).
 */
export function registerIpc(ctx: AppContext, options: IpcOptions = { enforceFileGrants: false }): void {
  const grants = options.grants ?? new FileGrants()

  ipcMain.on(PATH_GRANT_CHANNEL, (event, path: unknown) => {
    try {
      if (senderIsTrusted(event, options.devServerUrl)) grants.grant(path)
    } finally {
      // The preload waits for this (sendSync): always answer.
      event.returnValue = null
    }
  })

  for (const method of STUDY_API_METHODS) {
    ipcMain.handle(IPC_PREFIX + method, async (event, args: unknown): Promise<ApiResult<unknown>> => {
      if (!senderIsTrusted(event, options.devServerUrl)) {
        return { ok: false, error: { code: 'UNKNOWN', message: 'This request did not come from the Study Notebook window.' } }
      }
      const list = Array.isArray(args) ? args : []
      try {
        let data: unknown
        if (method === 'importSources' && options.enforceFileGrants) {
          data = await importChosenFiles(ctx, grants, list)
        } else {
          const fn = services[method] as (ctx: AppContext, ...a: unknown[]) => Promise<unknown>
          data = await fn(ctx, ...list)
        }
        // What the file dialog returned is, by definition, chosen by the learner.
        if (method === 'pickFiles' && Array.isArray(data)) for (const path of data) grants.grant(path)
        return { ok: true, data }
      } catch (err) {
        if (err instanceof AppError) {
          return { ok: false, error: { code: err.code, message: err.message } }
        }
        console.error(`[ipc] ${method} failed`, err)
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: { code: 'UNKNOWN', message } }
      }
    })
  }
}

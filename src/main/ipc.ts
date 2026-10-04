import { ipcMain } from 'electron'
import { IPC_PREFIX, STUDY_API_METHODS, type ApiResult } from '@shared/api'
import { AppError } from '@shared/errors'
import type { AppContext } from './context'
import { services } from './services'

/** Registers one IPC handler per StudyApi method. Errors are returned, never thrown across the bridge. */
export function registerIpc(ctx: AppContext): void {
  for (const method of STUDY_API_METHODS) {
    ipcMain.handle(IPC_PREFIX + method, async (_event, args: unknown[]): Promise<ApiResult<unknown>> => {
      try {
        const fn = services[method] as (ctx: AppContext, ...a: unknown[]) => Promise<unknown>
        const data = await fn(ctx, ...(Array.isArray(args) ? args : []))
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

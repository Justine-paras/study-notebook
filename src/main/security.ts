// Small, Electron-free rules for what the window may load, open and talk to,
// kept here so they can be unit tested. index.ts and ipc.ts apply them.

/** The app's own pages: the bundled renderer (file://) or, in development, the Vite dev server. */
export function isAppUrl(url: unknown, devServerUrl?: string): boolean {
  if (typeof url !== 'string') return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  // Only the bundled renderer is ever loaded from disk: navigation away from it is blocked.
  if (parsed.protocol === 'file:') return true
  if (!devServerUrl) return false
  try {
    return parsed.origin === new URL(devServerUrl).origin
  } catch {
    return false
  }
}

/** Links that may be handed to the system browser: plain web pages only (no file:, javascript:, ms-settings: ...). */
export function isExternalWebUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/** The parts of Electron's WebFrameMain an IPC sender check needs. */
export interface SenderFrame {
  url: string
  parent: unknown
}

/**
 * IPC is answered only for the app's own top-level page, so an iframe or a
 * page that somehow got loaded can't reach the database or the file system.
 */
export function isTrustedSender(frame: SenderFrame | null | undefined, devServerUrl?: string): boolean {
  if (!frame) return false
  if (frame.parent) return false
  return isAppUrl(frame.url, devServerUrl)
}

/** Navigation inside the window: only reloads of the same page (hash routes never navigate). */
export function isSamePage(current: string, next: string): boolean {
  const strip = (url: string) => url.split('#')[0]
  return strip(current) === strip(next)
}

/**
 * The one browser permission the page gets: writing text to the clipboard
 * (the Copy button on lesson code blocks uses navigator.clipboard.writeText,
 * which Electron routes through the permission handlers). Reading the
 * clipboard, camera, microphone, location, notifications and the rest are
 * refused: desktop notifications go through the main process.
 */
export function isAllowedPermission(permission: unknown): boolean {
  return permission === 'clipboard-sanitized-write'
}

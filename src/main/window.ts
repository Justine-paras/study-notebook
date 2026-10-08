// Window placement and the application menu, as plain functions so they can
// be unit tested without Electron. index.ts applies them.

import type { MenuItemConstructorOptions } from 'electron'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** What is remembered between runs (window-state.json in the data folder). */
export interface WindowState {
  /** Bounds when not maximized, so un-maximizing restores a sensible size. */
  bounds: Rect
  maximized: boolean
}

export const DEFAULT_SIZE = { width: 1360, height: 900 }
/** The layouts are designed for 960x640 and up (docs/ARCHITECTURE.md). */
export const MIN_SIZE = { width: 960, height: 640 }

/** How much of a saved window must still be on a screen for its bounds to be reused. */
const MIN_VISIBLE = { width: 160, height: 40 }

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Reads a saved state (parsed JSON); null when it is missing or not usable. */
export function parseWindowState(value: unknown): WindowState | null {
  if (typeof value !== 'object' || value === null) return null
  const { bounds, maximized } = value as { bounds?: Partial<Rect>; maximized?: unknown }
  if (typeof bounds !== 'object' || bounds === null) return null
  const { x, y, width, height } = bounds
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) return null
  if (width <= 0 || height <= 0) return null
  return { bounds: { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }, maximized: maximized === true }
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  }
}

/** Shrinks a size to fit a work area, never below the minimum unless the screen itself is smaller. */
function fitSize(width: number, height: number, area: Rect): { width: number; height: number } {
  return {
    width: Math.min(Math.max(width, Math.min(MIN_SIZE.width, area.width)), area.width),
    height: Math.min(Math.max(height, Math.min(MIN_SIZE.height, area.height)), area.height)
  }
}

export interface WindowPlacement {
  bounds: Rect
  maximized: boolean
  /** Minimum size, lowered on screens smaller than 960x640 so the window still fits. */
  minWidth: number
  minHeight: number
}

/**
 * Where the window opens. Saved bounds are reused when the window is still
 * mostly on a connected screen (a monitor may have been unplugged); otherwise
 * the default size, shrunk to fit and centred on the primary screen. The
 * default 1360x900 is taller than the usable area of a 1080p laptop at 150%
 * scaling (about 1280x680), which would otherwise put the title bar off screen.
 */
export function placeWindow(saved: WindowState | null, workAreas: readonly Rect[], primary: Rect): WindowPlacement {
  const minimum = (area: Rect) => ({ minWidth: Math.min(MIN_SIZE.width, area.width), minHeight: Math.min(MIN_SIZE.height, area.height) })

  if (saved) {
    // The screen showing most of the window; it must show a usable piece of it.
    let screen: Rect | null = null
    let best = 0
    for (const area of workAreas) {
      const o = overlap(saved.bounds, area)
      if (o.width < MIN_VISIBLE.width || o.height < MIN_VISIBLE.height) continue
      if (o.width * o.height > best) {
        best = o.width * o.height
        screen = area
      }
    }
    if (screen) {
      const size = fitSize(saved.bounds.width, saved.bounds.height, screen)
      // Pull the window fully onto that screen, which also brings the title bar back.
      const x = Math.min(Math.max(saved.bounds.x, screen.x), screen.x + screen.width - size.width)
      const y = Math.min(Math.max(saved.bounds.y, screen.y), screen.y + screen.height - size.height)
      return { bounds: { x, y, ...size }, maximized: saved.maximized, ...minimum(screen) }
    }
  }

  const size = fitSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height, primary)
  return {
    bounds: {
      x: primary.x + Math.round((primary.width - size.width) / 2),
      y: primary.y + Math.round((primary.height - size.height) / 2),
      ...size
    },
    maximized: saved?.maximized ?? false,
    ...minimum(primary)
  }
}

/**
 * The menu bar (hidden until Alt is pressed on Windows). Reload and the
 * developer tools are only offered in development: in the installed app a
 * stray Ctrl+R would throw away a half-typed explanation or answer.
 */
export function appMenuTemplate(isDev: boolean): MenuItemConstructorOptions[] {
  const devItems: MenuItemConstructorOptions[] = isDev
    ? [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }]
    : []
  return [
    { label: 'File', submenu: [{ role: 'quit' }] },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [...devItems, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }]
    },
    { role: 'windowMenu' }
  ]
}

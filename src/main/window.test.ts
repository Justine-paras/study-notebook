import { describe, expect, it } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { appMenuTemplate, DEFAULT_SIZE, parseWindowState, placeWindow, type Rect } from './window'

const FULL_HD: Rect = { x: 0, y: 0, width: 1920, height: 1040 }
// A 1920x1080 laptop at 150% scaling, minus the taskbar.
const LAPTOP_150: Rect = { x: 0, y: 0, width: 1280, height: 680 }

describe('parseWindowState', () => {
  it('reads saved bounds', () => {
    expect(parseWindowState({ bounds: { x: 10.4, y: 20, width: 1200, height: 800 }, maximized: true })).toEqual({
      bounds: { x: 10, y: 20, width: 1200, height: 800 },
      maximized: true
    })
  })

  it.each([null, 'x', {}, { bounds: null }, { bounds: { x: 0, y: 0, width: 0, height: 10 } }, { bounds: { x: 0, y: '1', width: 9, height: 9 } }, { bounds: { x: NaN, y: 0, width: 9, height: 9 } }])(
    'rejects %j',
    (value) => {
      expect(parseWindowState(value)).toBeNull()
    }
  )
})

describe('placeWindow', () => {
  it('opens at the default size, centred, on a big screen', () => {
    expect(placeWindow(null, [FULL_HD], FULL_HD)).toEqual({
      bounds: { x: 280, y: 70, ...DEFAULT_SIZE },
      maximized: false,
      minWidth: 960,
      minHeight: 640
    })
  })

  it('shrinks the default size to fit a scaled laptop screen so the title bar stays visible', () => {
    const placement = placeWindow(null, [LAPTOP_150], LAPTOP_150)
    expect(placement.bounds).toEqual({ x: 0, y: 0, width: 1280, height: 680 })
    expect(placement.bounds.y).toBeGreaterThanOrEqual(0)
  })

  it('lowers the minimum size on screens smaller than 960x640', () => {
    const tiny: Rect = { x: 0, y: 0, width: 1097, height: 588 }
    const placement = placeWindow(null, [tiny], tiny)
    expect(placement.bounds.height).toBe(588)
    expect(placement.minHeight).toBe(588)
    expect(placement.minWidth).toBe(960)
  })

  it('restores saved bounds and the maximized flag', () => {
    const saved = { bounds: { x: 100, y: 50, width: 1100, height: 760 }, maximized: true }
    expect(placeWindow(saved, [FULL_HD], FULL_HD)).toEqual({ bounds: saved.bounds, maximized: true, minWidth: 960, minHeight: 640 })
  })

  it('restores onto a second monitor that is still connected', () => {
    const right: Rect = { x: 1920, y: 0, width: 2560, height: 1400 }
    const saved = { bounds: { x: 2200, y: 100, width: 1500, height: 1000 }, maximized: false }
    expect(placeWindow(saved, [FULL_HD, right], FULL_HD).bounds).toEqual(saved.bounds)
  })

  it('picks the screen showing most of a window that spans two monitors', () => {
    const right: Rect = { x: 1920, y: 0, width: 2560, height: 1400 }
    const saved = { bounds: { x: 1800, y: 100, width: 1500, height: 1000 }, maximized: false }
    expect(placeWindow(saved, [FULL_HD, right], FULL_HD).bounds).toEqual({ x: 1920, y: 100, width: 1500, height: 1000 })
  })

  it('falls back to the primary screen when the saved monitor was unplugged', () => {
    const saved = { bounds: { x: 2200, y: 100, width: 1500, height: 1000 }, maximized: false }
    expect(placeWindow(saved, [FULL_HD], FULL_HD).bounds).toEqual({ x: 280, y: 70, ...DEFAULT_SIZE })
    // A sliver left on screen is not enough to reuse the bounds either.
    const sliver = { bounds: { x: 1900, y: 100, width: 1500, height: 1000 }, maximized: false }
    expect(placeWindow(sliver, [FULL_HD], FULL_HD).bounds).toEqual({ x: 280, y: 70, ...DEFAULT_SIZE })
  })

  it('pulls a window that hangs off the edge back on screen and fits it to the screen', () => {
    const saved = { bounds: { x: 1500, y: -10, width: 1400, height: 1200 }, maximized: false }
    const placement = placeWindow(saved, [FULL_HD], FULL_HD)
    expect(placement.bounds).toEqual({ x: 520, y: 0, width: 1400, height: 1040 })
  })
})

describe('appMenuTemplate', () => {
  function roles(items: MenuItemConstructorOptions[]): string[] {
    return items.flatMap((item) => [
      ...(item.role ? [item.role] : []),
      ...(Array.isArray(item.submenu) ? roles(item.submenu) : [])
    ])
  }

  it('keeps reload and developer tools out of the installed app', () => {
    const production = roles(appMenuTemplate(false))
    expect(production).not.toContain('reload')
    expect(production).not.toContain('forceReload')
    expect(production).not.toContain('toggleDevTools')
    expect(production).toEqual(expect.arrayContaining(['quit', 'editMenu', 'zoomIn', 'zoomOut', 'resetZoom', 'windowMenu']))
  })

  it('offers them in development', () => {
    expect(roles(appMenuTemplate(true))).toEqual(expect.arrayContaining(['reload', 'forceReload', 'toggleDevTools']))
  })
})

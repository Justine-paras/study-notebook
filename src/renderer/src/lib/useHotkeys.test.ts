import { describe, expect, it } from 'vitest'
import { matchesCombo, normalizeKey, parseCombo, type KeyLike } from './useHotkeys'

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods
})

describe('hotkey parsing', () => {
  it('normalizes key names', () => {
    expect(normalizeKey(' ')).toBe('space')
    expect(normalizeKey('Esc')).toBe('escape')
    expect(normalizeKey('Enter')).toBe('enter')
    expect(normalizeKey('A')).toBe('a')
  })

  it('parses modifiers and a literal plus', () => {
    expect(parseCombo('mod+Enter')).toMatchObject({ key: 'enter', mod: true })
    expect(parseCombo('shift++')).toMatchObject({ key: '+', shift: true })
    expect(parseCombo(' space ')).toMatchObject({ key: 'space' })
  })
})

describe('hotkey matching', () => {
  it('matches plain keys only without modifiers', () => {
    expect(matchesCombo(key('1'), '1', false)).toBe(true)
    expect(matchesCombo(key(' '), 'space', false)).toBe(true)
    expect(matchesCombo(key('a'), 'a', false)).toBe(true)
    expect(matchesCombo(key('A', { shiftKey: true }), 'a', false)).toBe(false)
    expect(matchesCombo(key('1', { ctrlKey: true }), '1', false)).toBe(false)
  })

  it('maps mod to Ctrl on Windows and Cmd on macOS', () => {
    expect(matchesCombo(key('Enter', { ctrlKey: true }), 'mod+enter', false)).toBe(true)
    expect(matchesCombo(key('Enter', { metaKey: true }), 'mod+enter', false)).toBe(false)
    expect(matchesCombo(key('Enter', { metaKey: true }), 'mod+enter', true)).toBe(true)
  })

  it('accepts shifted symbols without spelling out shift', () => {
    expect(matchesCombo(key('?', { shiftKey: true }), '?', false)).toBe(true)
    expect(matchesCombo(key('?', { shiftKey: true }), 'shift+?', false)).toBe(true)
  })
})

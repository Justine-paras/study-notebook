// Keyboard shortcuts for a screen (review grades 1-4, Space to reveal, A-E to
// pick quiz options...). Shortcuts are written as strings: "space", "enter",
// "1", "a", "escape", "arrowleft", "mod+enter" (Ctrl on Windows, Cmd on macOS),
// "shift+?". Several combos can share a handler: "space, enter".

import { useEffect, useRef } from 'react'

export type HotkeyHandler = (event: KeyboardEvent) => void
export type HotkeyMap = Record<string, HotkeyHandler>

export interface HotkeyOptions {
  /** Turn all shortcuts off (e.g. while a dialog of this screen is open). Default true. */
  enabled?: boolean
  /**
   * Fire while typing in an input, textarea, select or contenteditable.
   * Default false; combos with ctrl/alt/meta/mod always fire, so "mod+enter"
   * can submit from a textarea.
   */
  allowInInputs?: boolean
  /** Fire while a modal dialog is open. Default false, so page shortcuts don't act behind a dialog. */
  allowInModal?: boolean
  /** Call preventDefault on matched events. Default true (stops Space from scrolling). */
  preventDefault?: boolean
}

/** Subset of KeyboardEvent the matcher needs, so it can be unit-tested without a DOM. */
export interface KeyLike {
  key: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

interface ParsedCombo {
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  mod: boolean
}

const KEY_ALIASES: Record<string, string> = {
  ' ': 'space',
  spacebar: 'space',
  esc: 'escape',
  return: 'enter',
  left: 'arrowleft',
  right: 'arrowright',
  up: 'arrowup',
  down: 'arrowdown',
  del: 'delete'
}

export function normalizeKey(key: string): string {
  const lower = key.toLowerCase()
  return KEY_ALIASES[lower] ?? lower
}

export function parseCombo(combo: string): ParsedCombo {
  // Split on "+" but keep a literal "+" key ("shift++" or "+").
  const parts = combo.trim().toLowerCase().split(/\+(?!$)/)
  const parsed: ParsedCombo = { key: '', ctrl: false, alt: false, shift: false, meta: false, mod: false }
  for (const part of parts) {
    if (part === 'ctrl' || part === 'control') parsed.ctrl = true
    else if (part === 'alt' || part === 'option') parsed.alt = true
    else if (part === 'shift') parsed.shift = true
    else if (part === 'meta' || part === 'cmd') parsed.meta = true
    else if (part === 'mod') parsed.mod = true
    else parsed.key = normalizeKey(part)
  }
  return parsed
}

export function isMacPlatform(): boolean {
  if (typeof window !== 'undefined' && window.studyBridge) return window.studyBridge.platform === 'darwin'
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
}

/** True when the event matches the combo exactly (extra modifiers do not match). */
export function matchesCombo(event: KeyLike, combo: string, isMac = isMacPlatform()): boolean {
  const parsed = parseCombo(combo)
  const wantCtrl = parsed.ctrl || (parsed.mod && !isMac)
  const wantMeta = parsed.meta || (parsed.mod && isMac)
  if (event.ctrlKey !== wantCtrl || event.metaKey !== wantMeta || event.altKey !== parsed.alt) return false
  const key = normalizeKey(event.key)
  // Shifted symbols ("?", "!") already encode shift in the key, so only check
  // shift for letters, digits and named keys, or when the combo asks for it.
  const symbol = key.length === 1 && !/[a-z0-9]/.test(key)
  if (!symbol && event.shiftKey !== parsed.shift) return false
  if (symbol && parsed.shift && !event.shiftKey) return false
  return key === parsed.key
}

function hasCommandModifier(combo: string): boolean {
  const parsed = parseCombo(combo)
  return parsed.ctrl || parsed.alt || parsed.meta || parsed.mod
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  const type = (target as HTMLInputElement).type
  // Checkboxes, radios and buttons don't take text, so shortcuts still apply.
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type)
}

function modalIsOpen(): boolean {
  return document.querySelector('dialog[open], [aria-modal="true"]') !== null
}

/**
 * Registers shortcuts on window while the component is mounted:
 *
 *   useHotkeys({ 'space, enter': reveal, '1': () => grade(1) }, { enabled: !revealed })
 *
 * The map may be a new object every render; the latest handlers are used.
 */
export function useHotkeys(map: HotkeyMap, options: HotkeyOptions = {}): void {
  const { enabled = true, allowInInputs = false, allowInModal = false, preventDefault = true } = options
  const mapRef = useRef(map)
  mapRef.current = map

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return
      if (!allowInModal && modalIsOpen()) {
        // Shortcuts registered by the dialog's own content still run.
        const target = event.target instanceof Element ? event.target : null
        if (!target?.closest('dialog[open], [aria-modal="true"]')) return
      }
      const typing = isTypingTarget(event.target)
      for (const [combos, handler] of Object.entries(mapRef.current)) {
        for (const combo of combos.split(',')) {
          if (!combo.trim()) continue
          if (typing && !allowInInputs && !hasCommandModifier(combo)) continue
          if (matchesCombo(event, combo)) {
            if (preventDefault) event.preventDefault()
            handler(event)
            return
          }
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, allowInInputs, allowInModal, preventDefault])
}

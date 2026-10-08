// Small per-device conveniences kept in localStorage (exam flags, lesson
// answers, an unsent explanation). Storage can be missing or throw (private
// mode, cleared data), so every access is guarded and the UI works without it.

import { useCallback, useEffect, useRef, useState } from 'react'

export function readStored<T>(key: string, parse: (value: unknown) => T, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : parse(JSON.parse(raw))
  } catch {
    return fallback
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    if (value === undefined) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage is a convenience; losing it only loses the convenience.
  }
}

export function removeStored(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // See writeStored.
  }
}

/**
 * useState backed by localStorage under `key` (null = memory only). The
 * value is re-read when the key changes; `parse` must accept anything.
 */
export function useStoredState<T>(
  key: string | null,
  fallback: T,
  parse: (value: unknown) => T
): [T, (next: T | ((previous: T) => T)) => void] {
  const parseRef = useRef(parse)
  parseRef.current = parse
  const fallbackRef = useRef(fallback)
  const [state, setState] = useState<{ key: string | null; value: T }>(() => ({
    key,
    value: key ? readStored(key, parse, fallback) : fallback
  }))

  // A new key (another lesson or quiz) starts from what is stored for it.
  const current = state.key === key ? state.value : key ? readStored(key, parseRef.current, fallbackRef.current) : fallbackRef.current
  useEffect(() => {
    if (state.key !== key) setState({ key, value: current })
  }, [key, state.key, current])

  const keyRef = useRef(key)
  keyRef.current = key
  const valueRef = useRef(current)
  valueRef.current = current

  const set = useCallback((next: T | ((previous: T) => T)) => {
    const value = typeof next === 'function' ? (next as (previous: T) => T)(valueRef.current) : next
    valueRef.current = value
    setState({ key: keyRef.current, value })
    if (keyRef.current) writeStored(keyRef.current, value)
  }, [])

  return [current, set]
}

import { useEffect, useMemo, useRef } from 'react'

export interface Debouncer<T> {
  /** Runs `fn(value)` after `delayMs` without another schedule call. */
  schedule: (value: T) => void
  /** Runs the pending call now, if any. */
  flush: () => void
  /** Drops the pending call. */
  cancel: () => void
  isPending: () => boolean
}

/** Trailing-edge debounce that remembers the last value, so a pending save can be flushed on blur or unmount. */
export function createDebouncer<T>(fn: (value: T) => void, delayMs: number): Debouncer<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: { value: T } | null = null

  const run = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    const call = pending
    pending = null
    if (call) fn(call.value)
  }

  return {
    schedule(value) {
      pending = { value }
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(run, delayMs)
    },
    flush: run,
    cancel() {
      if (timer !== null) clearTimeout(timer)
      timer = null
      pending = null
    },
    isPending: () => pending !== null
  }
}

/**
 * A debouncer bound to a component. It always calls the latest `fn`, and a
 * pending call is flushed on unmount so leaving the page never drops an edit.
 */
export function useDebouncer<T>(fn: (value: T) => void, delayMs: number): Debouncer<T> {
  const fnRef = useRef(fn)
  fnRef.current = fn
  const debouncer = useMemo(() => createDebouncer<T>((value) => fnRef.current(value), delayMs), [delayMs])
  useEffect(() => () => debouncer.flush(), [debouncer])
  return debouncer
}

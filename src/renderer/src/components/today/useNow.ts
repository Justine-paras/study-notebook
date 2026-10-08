import { useEffect, useState } from 'react'

/**
 * The current time, refreshed every `intervalMs`. The app often stays open
 * for hours, so the greeting and date must not freeze at first render.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

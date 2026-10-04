import { useEffect, useState } from 'react'

/**
 * The current time, refreshed every minute. One stable Date per minute keeps
 * memoised lists stable between renders while "due now" and "in 3 days"
 * still roll over when the page is left open.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

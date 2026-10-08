// The app is often left open overnight (or the laptop sleeps with it in
// front), and a window that never loses focus never refetches on focus. When
// the local date changes, everything is refetched so Today's plan, due counts
// and the streak belong to the new day.

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toLocalDateKey } from './format'

const CHECK_EVERY_MS = 60_000

/** True when `previous` (a local date key) is no longer today at `now`. */
export function dayChanged(previous: string, now: Date): boolean {
  return toLocalDateKey(now) !== previous
}

export function useDayRollover(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    let day = toLocalDateKey(new Date())
    const check = () => {
      const now = new Date()
      if (!dayChanged(day, now)) return
      day = toLocalDateKey(now)
      void queryClient.invalidateQueries()
    }
    const id = window.setInterval(check, CHECK_EVERY_MS)
    // Waking from sleep shows the window again: check at once instead of up to a minute later.
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [queryClient])
}

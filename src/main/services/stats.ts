// Study statistics shared by Today and Insights.

import { isRecalledRating, localDate, streakDays as computeStreak } from '@shared/learning'
import type { AppContext } from '../context'
import { hasStudyActivityBetween } from '../db/repositories/activity'
import { countLongTermCards } from '../db/repositories/cards'
import { listFocusSessionsSince } from '../db/repositories/focusSessions'
import { listReviewLogsSince } from '../db/repositories/reviewLogs'
import { DAY_MS, startOfLocalDayOffset } from './common'

/** FSRS stability (days) from which a card counts as being in long-term memory. */
export const LONG_TERM_STABILITY_DAYS = 21
/** How far back to look for the streak; longer streaks are capped here. */
const STREAK_LOOKBACK_DAYS = 730

/** Share (0-100) of reviews in the last 7 days that were recalled (Hard or better); null when there were none. */
export function recallRate7d(ctx: AppContext): number | null {
  const since = new Date(ctx.now().getTime() - 7 * DAY_MS).toISOString()
  const logs = listReviewLogsSince(ctx.db, since)
  if (logs.length === 0) return null
  return Math.round((100 * logs.filter((l) => isRecalledRating(l.rating)).length) / logs.length)
}

export function longTermCards(ctx: AppContext): number {
  return countLongTermCards(ctx.db, LONG_TERM_STABILITY_DAYS)
}

/**
 * Consecutive local days with an answer, a review or a focus session.
 *
 * Walks back one local day at a time (midnight to midnight, so DST days are
 * 23 or 25 hours long) and stops at the first day without study, instead of
 * loading two years of timestamps on every Today refresh. Today may still be
 * empty: the streak then ends yesterday (see streakDays).
 */
export function studyStreak(ctx: AppContext): number {
  const now = ctx.now()
  const activeDates: string[] = []
  for (let back = 0; back <= STREAK_LOOKBACK_DAYS; back++) {
    const start = startOfLocalDayOffset(now, -back)
    const end = startOfLocalDayOffset(now, -back + 1)
    if (hasStudyActivityBetween(ctx.db, start.toISOString(), end.toISOString())) activeDates.push(localDate(start))
    else if (back > 0) break
  }
  return computeStreak(activeDates, localDate(now))
}

/** Focus minutes per local date, for focus sessions that started on or after local midnight `daysBack` days ago. */
export function focusMinutesByDate(ctx: AppContext, daysBack: number): Map<string, number> {
  const since = startOfLocalDayOffset(ctx.now(), -daysBack).toISOString()
  const totals = new Map<string, number>()
  for (const session of listFocusSessionsSince(ctx.db, since, 'focus')) {
    const date = localDate(new Date(session.startedAt))
    totals.set(date, (totals.get(date) ?? 0) + session.minutes)
  }
  return totals
}

export function studyMinutesToday(ctx: AppContext): number {
  return Math.round(focusMinutesByDate(ctx, 0).get(localDate(ctx.now())) ?? 0)
}

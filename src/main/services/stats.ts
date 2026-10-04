// Study statistics shared by Today and Insights.

import { localDate, streakDays as computeStreak } from '@shared/learning'
import type { AppContext } from '../context'
import { focusTimestampsSince } from '../db/repositories/activity'
import { answerTimestampsSince } from '../db/repositories/answers'
import { countLongTermCards } from '../db/repositories/cards'
import { listFocusSessionsSince } from '../db/repositories/focusSessions'
import { listReviewLogsSince, reviewTimestampsSince } from '../db/repositories/reviewLogs'
import { DAY_MS, startOfLocalDayOffset } from './common'

/** FSRS stability (days) from which a card counts as being in long-term memory. */
export const LONG_TERM_STABILITY_DAYS = 21
/** How far back to look for the streak; longer streaks are capped here, which keeps the query bounded. */
const STREAK_LOOKBACK_DAYS = 730

/** Share (0-100) of reviews in the last 7 days rated Hard or better; null when there were none. */
export function recallRate7d(ctx: AppContext): number | null {
  const since = new Date(ctx.now().getTime() - 7 * DAY_MS).toISOString()
  const logs = listReviewLogsSince(ctx.db, since)
  if (logs.length === 0) return null
  return Math.round((100 * logs.filter((l) => l.rating >= 2).length) / logs.length)
}

export function longTermCards(ctx: AppContext): number {
  return countLongTermCards(ctx.db, LONG_TERM_STABILITY_DAYS)
}

/** Consecutive local days with an answer, a review or a focus session. */
export function studyStreak(ctx: AppContext): number {
  const now = ctx.now()
  const since = new Date(now.getTime() - STREAK_LOOKBACK_DAYS * DAY_MS).toISOString()
  const timestamps = [
    ...answerTimestampsSince(ctx.db, since),
    ...reviewTimestampsSince(ctx.db, since),
    ...focusTimestampsSince(ctx.db, since)
  ]
  const dates = [...new Set(timestamps.map((ts) => localDate(new Date(ts))))]
  return computeStreak(dates, localDate(now))
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

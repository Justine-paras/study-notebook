// Day boundaries at the service level in a time zone with daylight saving
// time: the streak walks local midnights, so 23- and 25-hour days must count
// as one day each. Node re-reads TZ when it changes, so the zone is switched
// for this file only and restored.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { services } from '../../src/main/services'
import { createTestContext, type TestContext } from './helpers/context'

const ZONE = 'America/New_York'
let previousTz: string | undefined
let ctx: TestContext | null = null

beforeAll(() => {
  previousTz = process.env.TZ
  process.env.TZ = ZONE
})
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ
  else process.env.TZ = previousTz
})
afterEach(() => ctx?.cleanup())

async function focusAt(c: TestContext, start: Date): Promise<void> {
  await services.logFocusSession(c, { notebookId: null, kind: 'focus', startedAt: start.toISOString(), endedAt: new Date(start.getTime() + 20 * 60_000).toISOString(), minutes: 20 })
}

describe(`streak and study minutes in ${ZONE}`, () => {
  it('counts the spring-forward day (23 hours) as one day', async () => {
    ctx = createTestContext({ now: new Date(2026, 2, 9, 12, 0) })
    expect(new Date(2026, 2, 7).getTimezoneOffset() - new Date(2026, 2, 9).getTimezoneOffset()).toBe(60)
    for (const start of [new Date(2026, 2, 6, 23, 30), new Date(2026, 2, 7, 23, 30), new Date(2026, 2, 8, 23, 30), new Date(2026, 2, 9, 0, 15)]) {
      await focusAt(ctx, start)
    }
    const today = await services.getToday(ctx)
    expect(today.streakDays).toBe(4)
    expect(today.studyMinutesToday).toBe(20)
  })

  it('counts the fall-back day (25 hours) as one day and keeps late-evening study on its local date', async () => {
    ctx = createTestContext({ now: new Date(2026, 10, 2, 8, 0) })
    // 23:30 on Nov 1 in New York is already Nov 2 in UTC.
    for (const start of [new Date(2026, 9, 31, 22, 0), new Date(2026, 10, 1, 23, 30)]) await focusAt(ctx, start)
    expect((await services.getToday(ctx)).streakDays).toBe(2)
    const insights = await services.getInsights(ctx)
    expect(insights.studyMinutesByDay.slice(-3)).toEqual([
      { date: '2026-10-31', minutes: 20 },
      { date: '2026-11-01', minutes: 20 },
      { date: '2026-11-02', minutes: 0 }
    ])
  })
})

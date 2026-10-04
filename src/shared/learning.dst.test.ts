// Date logic under a time zone with daylight saving time. Node re-reads TZ
// when it changes, so the zone is switched for this file only and restored.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { daysBetween, forecastDue, localDate, reviewPlanLabels, streakDays } from './learning'

const ZONE = 'America/New_York'
let previousTz: string | undefined

beforeAll(() => {
  previousTz = process.env.TZ
  process.env.TZ = ZONE
})

afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ
  else process.env.TZ = previousTz
})

describe(`dates in ${ZONE}`, () => {
  it('runs in a zone with DST', () => {
    // EDT is UTC-4 in October, EST is UTC-5 in December.
    expect(new Date(2026, 9, 4).getTimezoneOffset()).toBe(240)
    expect(new Date(2026, 11, 4).getTimezoneOffset()).toBe(300)
  })

  it('uses the local date, not the UTC date, late in the evening', () => {
    // 23:30 EDT on Oct 4 is already Oct 5 in UTC.
    const lateEvening = new Date('2026-10-05T03:30:00.000Z')
    expect(localDate(lateEvening)).toBe('2026-10-04')
  })

  it('counts calendar days across the fall-back and spring-forward days', () => {
    // 2026-11-01 has 25 hours, 2026-03-08 has 23 hours in New York.
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2)
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
    expect(daysBetween('2026-03-08', '2026-03-08')).toBe(0)
  })

  it('forecasts across the fall-back day without skipping or repeating a date', () => {
    const from = new Date(2026, 9, 31, 23, 30)
    const cards = [{ due: new Date(2026, 10, 1, 23, 30).toISOString() }, { due: new Date(2026, 10, 2, 0, 30).toISOString() }]
    expect(forecastDue(cards, from, 3)).toEqual([
      { date: '2026-10-31', due: 0 },
      { date: '2026-11-01', due: 1 },
      { date: '2026-11-02', due: 1 }
    ])
  })

  it('labels review dates across the fall-back day by calendar day', () => {
    const now = new Date(2026, 9, 31, 22, 0)
    const due = new Date(2026, 10, 1, 21, 0).toISOString()
    expect(reviewPlanLabels([due], now)).toEqual([{ label: 'Tomorrow', date: '2026-11-01' }])
  })

  it('keeps a streak across the spring-forward day', () => {
    expect(streakDays(['2026-03-07', '2026-03-08', '2026-03-09'], '2026-03-09')).toBe(3)
  })
})

import { describe, expect, it } from 'vitest'
import { dayChanged } from './useDayRollover'

describe('dayChanged', () => {
  it('stays on the same day until local midnight', () => {
    expect(dayChanged('2026-10-04', new Date(2026, 9, 4, 0, 0))).toBe(false)
    expect(dayChanged('2026-10-04', new Date(2026, 9, 4, 23, 59, 59))).toBe(false)
  })

  it('sees the new day after midnight, also after a long sleep', () => {
    expect(dayChanged('2026-10-04', new Date(2026, 9, 5, 0, 0))).toBe(true)
    expect(dayChanged('2026-10-04', new Date(2026, 9, 9, 8, 30))).toBe(true)
    expect(dayChanged('2026-12-31', new Date(2027, 0, 1, 0, 1))).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import {
  LEARNER_NAME,
  addDays,
  daysBetween,
  formatClock,
  formatDate,
  formatDayCount,
  formatFileSize,
  formatList,
  formatMinutes,
  formatPercent,
  formatRelativeDays,
  greeting,
  isNotebookColor,
  masteryColorVars,
  notebookColorVars,
  notebookStyle,
  parseDate,
  pluralize,
  pomodoroCount,
  timeOfDay,
  toLocalDateKey
} from './format'

// Local-time constructors keep these tests independent of the machine's timezone.
const at = (hour: number, minute = 0) => new Date(2026, 9, 3, hour, minute)

describe('greeting', () => {
  it('picks the time of day', () => {
    expect(timeOfDay(at(4))).toBe('morning')
    expect(timeOfDay(at(11, 59))).toBe('morning')
    expect(timeOfDay(at(12))).toBe('afternoon')
    expect(timeOfDay(at(17, 59))).toBe('afternoon')
    expect(timeOfDay(at(18))).toBe('evening')
    expect(timeOfDay(at(1))).toBe('evening')
  })

  it('greets Justine by default', () => {
    expect(LEARNER_NAME).toBe('Justine')
    expect(greeting(at(15))).toBe('Good afternoon, Justine')
    expect(greeting(at(8), 'Sam')).toBe('Good morning, Sam')
  })
})

describe('dates', () => {
  it('parses local calendar dates as local midnight', () => {
    const d = parseDate('2026-10-12')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(9)
    expect(d.getDate()).toBe(12)
    expect(d.getHours()).toBe(0)
  })

  it('round-trips local date keys', () => {
    expect(toLocalDateKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
    expect(toLocalDateKey('2026-10-12')).toBe('2026-10-12')
  })

  it('counts calendar days, not 24-hour periods', () => {
    expect(daysBetween(at(23, 59), new Date(2026, 9, 4, 0, 1))).toBe(1)
    expect(daysBetween('2026-10-03', '2026-10-12')).toBe(9)
    expect(daysBetween('2026-10-12', '2026-10-03')).toBe(-9)
    // Across a month and a typical DST change
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31)
    expect(daysBetween('2026-10-20', '2026-11-10')).toBe(21)
  })

  it('adds days without mutating the input', () => {
    const start = at(10)
    expect(toLocalDateKey(addDays(start, 30))).toBe('2026-11-02')
    expect(start.getDate()).toBe(3)
  })

  it('formats in each style', () => {
    const now = at(9)
    expect(formatDate(at(15), 'full', now)).toBe('Saturday, October 3')
    expect(formatDate('2026-10-12', 'medium', now)).toBe('Oct 12')
    expect(formatDate('2026-10-12', 'weekday', now)).toBe('Mon')
    expect(formatDate('2026-10-12', 'weekday-short', now)).toBe('Mon, Oct 12')
    expect(formatDate(new Date(2026, 9, 3, 15, 45), 'time', now)).toMatch(/^3:45\sPM$/)
    expect(formatDate(new Date(2026, 9, 3, 15, 45), 'datetime', now)).toMatch(/^Oct 3, 3:45\sPM$/)
  })

  it('adds the year only when it differs', () => {
    expect(formatDate('2027-01-04', 'medium', at(9))).toBe('Jan 4, 2027')
  })

  it('returns an empty string for invalid dates', () => {
    expect(formatDate('not a date')).toBe('')
    expect(formatRelativeDays('nope')).toBe('')
  })

  it('describes relative days', () => {
    const now = at(20)
    expect(formatRelativeDays('2026-10-03', now)).toBe('today')
    expect(formatRelativeDays('2026-10-04', now)).toBe('tomorrow')
    expect(formatRelativeDays('2026-10-02', now)).toBe('yesterday')
    expect(formatRelativeDays('2026-10-07', now)).toBe('in 4 days')
    expect(formatRelativeDays('2026-09-28', now)).toBe('5 days ago')
    expect(formatRelativeDays('2026-10-24', now)).toBe('in 3 weeks')
    expect(formatRelativeDays('2027-01-03', now)).toBe('in 3 months')
    expect(formatRelativeDays(new Date(2026, 9, 4, 1).toISOString(), now)).toBe('tomorrow')
  })

  it('words precomputed day counts the same way', () => {
    expect(formatDayCount(0)).toBe('today')
    expect(formatDayCount(1)).toBe('tomorrow')
    expect(formatDayCount(9)).toBe('in 9 days')
    expect(formatDayCount(-14)).toBe('2 weeks ago')
    expect(formatDayCount(400)).toBe('in 1 year')
  })
})

describe('numbers and text', () => {
  it('pluralizes regular and irregular words', () => {
    expect(pluralize(1, 'card')).toBe('1 card')
    expect(pluralize(0, 'card')).toBe('0 cards')
    expect(pluralize(3, 'quiz', 'quizzes')).toBe('3 quizzes')
    expect(pluralize(2, 'class')).toBe('2 classes')
    expect(pluralize(2, 'summary')).toBe('2 summaries')
    expect(pluralize(2, 'day')).toBe('2 days')
    expect(pluralize(1200, 'card')).toBe('1,200 cards')
    expect(pluralize(2, 'card', undefined, false)).toBe('cards')
  })

  it('formats minutes', () => {
    expect(formatMinutes(0)).toBe('0 min')
    expect(formatMinutes(45)).toBe('45 min')
    expect(formatMinutes(44.6)).toBe('45 min')
    expect(formatMinutes(60)).toBe('1 h')
    expect(formatMinutes(80)).toBe('1 h 20 min')
    expect(formatMinutes(-5)).toBe('0 min')
  })

  it('formats timer clocks', () => {
    expect(formatClock(1500)).toBe('25:00')
    expect(formatClock(299)).toBe('4:59')
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(3723)).toBe('1:02:03')
    expect(formatClock(-3)).toBe('0:00')
  })

  it('formats percentages with a fallback', () => {
    expect(formatPercent(67.6)).toBe('68%')
    expect(formatPercent(null)).toBe('–')
    expect(formatPercent(Number.NaN, 'n/a')).toBe('n/a')
  })

  it('formats file sizes', () => {
    expect(formatFileSize(820)).toBe('820 B')
    expect(formatFileSize(12 * 1024)).toBe('12 KB')
    expect(formatFileSize(3.4 * 1024 * 1024)).toBe('3.4 MB')
    expect(formatFileSize(42 * 1024 * 1024)).toBe('42 MB')
  })

  it('joins lists in plain English', () => {
    expect(formatList([])).toBe('')
    expect(formatList(['DSA'])).toBe('DSA')
    expect(formatList(['DSA', 'OS'])).toBe('DSA and OS')
    expect(formatList(['DSA', 'OS', 'DB'])).toBe('DSA, OS and DB')
  })

  it('counts Pomodoros for a plan', () => {
    expect(pomodoroCount(45, 25)).toBe(2)
    expect(pomodoroCount(25, 25)).toBe(1)
    expect(pomodoroCount(5, 25)).toBe(1)
    expect(pomodoroCount(0, 25)).toBe(0)
  })
})

describe('color helpers', () => {
  it('maps notebook colors to tokens', () => {
    expect(notebookColorVars('teal')).toEqual({
      cover: 'var(--nb-teal)',
      tint: 'var(--nb-teal-tint)',
      ink: 'var(--nb-teal-ink)'
    })
    expect(notebookStyle('gold')).toEqual({
      '--notebook': 'var(--nb-gold)',
      '--notebook-tint': 'var(--nb-gold-tint)',
      '--notebook-ink': 'var(--nb-gold-ink)'
    })
  })

  it('validates notebook colors', () => {
    expect(isNotebookColor('pink')).toBe(true)
    expect(isNotebookColor('red')).toBe(false)
  })

  it('maps mastery states to kebab-case tokens', () => {
    expect(masteryColorVars('not_started')).toEqual({
      bg: 'var(--mastery-not-started-bg)',
      fg: 'var(--mastery-not-started-fg)',
      ink: 'var(--mastery-not-started-ink)'
    })
    expect(masteryColorVars('weak').fg).toBe('var(--mastery-weak-fg)')
  })
})

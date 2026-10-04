import { describe, expect, it } from 'vitest'
import type { CalibrationBucket, WeakTopic } from '@shared/types'
import {
  MIN_BAR_FRACTION,
  barFractions,
  calibrationInterpretation,
  forecastLabel,
  masteryStatus,
  overconfidenceNote,
  shownAnswer,
  studyTotals,
  subjectLabel
} from './insightsModel'

function buckets(sure: [number, number], unsure: [number, number], guess: [number, number]): CalibrationBucket[] {
  const make = (confidence: CalibrationBucket['confidence'], [answered, correct]: [number, number]): CalibrationBucket => ({
    confidence,
    answered,
    correct,
    accuracy: answered > 0 ? Math.round((100 * correct) / answered) : null
  })
  return [make('sure', sure), make('unsure', unsure), make('guess', guess)]
}

function weak(title: string, overconfidentCount: number): WeakTopic {
  return {
    topicId: title,
    notebookId: 'n',
    notebookName: 'Operating Systems',
    notebookCode: 'CS 310',
    title,
    mastery: 40,
    accuracy: 50,
    missedCount: 3,
    answeredCount: 6,
    overconfidentCount,
    why: ''
  }
}

describe('barFractions', () => {
  it('scales to the tallest bar', () => {
    expect(barFractions([0, 5, 10])).toEqual([0, 0.5, 1])
  })
  it('keeps a sliver for small non-zero values', () => {
    expect(barFractions([1, 100])[0]).toBe(MIN_BAR_FRACTION)
  })
  it('handles all-zero and empty data', () => {
    expect(barFractions([0, 0])).toEqual([0, 0])
    expect(barFractions([])).toEqual([])
  })
})

describe('forecastLabel', () => {
  it('names the first day Today and the rest by weekday', () => {
    expect(forecastLabel('2026-10-04', 0)).toBe('Today')
    expect(forecastLabel('2026-10-05', 1)).toBe('Mon')
  })
})

describe('studyTotals', () => {
  it('sums minutes and averages over every day', () => {
    expect(studyTotals([{ minutes: 30 }, { minutes: 0 }, { minutes: 45 }, { minutes: 0 }])).toEqual({
      total: 75,
      dailyAverage: 19,
      activeDays: 2
    })
    expect(studyTotals([])).toEqual({ total: 0, dailyAverage: 0, activeDays: 0 })
  })
})

describe('masteryStatus', () => {
  it('uses the prototype thresholds', () => {
    expect(masteryStatus(48)).toEqual({ label: 'Needs work', tone: 'bad' })
    expect(masteryStatus(60)).toEqual({ label: 'Getting there', tone: 'caution' })
    expect(masteryStatus(80)).toEqual({ label: 'Strong', tone: 'good' })
  })
})

describe('subjectLabel', () => {
  it('prefers the course code', () => {
    expect(subjectLabel({ notebookCode: 'CS 201', notebookName: 'DSA' })).toBe('CS 201')
    expect(subjectLabel({ notebookCode: ' ', notebookName: 'DSA' })).toBe('DSA')
  })
})

describe('calibrationInterpretation', () => {
  it('asks for more ratings when there is too little data', () => {
    expect(calibrationInterpretation(buckets([2, 2], [1, 0], [0, 0]))).toMatch(/few more answers/)
  })
  it('warns when sure answers are often wrong', () => {
    expect(calibrationInterpretation(buckets([10, 6], [5, 3], [5, 1]))).toMatch(/only 60%/)
  })
  it('praises good calibration', () => {
    expect(calibrationInterpretation(buckets([20, 18], [10, 6], [5, 1]))).toMatch(/well calibrated.*90%/)
  })
  it('notices underconfidence', () => {
    expect(calibrationInterpretation(buckets([10, 8], [10, 7], [10, 8]))).toMatch(/know more than you think/)
  })
  it('sets a target between 70 and 85', () => {
    expect(calibrationInterpretation(buckets([10, 8], [10, 5], [10, 2]))).toMatch(/80%.*aim for 90%/)
  })
  it('handles learners who never choose Sure', () => {
    expect(calibrationInterpretation(buckets([1, 1], [10, 5], [10, 2]))).toMatch(/marked many answers as Sure/)
  })
})

describe('overconfidenceNote', () => {
  it('is null without sure-but-wrong answers this week', () => {
    expect(overconfidenceNote(0, [weak('Paging', 4)])).toBeNull()
  })
  it('names the topic with the most overconfident errors', () => {
    expect(overconfidenceNote(7, [weak('Paging', 1), weak('Hashing', 4), weak('Deadlocks', 2)])).toEqual({
      times: '7 times',
      topic: 'Hashing'
    })
  })
  it('names no topic when none stands out', () => {
    expect(overconfidenceNote(1, [weak('Paging', 1)])).toEqual({ times: '1 time', topic: null })
  })
})

describe('shownAnswer', () => {
  it('marks blank answers', () => {
    expect(shownAnswer('  ')).toBe('(left blank)')
    expect(shownAnswer(' O(n) ')).toBe('O(n)')
  })
})

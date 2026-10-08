import { describe, expect, it } from 'vitest'
import { AppError } from '@shared/errors'
import {
  NO_FILES_LABEL,
  SOURCE_CHAR_BUDGET,
  buildKeywords,
  cutSource,
  formatRanges,
  scoreText,
  selectSources,
  splitSegments,
  type CandidateSource
} from './sourceBudget'

function source(id: string, text: string, kind: CandidateSource['kind'] = 'lecture'): CandidateSource {
  return { id, fileName: `${id}.pdf`, kind, text }
}

/** A paged document where `relevant` pages talk about deadlocks and the rest about something else. */
function pagedText(pages: number, relevant: number[], pageChars: number, marker: 'Page' | 'Slide' = 'Page'): string {
  return Array.from({ length: pages }, (_, i) => {
    const n = i + 1
    const sentence = relevant.includes(n) ? 'Deadlock happens when processes wait on each other. ' : 'Paging maps virtual memory to frames. '
    return `[${marker} ${n}]\n${sentence.repeat(Math.ceil(pageChars / sentence.length)).slice(0, pageChars)}`
  }).join('\n\n')
}

const deadlockQuery = { titles: ['Deadlocks'], descriptions: ['Conditions for deadlock and how to prevent them'] }

describe('buildKeywords / scoreText', () => {
  it('drops stopwords, stems plurals and weights titles above descriptions', () => {
    const keywords = buildKeywords({ titles: ['Binary Search Trees'], descriptions: ['how the tree is balanced'] })
    const terms = new Map(keywords.words.map((k) => [k.term, k.weight]))
    expect(terms.get('tree')).toBe(3)
    expect(terms.get('balanced')).toBe(1)
    expect(terms.has('how')).toBe(false)
    expect(keywords.phrases.map((p) => p.term)).toEqual(['binary search trees'])
  })

  it('scores matching text above unrelated text and zero without keywords', () => {
    const keywords = buildKeywords(deadlockQuery)
    expect(scoreText('A deadlock needs four conditions.', keywords)).toBeGreaterThan(scoreText('Paging and frames.', keywords))
    expect(scoreText('Paging and frames.', keywords)).toBe(0)
    expect(scoreText('anything', buildKeywords({ titles: [], descriptions: [] }))).toBe(0)
  })

  it('matches whole words only', () => {
    const keywords = buildKeywords({ titles: ['OS'], descriptions: [] })
    expect(scoreText('cosine host', keywords)).toBe(0)
    expect(scoreText('The OS schedules', keywords)).toBeGreaterThan(0)
  })
})

describe('splitSegments', () => {
  it('splits on page and slide markers and keeps a preamble', () => {
    const segments = splitSegments('Title page\n[Page 1]\nalpha\n\n[Page 2]\nbeta')
    expect(segments.map((s) => [s.marker, s.number])).toEqual([
      [null, null],
      ['page', 1],
      ['page', 2]
    ])
    expect(segments[1].text).toBe('[Page 1]\nalpha')
    expect(splitSegments('[Slide 3]\nx')[0]).toMatchObject({ marker: 'slide', number: 3 })
  })

  it('splits unmarked text into paragraph-aligned blocks', () => {
    const paragraph = 'word '.repeat(300).trim()
    const segments = splitSegments(Array.from({ length: 10 }, () => paragraph).join('\n\n'))
    expect(segments.length).toBeGreaterThan(1)
    expect(segments.every((s) => s.marker === null && s.text.length <= 4_000)).toBe(true)
  })
})

describe('formatRanges', () => {
  it('compresses consecutive numbers', () => {
    expect(formatRanges([12, 3, 4, 5, 9, 13])).toBe('3-5, 9, 12-13')
    expect(formatRanges([7])).toBe('7')
  })
})

describe('selectSources', () => {
  it('keeps every source whole when they fit, most relevant first, labelled by file name', () => {
    const result = selectSources(
      [source('paging', 'Paging maps memory.'), source('deadlocks', 'Deadlock prevention breaks a condition.')],
      deadlockQuery
    )
    expect(result.labels).toEqual(['deadlocks.pdf', 'paging.pdf'])
    expect(result.docs.map((d) => d.name)).toEqual(['deadlocks.pdf', 'paging.pdf'])
    expect(result.docs[0].text).toBe('Deadlock prevention breaks a condition.')
    expect(result.docs[0].kind).toBe('lecture')
  })

  it('never exceeds the budget and cuts an oversized source to its relevant pages, saying which', () => {
    const textbook = source('Big Textbook', pagedText(400, [210, 211, 212, 213, 214, 215], 2_000))
    const result = selectSources([textbook], deadlockQuery, { budget: 20_000 })
    expect(result.usedChars).toBeLessThanOrEqual(20_000)
    expect(result.docs[0].text.length).toBeLessThanOrEqual(20_000)
    expect(result.labels[0]).toMatch(/^Big Textbook\.pdf, pages \d+-\d+$/)
    expect(result.docs[0].text).toContain('[Page 212]')
    expect(result.docs[0].text).not.toContain('[Page 1]\n')
  })

  it('uses "slides" for slide decks and a single page label', () => {
    const deck = source('deck', pagedText(30, [7], 3_000, 'Slide'))
    const result = selectSources([deck], deadlockQuery, { budget: 3_100 })
    expect(result.labels[0]).toBe('deck.pdf, slide 7')
  })

  it('keeps small relevant files whole before cutting a big one', () => {
    const lecture = source('lecture', 'Deadlock: four Coffman conditions. '.repeat(20))
    const textbook = source('textbook', pagedText(100, [50], 1_000))
    const result = selectSources([textbook, lecture], deadlockQuery, { budget: 10_000 })
    expect(result.labels[0]).toBe('lecture.pdf')
    expect(result.docs[0].text).toBe(lecture.text)
    expect(result.labels[1]).toMatch(/^textbook\.pdf, pages? /)
    expect(result.usedChars).toBeLessThanOrEqual(10_000)
  })

  it('takes the opening pages of an irrelevant oversized source', () => {
    const unrelated = source('unrelated', pagedText(50, [], 1_000))
    const result = selectSources([unrelated], deadlockQuery, { budget: 5_000 })
    expect(result.labels[0]).toBe('unrelated.pdf, pages 1-4')
  })

  it('labels excerpts of unmarked text with the share kept', () => {
    const paragraph = 'Deadlock and paging notes. '.repeat(40)
    const notes = { ...source('notes', Array.from({ length: 40 }, () => paragraph).join('\n\n')), fileName: 'notes.txt' }
    const result = selectSources([notes], deadlockQuery, { budget: 10_000 })
    expect(result.labels[0]).toMatch(/^notes\.txt, excerpts \(about \d+% of the file\)$/)
  })

  it('truncates a single giant page rather than sending nothing', () => {
    const giant = source('giant', `[Page 1]\n${'deadlock '.repeat(5_000)}`)
    const result = selectSources([giant], deadlockQuery, { budget: 10_000 })
    expect(result.labels[0]).toBe('giant.pdf, page 1 (excerpt)')
    expect(result.usedChars).toBeLessThanOrEqual(10_000)
  })

  it('throws NO_SOURCES when nothing has text, unless a description can stand in', () => {
    const empty = [source('scan', '   ')]
    expect(() => selectSources(empty, deadlockQuery)).toThrowError(AppError)
    try {
      selectSources([], deadlockQuery)
    } catch (err) {
      expect((err as AppError).code).toBe('NO_SOURCES')
    }
    expect(selectSources(empty, deadlockQuery, { allowDescriptionOnly: true })).toEqual({
      docs: [],
      labels: [NO_FILES_LABEL],
      usedChars: 0
    })
  })

  it('is deterministic for the same inputs (prompt caching relies on it)', () => {
    const inputs = [source('a', pagedText(80, [3, 40], 2_000)), source('b', 'deadlock '.repeat(100))]
    expect(selectSources(inputs, deadlockQuery, { budget: 30_000 })).toEqual(selectSources(inputs, deadlockQuery, { budget: 30_000 }))
  })

  it('defaults to the 600,000 character budget', () => {
    expect(SOURCE_CHAR_BUDGET).toBe(600_000)
    const huge = source('huge', pagedText(400, [100], 2_000))
    const result = selectSources([huge], deadlockQuery)
    expect(result.usedChars).toBeLessThanOrEqual(SOURCE_CHAR_BUDGET)
    expect(result.labels[0]).toMatch(/pages/)
  })
})

describe('cutSource', () => {
  it('returns null when the cap is too small to be useful', () => {
    expect(cutSource(source('x', pagedText(5, [1], 1_000)), buildKeywords(deadlockQuery), 500)).toBeNull()
  })
})

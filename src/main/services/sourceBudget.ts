// Decides which source text goes into an AI call. Pure (no I/O) so the rules
// in ARCHITECTURE.md "Source text budget" are unit-tested directly:
// - at most ~600,000 characters per call,
// - sources ranked by relevance to the topic(s),
// - an oversized source is cut to its most relevant page/slide windows,
// - every cut is disclosed in the labels (never cut silently),
// - no text at all -> NO_SOURCES, unless a topic description can stand in.

import { AppError } from '@shared/errors'
import type { ID, SourceKind } from '@shared/types'
import type { AiSourceDoc } from '../ai'

export const SOURCE_CHAR_BUDGET = 600_000
export const NO_FILES_LABEL = 'No files: based on the topic description'

/** Below this much remaining budget an excerpt is too small to teach from, so selection stops. */
const MIN_EXCERPT_CHARS = 2_000
/** Unmarked text (TXT, MD, DOCX) is cut in paragraph-aligned blocks of about this size. */
const BLOCK_CHARS = 4_000
/** More windows than this makes the "pages ..." label unreadable and the excerpt incoherent. */
const MAX_WINDOWS = 6
/** Pages/blocks are joined with a blank line, which counts towards the budget. */
const SEPARATOR = '\n\n'

const STOPWORDS = new Set(
  (
    'a an and are as at be by for from has have how in into is it its of on or that the this to was were what when where which who ' +
    'why will with within without your you we our can do does not no yes using use used about also more most other some such than ' +
    'then there these they those through via vs between each per part unit week chapter lecture lesson topic introduction intro ' +
    'overview basics basic fundamentals'
  ).split(' ')
)

export interface CandidateSource {
  id: ID
  fileName: string
  kind: SourceKind
  text: string
}

/** What the call is about: the titles weigh more than descriptions. */
export interface RelevanceQuery {
  titles: string[]
  descriptions: string[]
}

export interface SelectSourcesOptions {
  budget?: number
  /**
   * When no candidate has any text: return no documents with the
   * NO_FILES_LABEL instead of throwing NO_SOURCES. Set when the topic has a
   * description the AI can work from.
   */
  allowDescriptionOnly?: boolean
}

export interface SourceSelection {
  docs: AiSourceDoc[]
  /** One label per document, for `sourcesUsed` ("Big Textbook.pdf, pages 210-245"). */
  labels: string[]
  /** Characters of source text selected (including separators). */
  usedChars: number
}

interface Keyword {
  term: string
  weight: number
}

interface Keywords {
  words: Keyword[]
  /** Whole titles, which count extra when they appear verbatim. */
  phrases: Keyword[]
}

/** A page, slide, or block of unmarked text. */
export interface Segment {
  marker: 'page' | 'slide' | null
  /** Page/slide number, null for text before the first marker and for unmarked blocks. */
  number: number | null
  text: string
}

// Light stemming so "deadlocks" matches "deadlock"; applied to both the query
// and the text, so odd stems like "proces" still match each other.
function stem(word: string): string {
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

const WORD_PATTERN = /[a-z0-9][a-z0-9+#]*/g

function tokenize(text: string): string[] {
  return text.toLowerCase().match(WORD_PATTERN) ?? []
}

export function buildKeywords(query: RelevanceQuery): Keywords {
  const weights = new Map<string, number>()
  const add = (text: string, weight: number): void => {
    for (const token of tokenize(text)) {
      if (token.length < 2 || STOPWORDS.has(token)) continue
      const term = stem(token)
      weights.set(term, Math.max(weights.get(term) ?? 0, weight))
    }
  }
  for (const title of query.titles) add(title, 3)
  for (const description of query.descriptions) add(description, 1)
  const phrases = query.titles
    .map((t) => t.toLowerCase().replace(/\s+/g, ' ').trim())
    .filter((t) => t.includes(' ') && t.length >= 6)
    .map((term) => ({ term, weight: 6 }))
  return { words: [...weights].map(([term, weight]) => ({ term, weight })), phrases }
}

/**
 * Relevance of `text` to the keywords. Occurrences are log-scaled so a text
 * that covers many of the query terms beats one that repeats a single word.
 */
export function scoreText(text: string, keywords: Keywords): number {
  if (keywords.words.length === 0 && keywords.phrases.length === 0) return 0
  const wanted = new Map(keywords.words.map((k) => [k.term, k.weight]))
  const counts = new Map<string, number>()
  const lower = text.toLowerCase()
  for (const token of lower.match(WORD_PATTERN) ?? []) {
    const term = stem(token)
    if (wanted.has(term)) counts.set(term, (counts.get(term) ?? 0) + 1)
  }
  let score = 0
  for (const [term, count] of counts) score += (wanted.get(term) ?? 0) * Math.log2(1 + count)
  const flat = lower.replace(/\s+/g, ' ')
  for (const phrase of keywords.phrases) {
    let count = 0
    for (let at = flat.indexOf(phrase.term); at !== -1; at = flat.indexOf(phrase.term, at + phrase.term.length)) count++
    if (count > 0) score += phrase.weight * Math.log2(1 + count)
  }
  return score
}

const MARKER_LINE = /^\[(Page|Slide) (\d+)\]\s*$/

/**
 * Splits extracted text on its "[Page N]" / "[Slide N]" marker lines. Text
 * without markers is split into paragraph-aligned blocks instead, so it can
 * still be cut to its most relevant parts.
 */
export function splitSegments(text: string): Segment[] {
  const lines = text.split('\n')
  const hasMarkers = lines.some((line) => MARKER_LINE.test(line))
  if (!hasMarkers) return splitBlocks(text)

  const segments: Segment[] = []
  let current: Segment | null = null
  let buffer: string[] = []
  const flush = (): void => {
    const body = buffer.join('\n').trim()
    if (current) segments.push({ ...current, text: body })
    else if (body) segments.push({ marker: null, number: null, text: body })
  }
  for (const line of lines) {
    const match = MARKER_LINE.exec(line)
    if (match) {
      flush()
      current = { marker: match[1] === 'Page' ? 'page' : 'slide', number: Number(match[2]), text: '' }
      buffer = [line]
    } else {
      buffer.push(line)
    }
  }
  flush()
  return segments
}

function splitBlocks(text: string): Segment[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const blocks: Segment[] = []
  let buffer = ''
  for (const paragraph of paragraphs) {
    if (buffer && buffer.length + SEPARATOR.length + paragraph.length > BLOCK_CHARS) {
      blocks.push({ marker: null, number: null, text: buffer })
      buffer = ''
    }
    buffer = buffer ? buffer + SEPARATOR + paragraph : paragraph
  }
  if (buffer) blocks.push({ marker: null, number: null, text: buffer })
  return blocks
}

/** "3-5, 9, 12-40" from sorted page numbers. */
export function formatRanges(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b)
  const parts: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]
    let end = start
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) end = sorted[++i]
    parts.push(start === end ? `${start}` : `${start}-${end}`)
  }
  return parts.join(', ')
}

function excerptLabel(fileName: string, segments: Segment[], picked: Segment[], truncated: boolean): string {
  const numbered = picked.filter((s) => s.number !== null)
  const marker = numbered[0]?.marker
  if (marker && numbered.length > 0) {
    const numbers = numbered.map((s) => s.number as number)
    const noun = marker === 'page' ? (numbers.length === 1 ? 'page' : 'pages') : numbers.length === 1 ? 'slide' : 'slides'
    return `${fileName}, ${noun} ${formatRanges(numbers)}${truncated ? ' (excerpt)' : ''}`
  }
  const total = segments.reduce((sum, s) => sum + s.text.length, 0)
  const used = picked.reduce((sum, s) => sum + s.text.length, 0)
  const percent = Math.max(1, Math.min(99, Math.round((100 * used) / Math.max(1, total))))
  return `${fileName}, excerpts (about ${percent}% of the file)`
}

interface Window {
  start: number
  end: number
  score: number
  chars: number
}

/**
 * Highest-scoring run of consecutive free segments whose joined length fits
 * `cap` (two pointers; lengths are positive so the window slides). Ties prefer
 * the longer, then the earlier window.
 */
function bestWindow(lengths: number[], scores: number[], taken: boolean[], cap: number): Window | null {
  let best: Window | null = null
  let start = 0
  let chars = 0
  let score = 0
  for (let end = 0; end < lengths.length; end++) {
    if (taken[end]) {
      start = end + 1
      chars = 0
      score = 0
      continue
    }
    chars += lengths[end] + SEPARATOR.length
    score += scores[end]
    while (chars > cap && start <= end) {
      chars -= lengths[start] + SEPARATOR.length
      score -= scores[start]
      start++
    }
    if (start > end) continue
    if (!best || score > best.score || (score === best.score && chars > best.chars)) {
      best = { start, end, score, chars }
    }
  }
  return best
}

/**
 * Cuts one oversized source to at most `cap` characters, keeping its most
 * relevant windows of pages in reading order. Returns null when nothing useful fits.
 */
export function cutSource(source: CandidateSource, keywords: Keywords, cap: number): { text: string; label: string; chars: number } | null {
  const segments = splitSegments(source.text)
  if (segments.length === 0 || cap < MIN_EXCERPT_CHARS) return null
  const lengths = segments.map((s) => s.text.length)
  const scores = segments.map((s) => scoreText(s.text, keywords))
  const taken = segments.map(() => false)
  const anyRelevant = scores.some((s) => s > 0)

  let remaining = cap
  let windows = 0
  if (!anyRelevant) {
    // Nothing matches the query: the opening pages (usually the overview) are the best guess.
    for (let i = 0; i < segments.length && lengths[i] + SEPARATOR.length <= remaining; i++) {
      taken[i] = true
      remaining -= lengths[i] + SEPARATOR.length
    }
  } else {
    while (windows < MAX_WINDOWS && remaining >= MIN_EXCERPT_CHARS) {
      const window = bestWindow(lengths, scores, taken, remaining)
      if (!window || window.score <= 0) break
      for (let i = window.start; i <= window.end; i++) taken[i] = true
      remaining -= window.chars
      windows++
    }
  }

  const picked = segments.filter((_, i) => taken[i])
  if (picked.length > 0) {
    const text = picked.map((s) => s.text).join(SEPARATOR)
    return { text, label: excerptLabel(source.fileName, segments, picked, false), chars: cap - remaining }
  }

  // A single page larger than the whole cap (rare: e.g. a giant unpaged dump).
  let bestIndex = 0
  for (let i = 1; i < segments.length; i++) if (scores[i] > scores[bestIndex]) bestIndex = i
  const segment = segments[bestIndex]
  const text = segment.text.slice(0, cap - SEPARATOR.length)
  return { text, label: excerptLabel(source.fileName, segments, [segment], true), chars: text.length + SEPARATOR.length }
}

/**
 * Picks the source text for one AI call. Relevant sources (any keyword hit)
 * come before irrelevant ones; within each tier, sources that fit whole are
 * kept whole (in relevance order) and oversized ones are then cut to the
 * remaining budget. Documents are returned in relevance order, which is
 * deterministic for the same inputs so repeated calls share the prompt cache.
 */
export function selectSources(candidates: CandidateSource[], query: RelevanceQuery, options: SelectSourcesOptions = {}): SourceSelection {
  const budget = options.budget ?? SOURCE_CHAR_BUDGET
  const usable = candidates.filter((c) => c.text.trim().length > 0)
  if (usable.length === 0) {
    if (options.allowDescriptionOnly) return { docs: [], labels: [NO_FILES_LABEL], usedChars: 0 }
    throw new AppError('NO_SOURCES', 'There is no readable source text for this topic yet.')
  }

  const keywords = buildKeywords(query)
  const ranked = usable
    .map((source, index) => ({ source, index, score: scoreText(source.text, keywords) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
  const tiers = [ranked.filter((r) => r.score > 0), ranked.filter((r) => r.score <= 0)]

  const picked: { order: number; doc: AiSourceDoc; label: string }[] = []
  let remaining = budget
  for (const tier of tiers) {
    const oversized: typeof tier = []
    for (const entry of tier) {
      const chars = entry.source.text.length + SEPARATOR.length
      if (chars <= remaining) {
        picked.push({ order: ranked.indexOf(entry), doc: toDoc(entry.source, entry.source.text), label: entry.source.fileName })
        remaining -= chars
      } else {
        oversized.push(entry)
      }
    }
    for (const entry of oversized) {
      if (remaining < MIN_EXCERPT_CHARS) break
      const cut = cutSource(entry.source, keywords, remaining)
      if (!cut) continue
      picked.push({ order: ranked.indexOf(entry), doc: toDoc(entry.source, cut.text), label: cut.label })
      remaining -= cut.chars
    }
  }

  picked.sort((a, b) => a.order - b.order)
  return { docs: picked.map((p) => p.doc), labels: picked.map((p) => p.label), usedChars: budget - remaining }
}

function toDoc(source: CandidateSource, text: string): AiSourceDoc {
  return { name: source.fileName, kind: source.kind, text }
}

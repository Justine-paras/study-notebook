// PowerPoint (.pptx) text extraction. A .pptx is a zip of XML parts; the
// text lives in DrawingML runs (<a:t>) grouped into paragraphs (<a:p>), and
// tables (<a:tbl>) hold the same paragraphs inside cells.

import { readFile } from 'node:fs/promises'
import { posix } from 'node:path'
import JSZip from 'jszip'
import { AppError } from '@shared/errors'
import { countVisibleChars, decodeXmlEntities, tidyText } from './text'
import type { ExtractResult } from './extract'

const SLIDE_PATH = /^ppt\/slides\/slide(\d+)\.xml$/
const NOTES_REL_TYPE = /\/notesSlide$/
const SLIDE_REL_TYPE = /\/slide$/

/** Parses the attributes of one XML start tag into a map (namespace prefixes kept, values decoded). */
export function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[match[1]!] = decodeXmlEntities(match[2] ?? match[3] ?? '')
  }
  return attrs
}

interface Relationship {
  id: string
  type: string
  target: string
}

function parseRelationships(xml: string): Relationship[] {
  const rels: Relationship[] = []
  for (const match of xml.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)) {
    const attrs = parseAttributes(match[0])
    if (attrs.Id && attrs.Target && attrs.TargetMode !== 'External') {
      rels.push({ id: attrs.Id, type: attrs.Type ?? '', target: attrs.Target })
    }
  }
  return rels
}

/** Resolves a relationship target against the folder of the part that owns the .rels file. */
function resolveTarget(partPath: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  return posix.normalize(posix.join(posix.dirname(partPath), target))
}

function relsPathFor(partPath: string): string {
  return posix.join(posix.dirname(partPath), '_rels', `${posix.basename(partPath)}.rels`)
}

/** Text of one <a:p> paragraph: its runs, fields, line breaks and tabs in order. */
function paragraphText(paragraphXml: string): string {
  let text = ''
  for (const match of paragraphXml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/?>|<a:tab\b[^>]*\/?>/g)) {
    if (match[1] !== undefined) text += decodeXmlEntities(match[1])
    else if (match[0].startsWith('<a:br')) text += '\n'
    else text += '\t'
  }
  return text
}

function paragraphsIn(xml: string): string[] {
  return [...xml.matchAll(/<a:p\b[^>]*?(?:\/>|>[\s\S]*?<\/a:p>)/g)].map((m) => paragraphText(m[0]))
}

/** One line per table row, cells separated by " | " so the structure survives as plain text. */
function tableText(tableXml: string): string {
  const rows: string[] = []
  for (const row of tableXml.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)) {
    const cells = [...row[0].matchAll(/<a:tc\b[^>]*?(?:\/>|>[\s\S]*?<\/a:tc>)/g)].map((cell) =>
      paragraphsIn(cell[0])
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' ')
    )
    if (cells.some(Boolean)) rows.push(cells.join(' | '))
  }
  return rows.join('\n')
}

/** Text of a slide (or notes) XML part in document order: paragraphs and tables. */
export function drawingMlText(xml: string): string {
  const blocks: string[] = []
  for (const match of xml.matchAll(/<a:tbl\b[\s\S]*?<\/a:tbl>|<a:p\b[^>]*?(?:\/>|>[\s\S]*?<\/a:p>)/g)) {
    blocks.push(match[0].startsWith('<a:tbl') ? tableText(match[0]) : paragraphText(match[0]))
  }
  return tidyText(blocks.join('\n'))
}

// Placeholders on a notes page that repeat slide furniture rather than the speaker's notes.
const NOTES_FURNITURE = new Set(['sldNum', 'sldImg', 'hdr', 'ftr', 'dt'])

/** The speaker's notes from a notesSlide part, without the slide number, header, footer or date. */
export function notesText(xml: string): string {
  const shapes = [...xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].map((m) => m[0])
  const kept = shapes.filter((shape) => {
    const ph = /<p:ph\b[^>]*>/.exec(shape)
    const type = ph ? parseAttributes(ph[0]).type : undefined
    return !type || !NOTES_FURNITURE.has(type)
  })
  return tidyText(kept.map(drawingMlText).filter(Boolean).join('\n'))
}

async function readPart(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path)
  return file ? file.async('string') : null
}

/**
 * Slide part paths in presentation order (from presentation.xml's slide id
 * list), falling back to the numbers in the file names when that can't be
 * read. File numbers don't change when slides are reordered in PowerPoint.
 */
async function slideOrder(zip: JSZip): Promise<string[]> {
  const byNumber = Object.keys(zip.files)
    .map((path) => ({ path, match: SLIDE_PATH.exec(path) }))
    .filter((entry): entry is { path: string; match: RegExpExecArray } => entry.match !== null)
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]))
    .map((entry) => entry.path)

  const presentationPath = 'ppt/presentation.xml'
  const [presentation, rels] = await Promise.all([readPart(zip, presentationPath), readPart(zip, relsPathFor(presentationPath))])
  if (!presentation || !rels) return byNumber

  const targets = new Map(
    parseRelationships(rels)
      .filter((rel) => SLIDE_REL_TYPE.test(rel.type))
      .map((rel) => [rel.id, resolveTarget(presentationPath, rel.target)])
  )
  const ordered: string[] = []
  for (const match of presentation.matchAll(/<p:sldId\b[^>]*>/g)) {
    const rid = parseAttributes(match[0])['r:id']
    const path = rid ? targets.get(rid) : undefined
    if (path && zip.file(path) && !ordered.includes(path)) ordered.push(path)
  }
  return ordered.length > 0 ? ordered : byNumber
}

async function notesFor(zip: JSZip, slidePath: string): Promise<string> {
  const rels = await readPart(zip, relsPathFor(slidePath))
  let notesPath: string | undefined
  if (rels) {
    const rel = parseRelationships(rels).find((r) => NOTES_REL_TYPE.test(r.type))
    if (rel) notesPath = resolveTarget(slidePath, rel.target)
  } else {
    // Without rels the conventional pairing is slideN.xml <-> notesSlideN.xml.
    const number = SLIDE_PATH.exec(slidePath)?.[1]
    if (number) notesPath = `ppt/notesSlides/notesSlide${number}.xml`
  }
  const xml = notesPath ? await readPart(zip, notesPath) : null
  return xml ? notesText(xml) : ''
}

export async function extractPptx(filePath: string): Promise<ExtractResult> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(await readFile(filePath))
  } catch {
    throw new AppError(
      'EXTRACT_FAILED',
      "This PowerPoint file couldn't be opened. It may be damaged, password-protected or an old .ppt file renamed to .pptx."
    )
  }

  const slides = await slideOrder(zip)
  if (slides.length === 0) {
    const isPresentation = zip.file('ppt/presentation.xml') !== null
    throw new AppError(
      'EXTRACT_FAILED',
      isPresentation ? 'This presentation has no slides.' : "This file isn't a PowerPoint presentation."
    )
  }

  const parts: string[] = []
  let visible = 0
  for (const [index, slidePath] of slides.entries()) {
    const [xml, notes] = await Promise.all([readPart(zip, slidePath), notesFor(zip, slidePath)])
    const body = xml ? drawingMlText(xml) : ''
    visible += countVisibleChars(body) + countVisibleChars(notes)
    const lines = [`[Slide ${index + 1}]`]
    if (body) lines.push(body)
    if (notes) lines.push('Notes:', notes)
    parts.push(lines.join('\n'))
  }

  if (visible === 0) {
    throw new AppError('EXTRACT_FAILED', 'This presentation has no text on its slides (only pictures?). Add a version with text.')
  }
  return { text: parts.join('\n\n'), pageCount: slides.length }
}

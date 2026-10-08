// Builds small, valid (and deliberately broken) PDF, PPTX and DOCX files for
// the extraction tests, so no binary fixtures live in the repository.
// Imported only by *.test.ts files.

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { PDFDocument, StandardFonts } from 'pdf-lib'

export async function makeTempDir(prefix = 'study-files-'): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

export async function writeFixture(dir: string, name: string, data: Uint8Array | string): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, data)
  return path
}

/** A PDF with one page per entry; each page draws its lines top to bottom (a blank string skips a line). */
export async function makePdf(pages: string[][], options: { fontSize?: number } = {}): Promise<Uint8Array> {
  const fontSize = options.fontSize ?? 12
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const lines of pages) {
    const page = doc.addPage([612, 792])
    let y = 740
    for (const line of lines) {
      if (line) page.drawText(line, { x: 72, y, size: fontSize, font })
      y -= fontSize * 1.25
    }
  }
  return doc.save()
}

/**
 * Assembles a PDF from raw object bodies, computing the xref table, for
 * structures pdf-lib can't produce (such as an /Encrypt dictionary).
 */
export function rawPdf(objects: string[], trailerExtra = ''): Uint8Array {
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/** A one-page PDF protected with a user password (standard security handler, RC4 40-bit). */
export function makeEncryptedPdf(): Uint8Array {
  const hex32 = (byte: string): string => `<${byte.repeat(32)}>`
  return rawPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
      // O and U don't match the empty password, so a password is required to open it.
      `<< /Filter /Standard /V 1 /R 2 /Length 40 /P -44 /O ${hex32('ab')} /U ${hex32('cd')} >>`
    ],
    '/Encrypt 4 0 R /ID [<0123456789abcdef0123456789abcdef> <0123456789abcdef0123456789abcdef>] '
  )
}

// ---------------------------------------------------------------------------
// PPTX
// ---------------------------------------------------------------------------

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'

function xmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** One DrawingML paragraph; "\n" inside a string becomes a <a:br/>. */
function aParagraph(text: string): string {
  if (!text) return '<a:p><a:endParaRPr lang="en-US"/></a:p>'
  const runs = text
    .split('\n')
    .map((part) => `<a:r><a:rPr lang="en-US" dirty="0"/><a:t>${xmlEscape(part)}</a:t></a:r>`)
    .join('<a:br><a:rPr lang="en-US"/></a:br>')
  return `<a:p><a:pPr lvl="0"/>${runs}</a:p>`
}

function textShape(id: number, paragraphs: string[], placeholder?: string): string {
  const ph = placeholder ? `<p:nvPr><p:ph type="${placeholder}"/></p:nvPr>` : '<p:nvPr/>'
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/>${ph}</p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs.map(aParagraph).join('')}</p:txBody></p:sp>`
}

function tableFrame(rows: string[][]): string {
  const tr = rows
    .map((cells) => `<a:tr h="370840">${cells.map((c) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${aParagraph(c)}</a:txBody><a:tcPr/></a:tc>`).join('')}</a:tr>`)
    .join('')
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="Table 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">` +
    `<a:tbl><a:tblPr/><a:tblGrid>${rows[0]!.map(() => '<a:gridCol w="100"/>').join('')}</a:tblGrid>${tr}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
}

export interface FixtureSlide {
  /** File number N in ppt/slides/slideN.xml. Defaults to the slide's position. */
  fileNumber?: number
  title?: string
  body?: string[]
  table?: string[][]
  /** Text placed after the table, to check document order. */
  after?: string[]
  notes?: string[]
  /** Links notes through the slide's .rels (default) or only by file number. */
  notesLinkedByRels?: boolean
}

/**
 * A minimal but valid .pptx. Slides appear in presentation.xml in the given
 * order; `omitPresentation` drops presentation.xml to exercise the
 * file-number fallback.
 */
export async function makePptx(slides: FixtureSlide[], options: { omitPresentation?: boolean } = {}): Promise<Uint8Array> {
  const zip = new JSZip()
  const numbers = slides.map((s, i) => s.fileNumber ?? i + 1)

  const overrides = [
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    ...numbers.map((n) => `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`),
    ...slides.flatMap((s, i) => (s.notes ? [`<Override PartName="/ppt/notesSlides/notesSlide${numbers[i]}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`] : []))
  ]
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join('')}</Types>`
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
  )

  if (!options.omitPresentation) {
    zip.file(
      'ppt/presentation.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:sldIdLst>` +
        numbers.map((_n, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 10}"/>`).join('') +
        `</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`
    )
    zip.file(
      'ppt/_rels/presentation.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL}">` +
        numbers.map((n, i) => `<Relationship Id="rId${i + 10}" Type="${REL}/slide" Target="slides/slide${n}.xml"/>`).join('') +
        `</Relationships>`
    )
  }

  slides.forEach((slide, i) => {
    const n = numbers[i]!
    const shapes = [
      slide.title !== undefined ? textShape(2, [slide.title], 'title') : '',
      slide.body ? textShape(3, slide.body, 'body') : '',
      slide.table ? tableFrame(slide.table) : '',
      slide.after ? textShape(4, slide.after) : ''
    ].join('')
    zip.file(
      `ppt/slides/slide${n}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree>` +
        `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld></p:sld>`
    )
    if (!slide.notes) return
    // Deliberately numbered differently from the slide when linked by rels, so the test proves rels are followed.
    const linkedByRels = slide.notesLinkedByRels ?? true
    const notesNumber = linkedByRels ? n + 100 : n
    if (linkedByRels) {
      zip.file(
        `ppt/slides/_rels/slide${n}.xml.rels`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL}">` +
          `<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
          `<Relationship Id="rId2" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide${notesNumber}.xml"/></Relationships>`
      )
    }
    zip.file(
      `ppt/notesSlides/notesSlide${notesNumber}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree>` +
        `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
        textShape(2, [''], 'sldImg') +
        textShape(3, slide.notes, 'body') +
        textShape(4, [String(i + 1)], 'sldNum') +
        `</p:spTree></p:cSld></p:notes>`
    )
  })
  return zip.generateAsync({ type: 'uint8array' })
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

export interface FixtureParagraph {
  text: string
  /** Paragraph style id such as "Heading1". */
  style?: string
}

/** A minimal .docx that mammoth can read. */
export async function makeDocx(paragraphs: FixtureParagraph[]): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`
  )
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL}"></Relationships>`)
  const body = paragraphs
    .map((p) => {
      const style = p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : ''
      return `<w:p>${style}<w:r><w:t xml:space="preserve">${xmlEscape(p.text)}</w:t></w:r></w:p>`
    })
    .join('')
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:body>${body}<w:sectPr/></w:body></w:document>`
  )
  return zip.generateAsync({ type: 'uint8array' })
}

/** A valid zip that is not an Office document. */
export async function makeUnrelatedZip(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('readme.txt', 'hello')
  return zip.generateAsync({ type: 'uint8array' })
}

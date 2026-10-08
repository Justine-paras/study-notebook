import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { AppError } from '@shared/errors'
import { drawingMlText, extractPptx, notesText, parseAttributes } from './pptx'
import { makePptx, makeTempDir, makeUnrelatedZip, writeFixture, type FixtureSlide } from './testFixtures'

describe('parseAttributes', () => {
  it('reads single- and double-quoted attributes with prefixes and entities', () => {
    expect(parseAttributes(`<p:sldId id="256" r:id='rId2' name="a &amp; b"/>`)).toEqual({ id: '256', 'r:id': 'rId2', name: 'a & b' })
  })
})

describe('drawingMlText', () => {
  it('keeps paragraphs, runs, breaks and tabs in order and decodes entities', () => {
    const xml =
      '<a:p><a:r><a:t>if (a &lt; b &amp;&amp; c)</a:t></a:r></a:p>' +
      '<a:p/>' +
      '<a:p><a:r><a:t xml:space="preserve">one </a:t></a:r><a:r><a:t>two</a:t></a:r><a:br/><a:r><a:t>three</a:t></a:r><a:tab/><a:r><a:t>four</a:t></a:r></a:p>'
    expect(drawingMlText(xml)).toBe('if (a < b && c)\n\none two\nthree\tfour')
  })

  it('renders tables one row per line with cells separated by pipes', () => {
    const cell = (t: string): string => `<a:tc><a:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></a:txBody></a:tc>`
    const xml = `<a:p><a:r><a:t>Before</a:t></a:r></a:p><a:tbl><a:tr>${cell('Op')}${cell('Cost')}</a:tr><a:tr>${cell('insert')}${cell('O(log n)')}</a:tr></a:tbl><a:p><a:r><a:t>After</a:t></a:r></a:p>`
    expect(drawingMlText(xml)).toBe('Before\nOp | Cost\ninsert | O(log n)\nAfter')
  })
})

describe('notesText', () => {
  it('drops slide number, image, header, footer and date placeholders', () => {
    const shape = (type: string | null, text: string): string =>
      `<p:sp><p:nvSpPr>${type ? `<p:nvPr><p:ph type="${type}"/></p:nvPr>` : ''}</p:nvSpPr><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
    const xml = ['sldImg', 'sldNum', 'hdr', 'ftr', 'dt'].map((t) => shape(t, `furniture ${t}`)).join('') + shape('body', 'Say this') + shape(null, 'And this')
    expect(notesText(xml)).toBe('Say this\nAnd this')
  })
})

describe('extractPptx', () => {
  let dir: string
  let cleanup: () => Promise<void>
  beforeAll(async () => ({ dir, cleanup } = await makeTempDir()))
  afterAll(() => cleanup())

  async function extract(name: string, slides: FixtureSlide[], options?: { omitPresentation?: boolean }) {
    return extractPptx(await writeFixture(dir, name, await makePptx(slides, options)))
  }

  async function expectFailure(name: string, data: Uint8Array, message: RegExp): Promise<void> {
    const err = await extractPptx(await writeFixture(dir, name, data)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('EXTRACT_FAILED')
    expect((err as AppError).message).toMatch(message)
  }

  it('extracts slides with titles, bullets, tables and speaker notes', async () => {
    const result = await extract('week5.pptx', [
      { title: 'Binary Search Trees', body: ['Left < root < right', 'Search is O(h)'], notes: ['Draw an example on the board.', 'Ask: what is h for a balanced tree?'] },
      { title: 'Costs', table: [['Operation', 'Average', 'Worst'], ['search', 'O(log n)', 'O(n)']], after: ['Balance matters'] },
      { title: 'Ünïcödé — 日本語 🙂', body: ['Tom & Jerry say "hi"', 'line one\nline two'] }
    ])
    expect(result.pageCount).toBe(3)
    expect(result.text).toBe(
      [
        '[Slide 1]\nBinary Search Trees\nLeft < root < right\nSearch is O(h)\nNotes:\nDraw an example on the board.\nAsk: what is h for a balanced tree?',
        '[Slide 2]\nCosts\nOperation | Average | Worst\nsearch | O(log n) | O(n)\nBalance matters',
        '[Slide 3]\nÜnïcödé — 日本語 🙂\nTom & Jerry say "hi"\nline one\nline two'
      ].join('\n\n')
    )
  })

  it('follows presentation order, not file numbers', async () => {
    const result = await extract('reordered.pptx', [
      { fileNumber: 3, title: 'Intro' },
      { fileNumber: 1, title: 'Middle' },
      { fileNumber: 2, title: 'End' }
    ])
    expect(result.text).toBe('[Slide 1]\nIntro\n\n[Slide 2]\nMiddle\n\n[Slide 3]\nEnd')
  })

  it('falls back to numeric file order (slide10 after slide2) without presentation.xml', async () => {
    const slides = [10, 2, 1].map((n) => ({ fileNumber: n, title: `File ${n}` }))
    const result = await extract('no-presentation.pptx', slides, { omitPresentation: true })
    expect(result.pageCount).toBe(3)
    expect(result.text).toBe('[Slide 1]\nFile 1\n\n[Slide 2]\nFile 2\n\n[Slide 3]\nFile 10')
  })

  it('matches notes by slide number when the slide has no relationships part', async () => {
    const result = await extract('notes-by-number.pptx', [
      { title: 'One', notes: ['Notes for one'], notesLinkedByRels: false },
      { title: 'Two' }
    ])
    expect(result.text).toBe('[Slide 1]\nOne\nNotes:\nNotes for one\n\n[Slide 2]\nTwo')
  })

  it('keeps a marker for slides without text', async () => {
    const result = await extract('picture-slide.pptx', [{ title: 'Text' }, {}, { title: 'More' }])
    expect(result.text).toBe('[Slide 1]\nText\n\n[Slide 2]\n\n[Slide 3]\nMore')
  })

  it('rejects presentations with no text at all', async () => {
    const data = await makePptx([{}, { title: '' }])
    await expectFailure('pictures.pptx', data, /no text on its slides/)
  })

  it('rejects presentations with no slides', async () => {
    await expectFailure('empty-deck.pptx', await makePptx([]), /has no slides/)
  })

  it('rejects zips that are not presentations', async () => {
    await expectFailure('archive.pptx', await makeUnrelatedZip(), /isn't a PowerPoint presentation/)
  })

  it('rejects corrupt files', async () => {
    await expectFailure('corrupt.pptx', Buffer.from('definitely not a zip file'), /couldn't be opened/)
    const good = await makePptx([{ title: 'Hello' }])
    await expectFailure('cut.pptx', good.subarray(0, Math.floor(good.length / 2)), /couldn't be opened/)
  })

  it('ignores slide-like parts that are not slides', async () => {
    const zip = await JSZip.loadAsync(await makePptx([{ title: 'Real' }], { omitPresentation: true }))
    zip.file('ppt/slides/slideLayout1.xml', '<a:p><a:r><a:t>Not a slide</a:t></a:r></a:p>')
    zip.file('ppt/slideMasters/slideMaster1.xml', '<a:p><a:r><a:t>Master</a:t></a:r></a:p>')
    const path = await writeFixture(dir, 'extra-parts.pptx', await zip.generateAsync({ type: 'uint8array' }))
    expect(await extractPptx(path)).toEqual({ text: '[Slide 1]\nReal', pageCount: 1 })
  })
})

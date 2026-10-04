import { describe, expect, it } from 'vitest'
import { countVisibleChars, decodeTextFile, decodeXmlEntities, dehyphenate, tidyText } from './text'

describe('tidyText', () => {
  it('normalises CRLF and lone CR line endings', () => {
    expect(tidyText('a\r\nb\rc\n')).toBe('a\nb\nc')
  })

  it('strips trailing spaces, tabs and no-break spaces from every line', () => {
    expect(tidyText('one  \ntwo\t\nthree \nfour')).toBe('one\ntwo\nthree\nfour')
  })

  it('keeps at most two consecutive blank lines', () => {
    expect(tidyText('a\n\n\n\n\n\nb\n\n\nc\n\nd')).toBe('a\n\n\nb\n\n\nc\n\nd')
  })

  it('treats whitespace-only lines as blank when collapsing', () => {
    expect(tidyText('a\n   \n \t \n  \n   \nb')).toBe('a\n\n\nb')
  })

  it('removes NUL and other control characters but keeps tabs and newlines', () => {
    expect(tidyText('a\u0000b\u0007c\td\u001Be\u007Ff\u0085g￾h')).toBe('abc\tdefgh')
  })

  it('turns form feeds and vertical tabs into line breaks', () => {
    expect(tidyText('page one\fpage two\vline')).toBe('page one\npage two\nline')
  })

  it('trims blank lines at both ends but keeps leading indentation', () => {
    expect(tidyText('\n\n  indented\n\n')).toBe('  indented')
  })

  it('keeps unicode text intact', () => {
    const text = 'Ångström — naïve café 日本語 ∑ 🙂'
    expect(tidyText(text)).toBe(text)
  })
})

describe('dehyphenate', () => {
  it('joins words broken across lines', () => {
    expect(dehyphenate('the algo-\nrithm runs')).toBe('the algorithm runs')
  })

  it('handles the Unicode hyphen and non-ASCII letters', () => {
    expect(dehyphenate('Lösungs‐\nweg')).toBe('Lösungsweg')
  })

  it('keeps hyphens before capitals, digits and non-letters', () => {
    expect(dehyphenate('COVID-\n19 and Big-\nO and a -\nb')).toBe('COVID-\n19 and Big-\nO and a -\nb')
  })

  it('removes soft hyphens', () => {
    expect(dehyphenate('struc­\nture and in­line')).toBe('structure and inline')
  })
})

describe('decodeXmlEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeXmlEntities('a &lt; b &amp;&amp; c &gt; d &quot;x&quot; &apos;y&apos; &#233; &#x1F642;')).toBe(
      'a < b && c > d "x" \'y\' é 🙂'
    )
  })

  it('decodes in a single pass', () => {
    expect(decodeXmlEntities('&amp;lt;')).toBe('&lt;')
  })

  it('leaves unknown entities and drops invalid code points', () => {
    expect(decodeXmlEntities('&unknown; &#xD800; &#99999999;')).toBe('&unknown;  ')
  })
})

describe('countVisibleChars', () => {
  it('ignores all whitespace', () => {
    expect(countVisibleChars(' a b\n\tc  ')).toBe(3)
  })
})

describe('decodeTextFile', () => {
  it('decodes UTF-8 and strips a BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from('héllo 世界', 'utf8')])
    expect(decodeTextFile(bytes)).toBe('héllo 世界')
  })

  it('decodes UTF-16 LE and BE files with a BOM', () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Notes ✓', 'utf16le')])
    expect(decodeTextFile(le)).toBe('Notes ✓')
    const be = Buffer.from(le.subarray(2)).swap16()
    expect(decodeTextFile(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toBe('Notes ✓')
  })

  it('replaces invalid UTF-8 instead of failing', () => {
    expect(decodeTextFile(new Uint8Array([0x61, 0xff, 0x62]))).toBe('a�b')
  })
})

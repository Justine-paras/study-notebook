import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import { importPackageEsm, resolvePackageDir, resolvePackageFile, toSlashDir } from './esm'

describe('esm helpers', () => {
  it('resolves files and folders of installed packages', () => {
    expect(resolvePackageFile('pdfjs-dist/legacy/build/pdf.mjs')).toBe(join(resolvePackageDir('pdfjs-dist'), 'legacy', 'build', 'pdf.mjs'))
    expect(existsSync(join(resolvePackageDir('pdfjs-dist'), 'cmaps'))).toBe(true)
  })

  it('imports an ESM-only module through Node', async () => {
    const pdfjs = await importPackageEsm<{ version: string }>('pdfjs-dist/legacy/build/pdf.mjs')
    expect(pdfjs.version).toMatch(/^6\./)
  })

  it('formats data folders the way pdfjs wants them in Node', () => {
    expect(toSlashDir('/opt/app/cmaps')).toBe('/opt/app/cmaps/')
    expect(toSlashDir('/opt/app/cmaps/')).toBe('/opt/app/cmaps/')
    if (sep === '\\') expect(toSlashDir('C:\\app\\cmaps')).toBe('C:/app/cmaps/')
  })
})

import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import { importPackageEsm, resolvePackageDir, resolvePackageFile, toSlashDir, unpackedPath } from './esm'

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

  it('uses the unpacked copy of files inside a packaged app.asar', () => {
    const asar = 'C:\\Users\\Justine\\AppData\\Local\\Programs\\Study Notebook\\resources\\app.asar\\node_modules\\pdfjs-dist\\legacy\\build\\pdf.mjs'
    const unpacked = asar.replace('app.asar\\', 'app.asar.unpacked\\')
    expect(unpackedPath(asar, (p) => p === unpacked)).toBe(unpacked)
    // Not unpacked (asarUnpack misconfigured): keep the archive path and let Electron try.
    expect(unpackedPath(asar, () => false)).toBe(asar)
    expect(unpackedPath('/opt/Study Notebook/resources/app.asar/node_modules/pdfjs-dist/package.json', () => true)).toBe(
      '/opt/Study Notebook/resources/app.asar.unpacked/node_modules/pdfjs-dist/package.json'
    )
  })

  it('leaves paths outside an asar archive alone', () => {
    const exists = () => {
      throw new Error('should not be asked')
    }
    expect(unpackedPath('/home/justine/study-notebook/node_modules/pdfjs-dist/package.json', exists)).toBe(
      '/home/justine/study-notebook/node_modules/pdfjs-dist/package.json'
    )
    expect(unpackedPath('C:\\dev\\notes.asarx\\file.mjs', exists)).toBe('C:\\dev\\notes.asarx\\file.mjs')
    expect(unpackedPath('/opt/app.asar.unpacked/node_modules/x.mjs', exists)).toBe('/opt/app.asar.unpacked/node_modules/x.mjs')
  })
})

// Loading ESM-only packages (pdfjs-dist) from the main process bundle.
//
// electron-vite compiles src/main to CommonJS with dependencies left as
// `require()` calls, and pdfjs-dist ships only ES modules. A dynamic
// `import()` of a run-time value is left untouched by Rollup in CJS output
// (`output.dynamicImportInCjs` defaults to true), so Node's own ESM loader
// does the work. The `new Function('return import(s)')` trick is not used
// because code built that way has no module context under vitest's vm
// runner ("A dynamic import callback was not specified"). Importing an
// absolute file URL keeps the result independent of the calling file.
//
// Verified against the real build: out/main/index.js contains
// `import(specifier)` and `createRequire(require("url").pathToFileURL(__filename).href)`.

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const nativeImport = (specifier: string): Promise<unknown> => import(/* @vite-ignore */ specifier)

// Resolution starts from this module's own location, which after bundling is
// out/main/index.js (inside app.asar when packaged) and in tests the source
// file, so both find the project's node_modules.
const requireFromHere = createRequire(import.meta.url)

// ...\resources\app.asar\node_modules\... -> ...\resources\app.asar.unpacked\node_modules\...
const ASAR_SEGMENT = /\.asar(?=[\\/])/

/**
 * In a packaged app, require.resolve answers with paths inside app.asar.
 * Electron 44 can import and read those (checked, unpacked entries included),
 * but packages listed under asarUnpack (electron-builder.yml) are used from
 * their real copy in app.asar.unpacked so pdfjs, which reads its data files
 * through process.getBuiltinModule('fs'), never depends on Electron's asar
 * patches. Paths outside an archive, or files that were not unpacked, are
 * returned as is.
 */
export function unpackedPath(path: string, exists: (path: string) => boolean = existsSync): string {
  if (!ASAR_SEGMENT.test(path)) return path
  const unpacked = path.replace(ASAR_SEGMENT, '.asar.unpacked')
  return exists(unpacked) ? unpacked : path
}

/** Absolute path of a file inside an installed package, e.g. resolvePackageFile('pdfjs-dist/legacy/build/pdf.mjs'). */
export function resolvePackageFile(specifier: string): string {
  return unpackedPath(requireFromHere.resolve(specifier))
}

/** Absolute directory of an installed package. */
export function resolvePackageDir(packageName: string): string {
  return dirname(resolvePackageFile(`${packageName}/package.json`))
}

/** Imports an ES module from an installed package with Node's own loader, bypassing the bundler. */
export async function importPackageEsm<T>(specifier: string): Promise<T> {
  return (await nativeImport(pathToFileURL(resolvePackageFile(specifier)).href)) as T
}

/**
 * Turns a directory into the "base URL" form pdfjs expects for its data
 * folders in Node: a plain path read with fs, ending in "/". Forward slashes
 * are fine for fs on Windows and satisfy pdfjs's trailing-slash check.
 */
export function toSlashDir(dir: string): string {
  const slashed = sep === '\\' ? dir.split('\\').join('/') : dir
  return slashed.endsWith('/') ? slashed : `${slashed}/`
}

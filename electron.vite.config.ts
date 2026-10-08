import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = {
  '@shared': resolve(__dirname, 'src/shared')
}

export default defineConfig({
  main: {
    // Dependencies stay in node_modules and are require()d at run time
    // (pdfjs-dist must stay a real file on disk: see src/main/files/esm.ts).
    build: { externalizeDeps: true },
    resolve: { alias }
  },
  preload: {
    // The window is sandboxed, so the preload can only require('electron'):
    // everything else it imports is bundled into one file.
    build: { externalizeDeps: false },
    resolve: { alias }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        ...alias,
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [react()]
  }
})

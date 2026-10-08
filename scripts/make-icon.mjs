// Draws the app icon (resources/icon.png, 512x512) with Node's built-in
// modules only: a blue notebook cover with a darker spine, a paper label and
// an orange elastic band over a stack of pages, in the app's palette.
// electron-builder turns it into the Windows .ico. Run: npm run icon

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const SIZE = 512
const SAMPLES = 4 // 4x4 supersampling for smooth edges

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

function roundedRect(x0, y0, x1, y1, r) {
  return (x, y) => {
    if (x < x0 || x >= x1 || y < y0 || y >= y1) return false
    const cx = Math.min(Math.max(x, x0 + r), x1 - r)
    const cy = Math.min(Math.max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }
}
const both = (a, b) => (x, y) => a(x, y) && b(x, y)
const rect = (x0, y0, x1, y1) => roundedRect(x0, y0, x1, y1, 0)

const pages = roundedRect(104, 60, 448, 456, 34)
const cover = roundedRect(68, 40, 424, 472, 40)

// Back to front.
const layers = [
  { shape: pages, color: hex('#E3DED2') },
  { shape: roundedRect(104, 60, 440, 448, 30), color: hex('#F7F4EC') },
  { shape: cover, color: hex('#2F5D8A') },
  { shape: both(cover, rect(68, 40, 132, 472)), color: hex('#1F4266') },
  { shape: roundedRect(168, 128, 352, 236, 16), color: hex('#F7F4EC') },
  { shape: roundedRect(194, 166, 326, 176, 5), color: hex('#A39C8F') },
  { shape: roundedRect(194, 194, 300, 204, 5), color: hex('#A39C8F') },
  { shape: both(cover, rect(370, 40, 396, 472)), color: hex('#A4521E') }
]

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let py = 0; py < SIZE; py++) {
  raw[py * (SIZE * 4 + 1)] = 0 // filter: none
  for (let px = 0; px < SIZE; px++) {
    let r = 0
    let g = 0
    let b = 0
    let hits = 0
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const x = px + (sx + 0.5) / SAMPLES
        const y = py + (sy + 0.5) / SAMPLES
        let color = null
        for (const layer of layers) if (layer.shape(x, y)) color = layer.color
        if (!color) continue
        r += color[0]
        g += color[1]
        b += color[2]
        hits++
      }
    }
    const o = py * (SIZE * 4 + 1) + 1 + px * 4
    if (hits > 0) {
      raw[o] = Math.round(r / hits)
      raw[o + 1] = Math.round(g / hits)
      raw[o + 2] = Math.round(b / hits)
      raw[o + 3] = Math.round((hits / (SAMPLES * SAMPLES)) * 255)
    }
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(bytes) {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

const header = Buffer.alloc(13)
header.writeUInt32BE(SIZE, 0)
header.writeUInt32BE(SIZE, 4)
header[8] = 8 // bit depth
header[9] = 6 // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'icon.png')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`Wrote ${out} (${png.length} bytes)`)

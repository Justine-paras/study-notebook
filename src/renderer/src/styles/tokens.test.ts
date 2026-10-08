// Guards the token contract: components build var() names from NotebookColor
// and MasteryState, so every combination must exist in both themes.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NOTEBOOK_COLORS } from '@shared/types'

const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8')
const [shared = '', light = '', dark = ''] = css.split(/^:root,\s*\n:root\[data-theme='light'\] \{|^:root\[data-theme='dark'\] \{/m)
const MASTERY = ['not-started', 'learning', 'weak', 'reviewing', 'mastered']

describe('design tokens', () => {
  it('defines every notebook cover color once', () => {
    for (const color of NOTEBOOK_COLORS) expect(shared).toContain(`--nb-${color}:`)
  })

  it('defines tints and inks for every notebook color in both themes', () => {
    for (const block of [light, dark]) {
      for (const color of NOTEBOOK_COLORS) {
        expect(block).toContain(`--nb-${color}-tint:`)
        expect(block).toContain(`--nb-${color}-ink:`)
      }
    }
  })

  it('defines mastery colors in both themes', () => {
    for (const block of [light, dark]) {
      for (const state of MASTERY) {
        for (const part of ['bg', 'fg', 'ink']) expect(block).toContain(`--mastery-${state}-${part}:`)
      }
    }
  })

  it('redefines every light color token for dark mode', () => {
    const names = (block: string) => new Set([...block.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]))
    const missing = [...names(light)].filter((name) => !names(dark).has(name))
    expect(missing).toEqual([])
  })
})

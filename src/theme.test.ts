/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Vitest hands CSS imports back empty, so the stylesheet is read from disk.
const css = readFileSync(`${process.cwd()}/src/index.css`, 'utf8')

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  const body = css.slice(start, css.indexOf('}', start))
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]))
}

function tokensOf(theme: 'light' | 'dark'): Record<string, string> {
  const light = block(':root')
  return theme === 'light' ? light : { ...light, ...block(":root[data-theme='dark']") }
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const PAIRS: [string, string][] = [
  ['--foreground', '--background'],
  ['--foreground', '--card'],
  ['--ink-2', '--card'],
  ['--muted-foreground', '--card'],
  ['--muted-foreground', '--background'],
  ['--muted-foreground', '--muted'],
  ['--placeholder', '--card'],
  ['--primary-foreground', '--primary'],
  ['--primary-ink', '--primary-soft'],
  ['--primary', '--card'],
  ['--gain', '--card'],
  ['--gain-ink', '--gain-soft'],
  ['--loss', '--card'],
  ['--loss', '--loss-soft'],
  ['--fx', '--card'],
  ['--fx', '--fx-soft'],
  ['--warning-fg', '--warning-bg'],
  ['--destructive', '--destructive-bg'],
  ['--board-muted', '--board'],
  ['--board-mine', '--board'],
  ['--board-gain', '--board'],
  ['--board-loss', '--board'],
  ['--board-fx', '--board'],
]

describe('theme tokens', () => {
  it.each(['light', 'dark'] as const)('keeps text readable in the %s theme (4.5:1)', (theme) => {
    const tokens = tokensOf(theme)
    const failing = PAIRS.filter(([fg, bg]) => contrast(tokens[fg], tokens[bg]) < 4.5).map(
      ([fg, bg]) => `${fg} on ${bg}: ${contrast(tokens[fg], tokens[bg]).toFixed(2)}`,
    )
    expect(failing).toEqual([])
  })

  it('gives the dark theme a value for every token it changes, and only known tokens', () => {
    const light = block(':root')
    const dark = block(":root[data-theme='dark']")
    expect(Object.keys(dark).every((name) => name in light)).toBe(true)
  })
})

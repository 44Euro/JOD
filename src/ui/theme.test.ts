import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { THEME_STORAGE_KEY, resolveTheme, useThemeSync } from './theme'

function systemTheme(dark: boolean) {
  const listeners = new Set<() => void>()
  const media = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }
  vi.stubGlobal('matchMedia', () => media)
  return {
    set(next: boolean) {
      media.matches = next
      listeners.forEach((fn) => fn())
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
  localStorage.clear()
})

describe('theme', () => {
  it('resolves a choice against the system setting', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('follows the system while set to system', () => {
    const system = systemTheme(false)
    const { rerender } = renderHook(({ choice }) => useThemeSync(choice), { initialProps: { choice: 'system' as const } as { choice: 'system' | 'light' } })
    expect(document.documentElement.dataset.theme).toBe('light')
    system.set(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
    rerender({ choice: 'light' })
    system.set(true)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('remembers the choice for the next launch', () => {
    systemTheme(false)
    renderHook(() => useThemeSync('dark'))
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('leaves the opening theme alone until the settings have loaded', () => {
    systemTheme(false)
    document.documentElement.dataset.theme = 'dark'
    renderHook(() => useThemeSync(null))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })
})

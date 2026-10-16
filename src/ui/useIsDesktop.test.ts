import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useIsDesktop } from './useIsDesktop'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useIsDesktop', () => {
  it('falls back to the desktop layout when matchMedia is missing', () => {
    expect(renderHook(() => useIsDesktop()).result.current).toBe(true)
  })

  it('follows the screen width', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    expect(renderHook(() => useIsDesktop()).result.current).toBe(false)
  })
})

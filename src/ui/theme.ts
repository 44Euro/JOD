import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { useEffect } from 'react'
import type { ThemeChoice } from '../domain/types'
import { useAppData } from './hooks'
import { t } from '../i18n'

export const THEME_LABELS: Record<ThemeChoice, string> = { light: t('สว่าง'), dark: t('มืด'), system: t('ตามระบบ') }

// Read by the script in index.html before the first paint, so a dark-theme user never sees a light flash.
export const THEME_STORAGE_KEY = 'jod-theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'
const THEME_COLORS = { light: '#f5f2eb', dark: '#0a1424' } as const

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'light' | 'dark' {
  return choice === 'system' ? (prefersDark ? 'dark' : 'light') : choice
}

// Board screens open before the settings load, so the theme applied afterwards must not turn their icons dark again.
let boardScreens = 0

export function applyTheme(resolved: 'light' | 'dark'): void {
  const root = document.documentElement
  root.dataset.theme = resolved
  root.style.colorScheme = resolved
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[resolved])
  // In the phone apps the clock and battery icons follow the theme: dark text on the light page, light on the dark one.
  if (Capacitor.isNativePlatform()) void StatusBar.setStyle({ style: resolved === 'dark' || boardScreens > 0 ? Style.Dark : Style.Light }).catch(() => {})
}

function prefersDark(): boolean {
  return typeof globalThis.matchMedia === 'function' && globalThis.matchMedia(DARK_QUERY).matches
}

// null while the settings are still loading: the theme the page opened with (set by index.html) stays until they arrive.
export function useThemeSync(choice: ThemeChoice | null): void {
  useEffect(() => {
    if (choice === null) return
    applyTheme(resolveTheme(choice, prefersDark()))
    try {
      localStorage.setItem(THEME_STORAGE_KEY, choice)
    } catch {
      // Private windows can refuse storage; the theme still applies, the next launch may just start light.
    }
    if (choice !== 'system' || typeof globalThis.matchMedia !== 'function') return
    const media = globalThis.matchMedia(DARK_QUERY)
    const follow = () => applyTheme(resolveTheme('system', media.matches))
    media.addEventListener('change', follow)
    return () => media.removeEventListener('change', follow)
  }, [choice])
}

export function ThemeSync() {
  const data = useAppData()
  useThemeSync(data ? (data.settings.theme ?? 'system') : null)
  return null
}

// A screen that opens on the navy rate board asks for the strip behind the status bar to match it, with light icons.
export function useBoardStatusBar(): void {
  useEffect(() => {
    const root = document.documentElement
    boardScreens += 1
    root.style.setProperty('--status-strip', 'var(--board)')
    if (Capacitor.isNativePlatform()) void StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
    return () => {
      boardScreens -= 1
      if (boardScreens === 0) root.style.removeProperty('--status-strip')
      applyTheme(root.dataset.theme === 'dark' ? 'dark' : 'light')
    }
  }, [])
}

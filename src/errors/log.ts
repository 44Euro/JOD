import { useSyncExternalStore } from 'react'

// Problems are kept on this device only. An entry holds what went wrong and where in the code, never the user's
// records or amounts, so a report can be passed on without exposing the portfolio. Nothing is sent anywhere.
export const ERROR_LOG_KEY = 'jod-errors'
const MAX_ENTRIES = 50

export interface ErrorEntry {
  at: string
  message: string
  stack: string
  page: string
}

const listeners = new Set<() => void>()
let cache: ErrorEntry[] | null = null

export function readErrors(): ErrorEntry[] {
  if (cache) return cache
  try {
    cache = JSON.parse(localStorage.getItem(ERROR_LOG_KEY) ?? '[]') as ErrorEntry[]
  } catch {
    cache = []
  }
  return cache
}

function save(entries: ErrorEntry[]) {
  cache = entries
  try {
    localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(entries))
  } catch {
    // A full or blocked storage keeps the log for this visit only.
  }
  listeners.forEach((l) => l())
}

// Digits in a message can be amounts ("ขาย 5 หน่วย แต่ถืออยู่ 3"), so they are blanked out.
export function scrub(text: string): string {
  return text.replace(/\d[\d,.]*/g, '#')
}

export function logError(error: unknown, page: string = typeof location === 'undefined' ? '' : location.hash || '/', now = new Date()) {
  const err = error instanceof Error ? error : new Error(String(error))
  const stack = (err.stack ?? '')
    .split('\n')
    .slice(1, 8)
    .map((line) => line.trim())
    .join('\n')
  const entry: ErrorEntry = { at: now.toISOString(), message: scrub(`${err.name}: ${err.message}`).slice(0, 300), stack, page: page.replace(/\/assets\/[^/?#]+/, '/assets/…').replace(/\/transactions\/[0-9a-f-]{8,}/, '/transactions/…') }
  save([entry, ...readErrors()].slice(0, MAX_ENTRIES))
}

export function clearErrors() {
  save([])
}

export function errorReport(entries: readonly ErrorEntry[], userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  const lines = [`JOD error report · ${new Date().toISOString()}`, `Browser: ${userAgent}`, '']
  for (const e of entries) lines.push(`[${e.at}] ${e.page}`, e.message, e.stack, '')
  return lines.join('\n')
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useErrors(): ErrorEntry[] {
  return useSyncExternalStore(subscribe, readErrors)
}

export function installErrorCapture() {
  window.addEventListener('error', (event) => logError(event.error ?? event.message))
  window.addEventListener('unhandledrejection', (event) => logError(event.reason))
}

export function resetErrorsForTests() {
  cache = null
  try {
    localStorage.removeItem(ERROR_LOG_KEY)
  } catch {
    // nothing to reset
  }
}

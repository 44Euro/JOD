import { useSyncExternalStore } from 'react'
import { READER_MODES, type ReaderMode } from './reader'

// Kept in localStorage rather than the database, so neither ends up in a backup file.
export const API_KEY_STORAGE_KEY = 'jod-anthropic-key'
export const READER_MODE_STORAGE_KEY = 'jod-ai-reader'

const listeners = new Set<() => void>()

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function write(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // Storage blocked: the choice lasts only until the page closes, which the user will notice and can live with.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Keys of the user's own price sources and on/off switches that belong to this device only.
export const FINNHUB_KEY_STORAGE_KEY = 'jod-finnhub-key'
export const COINGECKO_KEY_STORAGE_KEY = 'jod-coingecko-key'
export const AUTO_PRICES_STORAGE_KEY = 'jod-auto-prices'

export function readLocal(key: string): string {
  return read(key)
}

export function writeLocal(key: string, value: string): void {
  write(key, value)
}

export function useLocal(key: string): string {
  return useSyncExternalStore(subscribe, () => read(key))
}

export function readApiKey(): string {
  return read(API_KEY_STORAGE_KEY)
}

export function writeApiKey(key: string): void {
  write(API_KEY_STORAGE_KEY, key)
}

export function useApiKey(): string {
  return useSyncExternalStore(subscribe, readApiKey)
}

// Reading on the device is the default: it costs nothing and nothing leaves the device.
export function readReaderMode(): ReaderMode {
  const stored = read(READER_MODE_STORAGE_KEY)
  return READER_MODES.includes(stored as ReaderMode) ? (stored as ReaderMode) : 'local'
}

export function writeReaderMode(mode: ReaderMode): void {
  write(READER_MODE_STORAGE_KEY, mode === 'local' ? '' : mode)
}

export function useReaderMode(): ReaderMode {
  return useSyncExternalStore(subscribe, readReaderMode)
}

export function maskApiKey(key: string): string {
  return key.length <= 12 ? '••••' : `${key.slice(0, 7)}…${key.slice(-4)}`
}

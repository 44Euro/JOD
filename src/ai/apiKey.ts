import { useSyncExternalStore } from 'react'
import type { ProviderSettings } from './otherReaders'
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

const PROVIDER_DEFAULTS: Record<Exclude<ReaderMode, 'local' | 'claude'>, { model: string; baseUrl: string }> = {
  openai: { model: 'gpt-4.1', baseUrl: '' },
  gemini: { model: 'gemini-2.5-flash', baseUrl: '' },
  compatible: { model: '', baseUrl: '' },
}

const providerKey = (mode: ReaderMode) => `jod-ai-${mode}`

// Key, model and address of a provider other than Claude, kept on this device like the Claude key.
export function readProviderSettings(mode: ReaderMode): ProviderSettings {
  if (mode === 'local') return { apiKey: '', model: '' }
  if (mode === 'claude') return { apiKey: readApiKey(), model: 'claude-opus-5-5' }
  const defaults = PROVIDER_DEFAULTS[mode]
  try {
    const stored = JSON.parse(read(providerKey(mode)) || '{}') as Partial<ProviderSettings>
    return { apiKey: stored.apiKey ?? '', model: stored.model || defaults.model, baseUrl: stored.baseUrl ?? defaults.baseUrl }
  } catch {
    return { apiKey: '', model: defaults.model, baseUrl: defaults.baseUrl }
  }
}

export function writeProviderSettings(mode: ReaderMode, settings: ProviderSettings): void {
  if (mode === 'claude') return writeApiKey(settings.apiKey)
  if (mode === 'local') return
  write(providerKey(mode), JSON.stringify(settings))
}

export function useProviderSettings(mode: ReaderMode): ProviderSettings {
  const raw = useSyncExternalStore(subscribe, () => (mode === 'claude' ? readApiKey() : read(providerKey(mode))))
  // raw only drives the re-render; the parsed value is rebuilt from storage.
  void raw
  return readProviderSettings(mode)
}

// A provider is ready when it has what it needs to be called: a key, and for a compatible service an address and model.
export function providerReady(mode: ReaderMode, settings: ProviderSettings): boolean {
  if (mode === 'local') return true
  if (mode === 'compatible') return Boolean(settings.baseUrl && settings.model)
  return Boolean(settings.apiKey && settings.model)
}

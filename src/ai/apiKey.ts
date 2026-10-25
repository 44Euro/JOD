import { useSyncExternalStore } from 'react'

// Kept in localStorage rather than the database, so it never ends up in a backup file.
export const API_KEY_STORAGE_KEY = 'jod-anthropic-key'

const listeners = new Set<() => void>()

export function readApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function writeApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(API_KEY_STORAGE_KEY, key)
    else localStorage.removeItem(API_KEY_STORAGE_KEY)
  } catch {
    // Storage blocked: the key lasts only until the page closes, which the user will notice and can live with.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useApiKey(): string {
  return useSyncExternalStore(subscribe, readApiKey)
}

export function maskApiKey(key: string): string {
  return key.length <= 12 ? '••••' : `${key.slice(0, 7)}…${key.slice(-4)}`
}

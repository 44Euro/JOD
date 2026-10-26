import { useSyncExternalStore } from 'react'

// Device-only: where to sync, the session, and the key that seals the data. None of it is in a backup.
export const SYNC_STORAGE_KEY = 'jod-sync'
export const DIRTY_STORAGE_KEY = 'jod-sync-dirty'

export interface SyncState {
  server: string
  email: string
  token: string
  dataKey: string
  version: number
  syncedAt: string | null
  // A new recovery code waits here until the person says it is written down; the app never shows it again after.
  recoveryCode?: string
}

const listeners = new Set<() => void>()
let cachedRaw: string | null | undefined
let cached: SyncState | null = null

function rawOf(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function readSync(): SyncState | null {
  const raw = rawOf(SYNC_STORAGE_KEY)
  if (raw !== cachedRaw) {
    cachedRaw = raw
    try {
      cached = raw ? (JSON.parse(raw) as SyncState) : null
    } catch {
      cached = null
    }
  }
  return cached
}

function notify() {
  listeners.forEach((l) => l())
}

export function writeSync(state: SyncState | null) {
  try {
    if (state) localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(state))
    else localStorage.removeItem(SYNC_STORAGE_KEY)
  } catch {
    // Without storage the device cannot stay signed in.
  }
  notify()
}

export function isDirty(): boolean {
  return rawOf(DIRTY_STORAGE_KEY) !== null
}

export function setDirty(dirty: boolean) {
  try {
    if (dirty) localStorage.setItem(DIRTY_STORAGE_KEY, new Date().toISOString())
    else localStorage.removeItem(DIRTY_STORAGE_KEY)
  } catch {
    // A lost flag only means the next sync compares versions alone.
  }
  notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSyncState() {
  return useSyncExternalStore(subscribe, readSync)
}

export function useDirty() {
  return useSyncExternalStore(subscribe, isDirty)
}

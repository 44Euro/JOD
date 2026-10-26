import { useSyncExternalStore } from 'react'

// Device-only: where to sync, the session, and the key that seals the data. None of it is in a backup.
export const SYNC_STORAGE_KEY = 'jod-sync'
// Records changed on this device and not yet sent, each with when it last changed.
export const PENDING_STORAGE_KEY = 'jod-sync-pending'
// Version 2 syncs record by record; state from the earlier whole-copy sync is treated as a first sync.
export const SYNC_PROTOCOL = 2

export interface SyncState {
  server: string
  email: string
  token: string
  dataKey: string
  // The last change number this device has pulled from the account.
  version: number
  syncedAt: string | null
  protocol?: number
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

export type PendingChanges = Record<string, string>

let pendingRaw: string | null | undefined
let pending: PendingChanges = {}

export function pendingChanges(): PendingChanges {
  const raw = rawOf(PENDING_STORAGE_KEY)
  if (raw !== pendingRaw) {
    pendingRaw = raw
    try {
      pending = raw ? (JSON.parse(raw) as PendingChanges) : {}
    } catch {
      pending = {}
    }
  }
  return pending
}

function savePending(next: PendingChanges) {
  try {
    if (Object.keys(next).length > 0) localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(next))
    else localStorage.removeItem(PENDING_STORAGE_KEY)
  } catch {
    // A lost list only means those records wait for their next change to be sent.
  }
  notify()
}

export function pendingKey(kind: string, id: string) {
  return `${kind}:${id}`
}

export function markChanged(kind: string, id: string, now = new Date()) {
  savePending({ ...pendingChanges(), [pendingKey(kind, id)]: now.toISOString() })
}

// Drops what was sent, except records changed again while it was being sent: those still wait.
export function clearPending(sent?: PendingChanges) {
  if (!sent) return savePending({})
  const left = { ...pendingChanges() }
  for (const [key, stamp] of Object.entries(sent)) if (left[key] === stamp) delete left[key]
  savePending(left)
}

export function isDirty(): boolean {
  return Object.keys(pendingChanges()).length > 0
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

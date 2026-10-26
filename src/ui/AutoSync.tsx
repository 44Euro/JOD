import { useEffect } from 'react'
import { db } from '../db/db'
import { createSyncClient } from '../sync/client'
import { syncNow } from '../sync/engine'
import { useDirty, useSyncState } from '../sync/state'

const AFTER_CHANGE_MS = 20_000

// Syncs when the app opens and a little after each change, quietly: a conflict or a failure waits for the user in
// the settings card, where they can decide.
export function AutoSync() {
  const state = useSyncState()
  const dirty = useDirty()
  const signedIn = state !== null
  const server = state?.server

  useEffect(() => {
    if (!signedIn || !server) return
    void syncNow(db, createSyncClient(server)).catch(() => {})
  }, [signedIn, server])

  useEffect(() => {
    if (!signedIn || !server || !dirty) return
    const timer = setTimeout(() => void syncNow(db, createSyncClient(server)).catch(() => {}), AFTER_CHANGE_MS)
    return () => clearTimeout(timer)
  }, [signedIn, server, dirty])

  return null
}

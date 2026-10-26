import { db } from '../db/db'
import { clearLock } from '../security/lock'
import { createSyncClient, type SyncClient } from './client'
import { deriveKeys, resolveConflict, syncNow, type SyncOutcome } from './engine'
import { readSync, setDirty, writeSync } from './state'

// The address of the sync server is fixed when the app is built (VITE_SYNC_SERVER); people only see email and password.
let server: string = (import.meta.env.VITE_SYNC_SERVER as string | undefined) ?? 'http://localhost:8787'

export function setSyncServerForTests(url: string) {
  server = url
}

export const MIN_PASSWORD = 10

export function serverClient(): SyncClient {
  return createSyncClient(readSync()?.server ?? server)
}

let bypass = false

// The page tests render screens directly; this lets them skip the sign-in in front of every page.
export function setAuthBypassForTests(value: boolean) {
  bypass = value
}

export function authBypassed() {
  return bypass
}

export async function signIn(mode: 'login' | 'signup', email: string, password: string): Promise<SyncOutcome> {
  const client = createSyncClient(server)
  const keys = await deriveKeys(email, password)
  const address = email.trim().toLowerCase()
  const token = mode === 'signup' ? await client.signup(address, keys.loginKey) : await client.login(address, keys.loginKey)
  writeSync({ server, email: address, token, dataKey: keys.dataKey, version: 0, syncedAt: null })
  return syncNow(db, client)
}

export function keepSide(side: 'device' | 'server') {
  return resolveConflict(db, serverClient(), side)
}

// Everything is on the server before the device forgets it; when the last changes cannot be sent, signing out waits
// unless the user accepts losing them.
export async function signOut(force = false): Promise<'done' | 'unsent'> {
  const state = readSync()
  if (state && !force) {
    const outcome = await syncNow(db, serverClient()).catch(() => null)
    if (!outcome || outcome.kind === 'conflict') return 'unsent'
  }
  if (state) await serverClient().logout(state.token)
  await clearDevice()
  return 'done'
}

export async function deleteAccount(): Promise<void> {
  const state = readSync()
  if (state) await serverClient().deleteAccount(state.token)
  await clearDevice()
}

async function clearDevice() {
  await db.transaction('rw', [db.accounts, db.instruments, db.transactions, db.settings, db.dailyValues, db.imports, db.plans, db.watchlist, db.pictures], () =>
    Promise.all([db.accounts, db.instruments, db.transactions, db.settings, db.dailyValues, db.imports, db.plans, db.watchlist, db.pictures].map((t) => t.clear())),
  )
  writeSync(null)
  setDirty(false)
  clearLock()
}

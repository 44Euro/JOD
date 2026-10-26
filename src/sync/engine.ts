import { exportBackup, parseBackup, restoreBackup } from '../db/backup'
import type { JodDB } from '../db/db'
import { asEncrypted, decryptText, encryptText, keyIterations } from '../security/crypto'
import type { SyncClient } from './client'
import { isDirty, readSync, setDirty, writeSync, type SyncState } from './state'

const SYNC_SALT_ITERATIONS = 1000

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// One password, two keys: the login key goes to the server, the data key never leaves the device, so the server
// cannot open what it stores. The email salts both, so the same password gives different keys for different people.
export async function deriveKeys(email: string, password: string, iterations = keyIterations()): Promise<{ loginKey: string; dataKey: string }> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const derive = (purpose: string) =>
    crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(`jod-${purpose}:${email.trim().toLowerCase()}`), iterations },
      material,
      256,
    )
  return { loginKey: hex(await derive('login')), dataKey: hex(await derive('data')) }
}

let applying = false

// Changes written while a pulled copy is put in place are not the user's, so they must not mark the device as changed.
export function isApplyingRemote() {
  return applying
}

async function seal(db: JodDB, dataKey: string): Promise<string> {
  return JSON.stringify(await encryptText(JSON.stringify(await exportBackup(db)), dataKey, SYNC_SALT_ITERATIONS))
}

async function apply(db: JodDB, data: string, dataKey: string) {
  const sealed = asEncrypted(JSON.parse(data))
  if (!sealed) throw new Error('not sealed')
  const backup = parseBackup(await decryptText(sealed, dataKey))
  applying = true
  try {
    await restoreBackup(db, backup)
  } finally {
    applying = false
  }
}

export type SyncOutcome =
  | { kind: 'up-to-date' }
  | { kind: 'pushed'; version: number }
  | { kind: 'pulled'; version: number }
  | { kind: 'conflict'; remoteVersion: number }

// Two syncs at once (the automatic one and a tap) would both build on the same version and one would be refused as a
// conflict, so they run one after the other.
let queue: Promise<unknown> = Promise.resolve()

function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work)
  queue = next.catch(() => {})
  return next
}

function saved(state: SyncState, version: number, now: Date) {
  writeSync({ ...state, version, syncedAt: now.toISOString() })
  setDirty(false)
}

// The device remembers the version it last matched. Only one side changed: that side wins. Both changed: the user
// picks, since merging two edited ledgers by record could keep a sale while dropping the buy it needs.
export function syncNow(db: JodDB, client: SyncClient, now: Date = new Date()): Promise<SyncOutcome> {
  return oneAtATime(() => syncOnce(db, client, now))
}

async function syncOnce(db: JodDB, client: SyncClient, now: Date): Promise<SyncOutcome> {
  const state = readSync()
  if (!state) throw new Error('not signed in')
  const remote = await client.pull(state.token)
  const changedHere = isDirty() || state.syncedAt === null
  if (remote.version === state.version || remote.data === null) {
    if (!changedHere && remote.data !== null) return { kind: 'up-to-date' }
    const result = await client.push(state.token, remote.version, await seal(db, state.dataKey))
    if ('conflict' in result) return { kind: 'conflict', remoteVersion: result.conflict }
    saved(state, result.version, now)
    return { kind: 'pushed', version: result.version }
  }
  if (changedHere && state.syncedAt !== null) return { kind: 'conflict', remoteVersion: remote.version }
  if (changedHere && state.syncedAt === null && !(await isEmpty(db))) return { kind: 'conflict', remoteVersion: remote.version }
  await apply(db, remote.data, state.dataKey)
  saved(state, remote.version, now)
  return { kind: 'pulled', version: remote.version }
}

async function isEmpty(db: JodDB) {
  return (await db.transactions.count()) === 0 && (await db.accounts.count()) === 0
}

export function resolveConflict(db: JodDB, client: SyncClient, keep: 'device' | 'server', now: Date = new Date()): Promise<SyncOutcome> {
  return oneAtATime(() => resolveOnce(db, client, keep, now))
}

async function resolveOnce(db: JodDB, client: SyncClient, keep: 'device' | 'server', now: Date): Promise<SyncOutcome> {
  const state = readSync()
  if (!state) throw new Error('not signed in')
  const remote = await client.pull(state.token)
  if (keep === 'server' && remote.data !== null) {
    await apply(db, remote.data, state.dataKey)
    saved(state, remote.version, now)
    return { kind: 'pulled', version: remote.version }
  }
  const result = await client.push(state.token, remote.version, await seal(db, state.dataKey))
  if ('conflict' in result) return { kind: 'conflict', remoteVersion: result.conflict }
  saved(state, result.version, now)
  return { kind: 'pushed', version: result.version }
}

export function installDirtyTracking(db: JodDB) {
  const mark = () => {
    if (!applying) setDirty(true)
  }
  for (const table of [db.accounts, db.instruments, db.transactions, db.settings, db.dailyValues, db.imports, db.plans, db.watchlist]) {
    table.hook('creating', mark)
    table.hook('updating', mark)
    table.hook('deleting', mark)
  }
}

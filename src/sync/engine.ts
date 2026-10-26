import type Dexie from 'dexie'
import type { JodDB } from '../db/db'
import { asEncrypted, decryptText, encryptText, keyIterations } from '../security/crypto'
import type { SyncClient, SyncRecord } from './client'
import { clearPending, markChanged, pendingChanges, pendingKey, readSync, SYNC_PROTOCOL, writeSync, type SyncState } from './state'

// Each record is sealed with the data key, which is long and random already, so a light key-stretch is enough.
const SEAL_ITERATIONS = 1000
// Kept under the server's request limit even when pictures are in the batch.
const BATCH_CHARS = 8_000_000
const BATCH_RECORDS = 500

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// One password, two keys: the login key goes to the server, the password key never leaves the device and only unseals
// the data key, so the server cannot open what it stores. The email salts both, so the same password gives different
// keys for different people. Accounts made before the data key was sealed used the password key as the data key.
export async function deriveKeys(email: string, password: string, iterations = keyIterations()): Promise<{ loginKey: string; passwordKey: string }> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const derive = (purpose: string) =>
    crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(`jod-${purpose}:${email.trim().toLowerCase()}`), iterations },
      material,
      256,
    )
  return { loginKey: hex(await derive('login')), passwordKey: hex(await derive('data')) }
}

// Every table the app keeps for the person, and the kind each record has on the server. Exchange rates are a cache
// that every device fetches for itself, so they are not synced.
const KINDS = {
  accounts: 'account',
  instruments: 'instrument',
  transactions: 'transaction',
  settings: 'setting',
  dailyValues: 'daily_value',
  imports: 'import',
  plans: 'plan',
  watchlist: 'watch',
  pictures: 'picture',
} as const

type TableName = keyof typeof KINDS
const TABLES = Object.keys(KINDS) as TableName[]
const TABLE_OF = Object.fromEntries(TABLES.map((t) => [KINDS[t], t])) as Record<string, TableName>

let applying = false

function table(db: JodDB, name: TableName) {
  return db[name] as unknown as Dexie.Table<Record<string, unknown>, string>
}

function readBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = await readBytes(blob)
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

function fromBase64(data: string, type: string): Blob {
  return new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type })
}

// Checked by shape: a Blob read back from IndexedDB is not always an instance of this window's Blob.
function isBlob(value: unknown): value is Blob {
  if (typeof value !== 'object' || value === null) return false
  const blob = value as Blob
  return typeof blob.size === 'number' && typeof blob.type === 'string' && typeof blob.slice === 'function'
}

export async function sealRecord(name: TableName, row: Record<string, unknown>, dataKey: string): Promise<string> {
  const plain = name === 'pictures' && isBlob(row.blob) ? { ...row, blob: { type: row.blob.type, data: await toBase64(row.blob) } } : row
  return JSON.stringify(await encryptText(JSON.stringify(plain), dataKey, SEAL_ITERATIONS))
}

export async function openRecord(name: TableName, sealed: string, dataKey: string): Promise<Record<string, unknown>> {
  const file = asEncrypted(JSON.parse(sealed))
  if (!file) throw new Error('not sealed')
  const row = JSON.parse(await decryptText(file, dataKey)) as Record<string, unknown>
  const blob = row.blob as { type?: unknown; data?: unknown } | undefined
  if (name === 'pictures' && typeof blob?.data === 'string') return { ...row, blob: fromBase64(blob.data, String(blob.type ?? '')) }
  return row
}

export type SyncOutcome = { kind: 'up-to-date' } | { kind: 'pushed'; count: number } | { kind: 'pulled'; count: number }

// Two syncs at once (the automatic one and a tap) would send the same changes twice, so they run one after the other.
let queue: Promise<unknown> = Promise.resolve()

function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work)
  queue = next.catch(() => {})
  return next
}

// Built on what is stored now rather than the copy read when the sync began: the person may have changed it meanwhile,
// such as confirming the recovery code while the first sync was still running.
function saved(state: SyncState, version: number, now: Date) {
  writeSync({ ...(readSync() ?? state), version, syncedAt: now.toISOString(), protocol: SYNC_PROTOCOL })
}

// Record by record: first take what other devices sent since the last number seen, skipping records this device has
// changed and not sent yet, then send those. Two devices editing different records both keep their edits; when both
// edited the same record, the one sent last stays.
export function syncNow(db: JodDB, client: SyncClient, now: Date = new Date()): Promise<SyncOutcome> {
  return oneAtATime(() => syncOnce(db, client, now))
}

async function syncOnce(db: JodDB, client: SyncClient, now: Date): Promise<SyncOutcome> {
  const state = readSync()
  if (!state) throw new Error('not signed in')
  // On a device's first sync, whatever it already holds joins the account rather than being lost or overwritten.
  const first = state.syncedAt === null || state.protocol !== SYNC_PROTOCOL
  if (first) await markEverything(db)
  let after = first ? 0 : state.version
  let pulled = 0
  let count = 0
  for (;;) {
    const page = await client.pullRecords(state.token, after)
    const waiting = pendingChanges()
    for (const record of page.records) {
      if (!waiting[pendingKey(record.kind, record.id)] && (await applyRecord(db, record, state.dataKey))) pulled += 1
    }
    after = page.more ? page.records[page.records.length - 1].change : Math.max(after, page.change)
    count = page.change
    if (!page.more) break
  }
  const pushed = await pushPending(db, client, state, (change, sent) => {
    // When nothing else was written between the pull and this push, the numbers just used are all this device's own
    // records, so the next pull can start after them instead of fetching them back.
    if (change === count + sent && after === count) after = change
    count = change
  })
  saved(state, after, now)
  if (pulled > 0) return { kind: 'pulled', count: pulled }
  if (pushed > 0) return { kind: 'pushed', count: pushed }
  return { kind: 'up-to-date' }
}

async function applyRecord(db: JodDB, record: SyncRecord, dataKey: string): Promise<boolean> {
  const name = TABLE_OF[record.kind]
  if (!name) return false
  applying = true
  try {
    if (record.sealed === null) await table(db, name).delete(record.id)
    else await table(db, name).put(await openRecord(name, record.sealed, dataKey))
  } finally {
    applying = false
  }
  return true
}

async function pushPending(db: JodDB, client: SyncClient, state: SyncState, onPushed: (change: number, sent: number) => void): Promise<number> {
  const sent = { ...pendingChanges() }
  const keys = Object.keys(sent)
  let batch: SyncRecord[] = []
  let size = 0
  const flush = async () => {
    if (batch.length > 0) onPushed(await client.pushRecords(state.token, batch), batch.length)
    batch = []
    size = 0
  }
  for (const key of keys) {
    const split = key.indexOf(':')
    const kind = key.slice(0, split)
    const id = key.slice(split + 1)
    const name = TABLE_OF[kind]
    if (!name) continue
    const row = await table(db, name).get(id)
    const sealed = row ? await sealRecord(name, row, state.dataKey) : null
    if (batch.length >= BATCH_RECORDS || (batch.length > 0 && size + (sealed?.length ?? 0) > BATCH_CHARS)) await flush()
    batch.push({ kind, id, sealed })
    size += sealed?.length ?? 0
  }
  await flush()
  clearPending(sent)
  return keys.length
}

async function markEverything(db: JodDB) {
  for (const name of TABLES) {
    for (const key of await table(db, name).toCollection().primaryKeys()) markChanged(KINDS[name], String(key))
  }
}

export function installDirtyTracking(db: JodDB) {
  for (const name of TABLES) {
    const mark = (key: unknown) => {
      if (!applying && key !== undefined) markChanged(KINDS[name], String(key))
    }
    const t = table(db, name)
    t.hook('creating', (key, row) => mark(key ?? row[t.schema.primKey.keyPath as string]))
    t.hook('updating', (_mods, key) => mark(key))
    t.hook('deleting', (key) => mark(key))
  }
}

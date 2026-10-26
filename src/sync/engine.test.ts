import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../server/app.ts'
import { createTestStore } from '../../server/testStore.ts'
import { exportBackup, restoreBackup } from '../db/backup'
import { createDb, type JodDB } from '../db/db'
import { makeTx } from '../test/fixtures'
import { createSyncClient, type SyncClient } from './client'
import { deriveKeys, installDirtyTracking, openRecord, sealRecord, syncNow } from './engine'
import { clearPending, isDirty, pendingChanges, readSync, SYNC_PROTOCOL, writeSync, type PendingChanges, type SyncState } from './state'

let server: Server
let base = ''
const account = { id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' }

beforeEach(async () => {
  server = createServer(createApp({ store: await createTestStore() }))
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  writeSync(null)
  clearPending()
})

afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())))

// Two devices share this test's localStorage, so each keeps its own sync state and pending list and swaps them in.
function device(db: JodDB) {
  let state: SyncState | null = null
  let waiting: PendingChanges = {}
  installDirtyTracking(db)
  return {
    db,
    use() {
      writeSync(state)
      clearPending()
      localStorage.setItem('jod-sync-pending', JSON.stringify(waiting))
    },
    keep() {
      state = readSync()
      waiting = { ...pendingChanges() }
    },
  }
}

async function account2(client: SyncClient) {
  const keys = await deriveKeys('a@x.io', 'pw', 1000)
  const token = await client.signup('a@x.io', keys.loginKey)
  return { server: base, email: 'a@x.io', token, dataKey: keys.passwordKey, version: 0, syncedAt: null }
}

const ids = async (db: JodDB) => (await db.transactions.toArray()).map((t) => t.id).sort()

describe('sync', () => {
  it('derives a login key and a separate password key from one password', async () => {
    const a = await deriveKeys('A@x.io', 'pw', 1000)
    const b = await deriveKeys('a@x.io', 'pw', 1000)
    expect(a).toEqual(b)
    expect(a.loginKey).not.toBe(a.passwordKey)
    expect(a.loginKey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('carries records from one device to another, the server holding one sealed row per record', async () => {
    const client = createSyncClient(base)
    const signedIn = await account2(client)
    const one = device(createDb(`test-${crypto.randomUUID()}`))
    const two = device(createDb(`test-${crypto.randomUUID()}`))

    one.use()
    writeSync(signedIn)
    await one.db.accounts.add(account)
    await one.db.transactions.add(makeTx({ id: 'first' }))
    expect(await syncNow(one.db, client)).toEqual({ kind: 'pushed', count: 2 })
    expect(isDirty()).toBe(false)
    const stored = await client.pullRecords(signedIn.token, 0)
    expect(stored.records.map((r) => `${r.kind}:${r.id}`).sort()).toEqual(['account:acc-1', 'transaction:first'])
    expect(JSON.stringify(stored)).not.toContain('Dime US')
    one.keep()

    two.use()
    writeSync(signedIn)
    expect(await syncNow(two.db, client)).toEqual({ kind: 'pulled', count: 2 })
    expect(await ids(two.db)).toEqual(['first'])
    expect(isDirty()).toBe(false)
    await two.db.transactions.add(makeTx({ id: 'second' }))
    await two.db.transactions.delete('first')
    expect(await syncNow(two.db, client)).toEqual({ kind: 'pushed', count: 2 })
    two.keep()

    one.use()
    expect(await syncNow(one.db, client)).toEqual({ kind: 'pulled', count: 2 })
    expect(await ids(one.db)).toEqual(['second'])
    expect(readSync()!.protocol).toBe(SYNC_PROTOCOL)
  })

  it('keeps edits from both devices when they changed different records', async () => {
    const client = createSyncClient(base)
    const signedIn = await account2(client)
    const one = device(createDb(`test-${crypto.randomUUID()}`))
    const two = device(createDb(`test-${crypto.randomUUID()}`))
    one.use()
    writeSync(signedIn)
    await one.db.accounts.add(account)
    await syncNow(one.db, client)
    one.keep()
    two.use()
    writeSync(signedIn)
    await syncNow(two.db, client)
    await two.db.transactions.add(makeTx({ id: 'from-two' }))
    await syncNow(two.db, client)
    two.keep()

    one.use()
    await one.db.transactions.add(makeTx({ id: 'from-one' }))
    await one.db.accounts.update('acc-1', { name: 'Dime' })
    await syncNow(one.db, client)
    expect(await ids(one.db)).toEqual(['from-one', 'from-two'])
    one.keep()
    two.use()
    await syncNow(two.db, client)
    expect(await ids(two.db)).toEqual(['from-one', 'from-two'])
    expect((await two.db.accounts.get('acc-1'))?.name).toBe('Dime')
  })

  it('lets the edit sent last win when both devices changed the same record', async () => {
    const client = createSyncClient(base)
    const signedIn = await account2(client)
    const one = device(createDb(`test-${crypto.randomUUID()}`))
    const two = device(createDb(`test-${crypto.randomUUID()}`))
    one.use()
    writeSync(signedIn)
    await one.db.accounts.add(account)
    await syncNow(one.db, client)
    one.keep()
    two.use()
    writeSync(signedIn)
    await syncNow(two.db, client)
    await two.db.accounts.update('acc-1', { name: 'from two' })
    two.keep()
    one.use()
    await one.db.accounts.update('acc-1', { name: 'from one' })
    await syncNow(one.db, client)
    one.keep()
    two.use()
    await syncNow(two.db, client)
    expect((await two.db.accounts.get('acc-1'))?.name).toBe('from two')
    two.keep()
    one.use()
    await syncNow(one.db, client)
    expect((await one.db.accounts.get('acc-1'))?.name).toBe('from two')
  })

  it('syncs trade pictures with the record they belong to', async () => {
    const client = createSyncClient(base)
    const signedIn = await account2(client)
    const one = device(createDb(`test-${crypto.randomUUID()}`))
    const two = device(createDb(`test-${crypto.randomUUID()}`))
    one.use()
    writeSync(signedIn)
    await one.db.pictures.add({ id: 'pic-1', txId: 'tx-1', name: 'chart.png', blob: new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/png' }), createdAt: '2024-01-02T00:00:00.000Z' })
    await syncNow(one.db, client)
    one.keep()
    two.use()
    writeSync(signedIn)
    await syncNow(two.db, client)
    expect((await two.db.pictures.get('pic-1'))?.name).toBe('chart.png')
  })

  // The test database drops a Blob's bytes when it stores one, so the picture's bytes are checked on the sealing alone.
  it('seals a picture with its bytes and type and opens it back', async () => {
    const row = { id: 'pic-1', txId: 'tx-1', name: 'chart.png', blob: new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/png' }), createdAt: 'x' }
    const opened = await openRecord('pictures', await sealRecord('pictures', row, 'k'.repeat(64)), 'k'.repeat(64))
    const blob = opened.blob as Blob
    expect([blob.type, blob.size]).toEqual(['image/png', 4])
    expect([...new Uint8Array(await new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.readAsArrayBuffer(blob)
    }))]).toEqual([1, 2, 3, 250])
  })

  it('sends what a device already held, on its first sync or after the whole-copy sync it used before', async () => {
    const client = createSyncClient(base)
    const signedIn = await account2(client)
    const one = device(createDb(`test-${crypto.randomUUID()}`))
    one.use()
    await one.db.transactions.bulkAdd([makeTx({ id: 'kept-1' }), makeTx({ id: 'kept-2' })])
    clearPending()
    writeSync({ ...signedIn, version: 7, syncedAt: '2026-10-01T00:00:00.000Z' })
    expect(await syncNow(one.db, client)).toEqual({ kind: 'pushed', count: 2 })
    expect((await client.pullRecords(signedIn.token, 0)).records).toHaveLength(2)
  })

  it('removes from the account what a restored backup no longer has', async () => {
    const client = createSyncClient(base)
    const signedIn = await account2(client)
    const one = device(createDb(`test-${crypto.randomUUID()}`))
    one.use()
    writeSync(signedIn)
    await one.db.transactions.bulkAdd([makeTx({ id: 'old' }), makeTx({ id: 'kept' })])
    await syncNow(one.db, client)
    const backup = await exportBackup(one.db)
    backup.data.transactions = backup.data.transactions.filter((t) => t.id === 'kept')
    await restoreBackup(one.db, backup)
    await syncNow(one.db, client)
    const live = (await client.pullRecords(signedIn.token, 0)).records.filter((r) => r.sealed !== null).map((r) => r.id)
    expect(live).toEqual(['kept'])
  })

  it('writes the pending list a handful of times, not once per record, when many records change at once', async () => {
    const one = device(createDb(`test-${crypto.randomUUID()}`))
    one.use()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    await one.db.transactions.bulkAdd(Array.from({ length: 2000 }, (_, i) => makeTx({ id: `bulk-${i}` })))
    await Promise.resolve()
    const writes = setItem.mock.calls.filter(([key]) => key === 'jod-sync-pending').length
    setItem.mockRestore()
    expect(Object.keys(pendingChanges())).toHaveLength(2000)
    expect(writes).toBeLessThan(10)
  })

  it('refuses a wrong password', async () => {
    const client = createSyncClient(base)
    await client.signup('a@x.io', (await deriveKeys('a@x.io', 'right', 1000)).loginKey)
    await expect(client.login('a@x.io', (await deriveKeys('a@x.io', 'wrong', 1000)).loginKey)).rejects.toThrow('อีเมลหรือรหัสผ่านไม่ถูก')
  })
})

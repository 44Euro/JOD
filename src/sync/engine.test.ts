import { mkdtemp } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.ts'
import { FileStore } from '../../server/store.ts'
import { createDb, type JodDB } from '../db/db'
import { makeTx } from '../test/fixtures'
import { createSyncClient } from './client'
import { deriveKeys, installDirtyTracking, resolveConflict, syncNow } from './engine'
import { isDirty, readSync, setDirty, writeSync, type SyncState } from './state'

let server: Server
let base = ''
const account = { id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' }

beforeEach(async () => {
  server = createServer(createApp({ store: new FileStore(await mkdtemp(join(tmpdir(), 'jod-sync-'))) }))
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  writeSync(null)
  setDirty(false)
})

afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())))

// Two devices share this test's localStorage, so each keeps its own copy of the sync state and swaps it in.
function device(db: JodDB) {
  let state: SyncState | null = null
  let dirty = false
  return {
    db,
    use() {
      writeSync(state)
      setDirty(dirty)
    },
    keep() {
      state = readSync()
      dirty = isDirty()
    },
  }
}

describe('sync', () => {
  it('derives a login key and a separate data key from one password', async () => {
    const a = await deriveKeys('A@x.io', 'pw', 1000)
    const b = await deriveKeys('a@x.io', 'pw', 1000)
    expect(a).toEqual(b)
    expect(a.loginKey).not.toBe(a.dataKey)
    expect(a.loginKey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('carries records from one device to another, the server holding only sealed data', async () => {
    const client = createSyncClient(base)
    const keys = await deriveKeys('a@x.io', 'pw', 1000)
    const token = await client.signup('a@x.io', keys.loginKey)
    const one = device(createDb(`test-${crypto.randomUUID()}`))
    const two = device(createDb(`test-${crypto.randomUUID()}`))
    installDirtyTracking(one.db)
    installDirtyTracking(two.db)

    one.use()
    writeSync({ server: base, email: 'a@x.io', token, dataKey: keys.dataKey, version: 0, syncedAt: null })
    await one.db.accounts.add(account)
    await one.db.transactions.add(makeTx({ id: 'first' }))
    expect(await syncNow(one.db, client)).toEqual({ kind: 'pushed', version: 1 })
    const stored = await client.pull(token)
    expect(stored.data).not.toContain('Dime US')
    one.keep()

    two.use()
    writeSync({ server: base, email: 'a@x.io', token, dataKey: keys.dataKey, version: 0, syncedAt: null })
    expect(await syncNow(two.db, client)).toEqual({ kind: 'pulled', version: 1 })
    expect(await two.db.transactions.get('first')).toBeDefined()
    expect(isDirty()).toBe(false)
    await two.db.transactions.add(makeTx({ id: 'second' }))
    expect(await syncNow(two.db, client)).toEqual({ kind: 'pushed', version: 2 })
    two.keep()

    one.use()
    expect(await syncNow(one.db, client)).toEqual({ kind: 'pulled', version: 2 })
    expect((await one.db.transactions.toArray()).map((t) => t.id).sort()).toEqual(['first', 'second'])
  })

  it('asks when both devices changed, and keeps the side the user picks', async () => {
    const client = createSyncClient(base)
    const keys = await deriveKeys('a@x.io', 'pw', 1000)
    const token = await client.signup('a@x.io', keys.loginKey)
    const one = device(createDb(`test-${crypto.randomUUID()}`))
    const two = device(createDb(`test-${crypto.randomUUID()}`))
    installDirtyTracking(one.db)
    installDirtyTracking(two.db)
    one.use()
    writeSync({ server: base, email: 'a@x.io', token, dataKey: keys.dataKey, version: 0, syncedAt: null })
    await one.db.accounts.add(account)
    await syncNow(one.db, client)
    one.keep()
    two.use()
    writeSync({ server: base, email: 'a@x.io', token, dataKey: keys.dataKey, version: 0, syncedAt: null })
    await syncNow(two.db, client)
    await two.db.transactions.add(makeTx({ id: 'from-two' }))
    await syncNow(two.db, client)
    two.keep()

    one.use()
    await one.db.transactions.add(makeTx({ id: 'from-one' }))
    expect(await syncNow(one.db, client)).toEqual({ kind: 'conflict', remoteVersion: 2 })
    expect(await resolveConflict(one.db, client, 'server')).toEqual({ kind: 'pulled', version: 2 })
    expect((await one.db.transactions.toArray()).map((t) => t.id)).toEqual(['from-two'])
  })

  it('refuses a wrong password', async () => {
    const client = createSyncClient(base)
    await client.signup('a@x.io', (await deriveKeys('a@x.io', 'right', 1000)).loginKey)
    await expect(client.login('a@x.io', (await deriveKeys('a@x.io', 'wrong', 1000)).loginKey)).rejects.toThrow('อีเมลหรือรหัสผ่านไม่ถูก')
  })
})

import { mkdtemp } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.ts'
import { FileStore } from '../../server/store.ts'
import { db } from '../db/db'
import { resetDb } from '../test/render'
import { createSyncClient } from './client'
import { deriveKeys, syncNow } from './engine'
import { confirmRecoverySaved, renewRecoveryCode, requestPasswordReset, resetPassword, serverClient, setSyncServerForTests, signIn } from './session'
import { readSync, setDirty, writeSync } from './state'

let server: Server
let base = ''
let mails: string[] = []
const account = { id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' }

beforeEach(async () => {
  await resetDb()
  mails = []
  const sendMail = async (_to: string, _subject: string, text: string) => void mails.push(text)
  server = createServer(createApp({ store: new FileStore(await mkdtemp(join(tmpdir(), 'jod-session-'))), sendMail }))
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  setSyncServerForTests(base)
  writeSync(null)
  setDirty(false)
})

afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())))

// Another device: nothing in its database and nobody signed in.
async function otherDevice() {
  writeSync(null)
  await resetDb()
}

async function emailedCode(email: string) {
  await requestPasswordReset(email)
  return /([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(mails.at(-1)!)![1]
}

async function signUpWithAccount() {
  await signIn('signup', 'a@x.io', 'first password')
  const recovery = readSync()!.recoveryCode!
  confirmRecoverySaved()
  await db.accounts.add(account)
  setDirty(true)
  expect((await syncNow(db, serverClient())).kind).toBe('pushed')
  return recovery
}

describe('accounts and password reset', () => {
  it('gives a new account a recovery code to write down, and forgets it once confirmed', async () => {
    await signIn('signup', 'a@x.io', 'first password')
    expect(readSync()!.recoveryCode).toMatch(/^([A-Z0-9]{4}-){4}[A-Z0-9]{4}$/)
    confirmRecoverySaved()
    expect(readSync()!.recoveryCode).toBeUndefined()
  })

  it('opens the same data on a second device with the password alone', async () => {
    await signUpWithAccount()
    await otherDevice()
    await signIn('login', 'a@x.io', 'first password')
    expect(readSync()!.recoveryCode).toBeUndefined()
    expect(await db.accounts.toArray()).toEqual([account])
  })

  it('resets the password on a new device with the recovery code and keeps the data', async () => {
    const recovery = await signUpWithAccount()
    await otherDevice()
    const code = await emailedCode('a@x.io')
    await expect(resetPassword({ email: 'a@x.io', code, password: 'second password' })).rejects.toThrow('รหัสกู้คืน')
    await expect(resetPassword({ email: 'a@x.io', code, password: 'second password', recoveryCode: 'AAAA-AAAA-AAAA-AAAA-AAAA' })).rejects.toThrow('รหัสกู้คืนไม่ถูก')
    await resetPassword({ email: 'a@x.io', code, password: 'second password', recoveryCode: recovery.toLowerCase() })
    expect(await db.accounts.toArray()).toEqual([account])
    await otherDevice()
    await expect(signIn('login', 'a@x.io', 'first password')).rejects.toThrow()
    await signIn('login', 'a@x.io', 'second password')
    expect(await db.accounts.toArray()).toEqual([account])
  })

  it('resets the password on a device still signed in without asking for the recovery code', async () => {
    await signUpWithAccount()
    const code = await emailedCode('a@x.io')
    await resetPassword({ email: 'a@x.io', code, password: 'second password' })
    expect(await db.accounts.toArray()).toEqual([account])
    await otherDevice()
    await signIn('login', 'a@x.io', 'second password')
    expect(await db.accounts.toArray()).toEqual([account])
  })

  it('starts fresh when there is neither a signed-in device nor the recovery code', async () => {
    await signUpWithAccount()
    await otherDevice()
    const code = await emailedCode('a@x.io')
    await resetPassword({ email: 'a@x.io', code, password: 'second password', fresh: true })
    expect(readSync()!.recoveryCode).toBeTruthy()
    expect(await db.accounts.count()).toBe(0)
    await otherDevice()
    await signIn('login', 'a@x.io', 'second password')
    expect(await db.accounts.count()).toBe(0)
  })

  it('moves an account from before sealed keys onto them at the next sign-in, keeping its data', async () => {
    const legacy = await deriveKeys('old@x.io', 'old password')
    const client = createSyncClient(base)
    const token = await client.signup('old@x.io', legacy.loginKey)
    writeSync({ server: base, email: 'old@x.io', token, dataKey: legacy.passwordKey, version: 0, syncedAt: null })
    await db.accounts.add(account)
    await signIn('login', 'old@x.io', 'old password')
    expect(readSync()!.dataKey).toBe(legacy.passwordKey)
    const recovery = readSync()!.recoveryCode!
    expect(recovery).toBeTruthy()
    await otherDevice()
    const code = await emailedCode('old@x.io')
    await resetPassword({ email: 'old@x.io', code, password: 'new password', recoveryCode: recovery })
    expect(await db.accounts.toArray()).toEqual([account])
  })

  it('issues a new recovery code from a signed-in device and retires the old one', async () => {
    const first = await signUpWithAccount()
    await renewRecoveryCode()
    const second = readSync()!.recoveryCode!
    expect(second).not.toBe(first)
    await otherDevice()
    const code = await emailedCode('a@x.io')
    await expect(resetPassword({ email: 'a@x.io', code, password: 'second password', recoveryCode: first })).rejects.toThrow('รหัสกู้คืนไม่ถูก')
    await resetPassword({ email: 'a@x.io', code, password: 'second password', recoveryCode: second })
    expect(await db.accounts.toArray()).toEqual([account])
  })
})

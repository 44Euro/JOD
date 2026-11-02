import { CHAT_HISTORY_STORAGE_KEY, SEARCH_RECENT_STORAGE_KEY, writeLocal } from '../ai/apiKey'
import { db } from '../db/db'
import { t } from '../i18n'
import { clearLock } from '../security/lock'
import { createSyncClient, type SyncClient } from './client'
import { deriveKeys, syncNow, type SyncOutcome } from './engine'
import { newDataKey, newRecoveryCode, normalizeRecoveryCode, openKey, sealKey } from './keys'
import { clearPending, isDirty, readSync, writeSync } from './state'

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
  const { loginKey, passwordKey } = await deriveKeys(email, password)
  const address = email.trim().toLowerCase()
  if (mode === 'signup') {
    const dataKey = newDataKey()
    const recoveryCode = newRecoveryCode()
    const keys = { password: await sealKey(dataKey, passwordKey), recovery: await sealKey(dataKey, normalizeRecoveryCode(recoveryCode)) }
    const token = await client.signup(address, loginKey, keys)
    writeSync({ server, email: address, token, dataKey, version: 0, syncedAt: null, recoveryCode })
    return syncNow(db, client)
  }
  const { token, keys } = await client.login(address, loginKey)
  const dataKey = keys.password ? await openKey(keys.password, passwordKey) : passwordKey
  let recoveryCode: string | undefined
  // An account from before sealed keys gets them now, and with them its first recovery code.
  if (!keys.password || !keys.recovery) {
    recoveryCode = newRecoveryCode()
    await client.putKeys(token, { password: await sealKey(dataKey, passwordKey), recovery: await sealKey(dataKey, normalizeRecoveryCode(recoveryCode)) })
  }
  writeSync({ server, email: address, token, dataKey, version: 0, syncedAt: null, recoveryCode })
  return syncNow(db, client)
}

export function confirmRecoverySaved() {
  const state = readSync()
  if (state) writeSync({ ...state, recoveryCode: undefined })
}

// A signed-in device holds the data key, so it can issue a new recovery code at any time; the old one stops working.
export async function renewRecoveryCode(): Promise<void> {
  const state = readSync()
  if (!state) return
  const recoveryCode = newRecoveryCode()
  await serverClient().putKeys(state.token, { recovery: await sealKey(state.dataKey, normalizeRecoveryCode(recoveryCode)) })
  writeSync({ ...readSync()!, recoveryCode })
}

export function requestPasswordReset(email: string): Promise<void> {
  return createSyncClient(readSync()?.server ?? server).requestReset(email.trim().toLowerCase())
}

export class RecoveryCodeError extends Error {
  name = 'RecoveryCodeError'
}

// The emailed code proves the email; the data key has to come from somewhere the server cannot read: this device when
// it is still signed in to the account, or the recovery code. Starting fresh is the way out with neither, and costs
// whatever was stored on the server.
export async function resetPassword(reset: { email: string; code: string; password: string; recoveryCode?: string; fresh?: boolean }): Promise<SyncOutcome> {
  const address = reset.email.trim().toLowerCase()
  const current = readSync()
  const here = current?.email === address ? current : null
  const client = createSyncClient(here?.server ?? server)
  const sealedRecovery = await client.verifyReset(address, reset.code)
  let dataKey: string
  let recoveryCode: string | undefined
  if (here && !reset.fresh) dataKey = here.dataKey
  else if (reset.fresh) {
    dataKey = newDataKey()
    recoveryCode = newRecoveryCode()
  } else {
    if (!sealedRecovery || !reset.recoveryCode) throw new RecoveryCodeError(t('ใส่รหัสกู้คืนที่จดไว้ตอนสมัคร'))
    dataKey = await openKey(sealedRecovery, normalizeRecoveryCode(reset.recoveryCode)).catch(() => {
      throw new RecoveryCodeError(t('รหัสกู้คืนไม่ถูก ตรวจตัวอักษรอีกครั้ง'))
    })
  }
  const { loginKey, passwordKey } = await deriveKeys(address, reset.password)
  const keys = {
    password: await sealKey(dataKey, passwordKey),
    ...(recoveryCode ? { recovery: await sealKey(dataKey, normalizeRecoveryCode(recoveryCode)) } : {}),
  }
  const token = await client.completeReset({ email: address, code: reset.code, loginKey, keys, fresh: reset.fresh })
  if (here && !reset.fresh) {
    writeSync({ ...readSync()!, token })
    return syncNow(db, client)
  }
  if (here) await clearDevice()
  writeSync({ server: here?.server ?? server, email: address, token, dataKey, version: 0, syncedAt: null, recoveryCode })
  return syncNow(db, client)
}

// Everything is on the server before the device forgets it; when the last changes cannot be sent, signing out waits
// unless the user accepts losing them.
export async function signOut(force = false): Promise<'done' | 'unsent'> {
  const state = readSync()
  if (state && !force) {
    const outcome = await syncNow(db, serverClient()).catch(() => null)
    if (!outcome || isDirty()) return 'unsent'
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
  clearPending()
  clearLock()
  writeLocal(SEARCH_RECENT_STORAGE_KEY, '')
  writeLocal(CHAT_HISTORY_STORAGE_KEY, '')
}

import { useSyncExternalStore } from 'react'
import { checkPin, makePin, type PinRecord } from './crypto'
import { t } from '../i18n'

// The lock is a screen in front of the app, not encryption of the data: someone with the device's files can still read
// the database. It keeps out the person who picks up an unlocked phone. It belongs to this device and is never backed up.
export const LOCK_STORAGE_KEY = 'jod-lock'
export const RELOCK_AFTER_MS = 5 * 60 * 1000

interface LockRecord extends PinRecord {
  credentialId?: string
}

let unlocked = false
let hiddenAt: number | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

function readRecord(): LockRecord | null {
  try {
    const raw = localStorage.getItem(LOCK_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as LockRecord) : null
  } catch {
    return null
  }
}

function writeRecord(record: LockRecord | null) {
  try {
    if (record) localStorage.setItem(LOCK_STORAGE_KEY, JSON.stringify(record))
    else localStorage.removeItem(LOCK_STORAGE_KEY)
  } catch {
    // Without storage there is no lock to keep, and the app stays open.
  }
  notify()
}

export function lockState(): 'off' | 'locked' | 'open' {
  if (!readRecord()) return 'off'
  return unlocked ? 'open' : 'locked'
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLockState() {
  return useSyncExternalStore(subscribe, lockState)
}

export function hasBiometrics(): boolean {
  return Boolean(readRecord()?.credentialId)
}

export const PIN_LENGTH = 6

export function validPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)
}

export async function setPin(pin: string): Promise<void> {
  if (!validPin(pin)) throw new Error(t('PIN ต้องเป็นตัวเลข 6 หลัก'))
  writeRecord({ ...(await makePin(pin)) })
  unlocked = true
  notify()
}

export async function changePin(current: string, next: string): Promise<void> {
  const record = readRecord()
  if (!record || !(await checkPin(current, record))) throw new Error(t('PIN ปัจจุบันไม่ถูก'))
  if (!validPin(next)) throw new Error(t('PIN ต้องเป็นตัวเลข 6 หลัก'))
  writeRecord({ ...(await makePin(next)), credentialId: record.credentialId })
}

// Signing out removes the PIN with the session, so the next person has to sign in.
export function clearLock() {
  writeRecord(null)
  unlocked = false
  notify()
}

export async function unlockWithPin(pin: string): Promise<boolean> {
  const record = readRecord()
  if (!record || !(await checkPin(pin, record))) return false
  unlocked = true
  notify()
  return true
}

export function lockNow() {
  unlocked = false
  notify()
}

// Called on visibility changes: after five minutes away the app asks again.
export function noteVisibility(visible: boolean, now = Date.now()) {
  if (!visible) hiddenAt = now
  else if (hiddenAt !== null && now - hiddenAt > RELOCK_AFTER_MS) lockNow()
  if (visible) hiddenAt = null
}

export function resetLockForTests() {
  unlocked = false
  hiddenAt = null
  notify()
}

function randomBuffer(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length))
}

export async function biometricsAvailable(): Promise<boolean> {
  return typeof PublicKeyCredential !== 'undefined' && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false))
}

// The device's own fingerprint or face check. There is no server to verify a signature against, so the answer of the
// device's authenticator is taken as it is; that fits a screen lock and nothing stronger.
export async function enableBiometrics(): Promise<void> {
  const record = readRecord()
  if (!record) throw new Error(t('ตั้ง PIN ก่อน'))
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBuffer(32),
      rp: { name: 'JOD' },
      user: { id: randomBuffer(16), name: 'jod', displayName: 'JOD' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null
  if (!credential) throw new Error(t('เปิดใช้ไม่สำเร็จ'))
  writeRecord({ ...record, credentialId: btoa(String.fromCharCode(...new Uint8Array(credential.rawId))) })
}

export function disableBiometrics() {
  const record = readRecord()
  if (record) writeRecord({ salt: record.salt, hash: record.hash, iterations: record.iterations })
}

export async function unlockWithBiometrics(): Promise<boolean> {
  const id = readRecord()?.credentialId
  if (!id) return false
  try {
    const result = await navigator.credentials.get({
      publicKey: {
        challenge: randomBuffer(32),
        allowCredentials: [{ type: 'public-key', id: Uint8Array.from(atob(id), (c) => c.charCodeAt(0)) }],
        userVerification: 'required',
        timeout: 60_000,
      },
    })
    if (!result) return false
    unlocked = true
    notify()
    return true
  } catch {
    return false
  }
}

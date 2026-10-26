// Everything here uses the browser's own Web Crypto: PBKDF2 turns a passphrase into a key, AES-GCM seals the data and
// refuses to open it if a single byte was changed.

const ITERATIONS = 310_000

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length))
}

async function deriveBits(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<ArrayBuffer> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits'])
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, 256)
}

async function aesKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', await deriveBits(passphrase, salt, iterations), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export interface EncryptedFile {
  app: 'jod'
  encrypted: 1
  iterations: number
  salt: string
  iv: string
  data: string
}

export class DecryptError extends Error {
  name = 'DecryptError'
}

export async function encryptText(text: string, passphrase: string, iterations = ITERATIONS): Promise<EncryptedFile> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await aesKey(passphrase, salt, iterations)
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text))
  return { app: 'jod', encrypted: 1, iterations, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(new Uint8Array(sealed)) }
}

export function asEncrypted(value: unknown): EncryptedFile | null {
  const file = value as Partial<EncryptedFile> | null
  return file && file.app === 'jod' && file.encrypted === 1 && typeof file.data === 'string' ? (file as EncryptedFile) : null
}

export async function decryptText(file: EncryptedFile, passphrase: string): Promise<string> {
  try {
    const key = await aesKey(passphrase, fromBase64(file.salt), file.iterations)
    const opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(file.iv) }, key, fromBase64(file.data))
    return new TextDecoder().decode(opened)
  } catch {
    throw new DecryptError('รหัสผ่านไม่ถูก หรือไฟล์เสียหาย')
  }
}

export interface PinRecord {
  salt: string
  hash: string
  iterations: number
}

export async function makePin(pin: string, iterations = ITERATIONS): Promise<PinRecord> {
  const salt = randomBytes(16)
  return { salt: toBase64(salt), hash: toBase64(new Uint8Array(await deriveBits(pin, salt, iterations))), iterations }
}

export async function checkPin(pin: string, record: PinRecord): Promise<boolean> {
  const hash = toBase64(new Uint8Array(await deriveBits(pin, fromBase64(record.salt), record.iterations)))
  return hash === record.hash
}

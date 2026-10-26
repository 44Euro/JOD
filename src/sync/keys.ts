import { asEncrypted, decryptText, encryptText } from '../security/crypto'

// The keys that seal the data key are already long and random, so a light key-stretch is enough.
const SEAL_ITERATIONS = 1000
// No 0/O or 1/I/L, so a code copied by hand is typed back without guessing.
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function newDataKey(): string {
  return randomHex(32)
}

// Twenty letters, about 99 bits: shown once, kept on paper, and typed back only on a new device after a lost password.
export function newRecoveryCode(): string {
  const letters: string[] = []
  while (letters.length < 20) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      // Bytes past the last whole round of the alphabet are skipped, so every letter is equally likely.
      if (b < 248 && letters.length < 20) letters.push(LETTERS[b % LETTERS.length])
    }
  }
  return letters.join('').replace(/(.{4})(?=.)/g, '$1-')
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export async function sealKey(dataKey: string, secret: string): Promise<string> {
  return JSON.stringify(await encryptText(dataKey, secret, SEAL_ITERATIONS))
}

export async function openKey(sealed: string, secret: string): Promise<string> {
  const file = asEncrypted(JSON.parse(sealed))
  if (!file) throw new Error('not sealed')
  return decryptText(file, secret)
}

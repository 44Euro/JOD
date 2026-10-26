import { describe, expect, it } from 'vitest'
import { asEncrypted, checkPin, decryptText, encryptText, makePin } from './crypto'

describe('backup encryption', () => {
  it('opens with the right passphrase only, and hides the content', async () => {
    const file = await encryptText('{"app":"jod","secret":"ทุน 100,000"}', 'correct horse', 1000)
    expect(JSON.stringify(file)).not.toContain('100,000')
    expect(asEncrypted(JSON.parse(JSON.stringify(file)))).not.toBeNull()
    expect(await decryptText(file, 'correct horse')).toBe('{"app":"jod","secret":"ทุน 100,000"}')
    await expect(decryptText(file, 'wrong')).rejects.toThrow('รหัสผ่านไม่ถูก')
  })

  it('refuses a file that was changed', async () => {
    const file = await encryptText('hello', 'pw', 1000)
    const bytes = atob(file.data)
    const tampered = { ...file, data: btoa(String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1)) }
    await expect(decryptText(tampered, 'pw')).rejects.toThrow()
  })

  it('tells an ordinary backup from a sealed one', () => {
    expect(asEncrypted({ app: 'jod', version: 2, data: {} })).toBeNull()
  })
})

describe('PIN', () => {
  it('keeps only a salted hash and checks against it', async () => {
    const record = await makePin('1234', 1000)
    expect(JSON.stringify(record)).not.toContain('1234')
    expect(await checkPin('1234', record)).toBe(true)
    expect(await checkPin('1235', record)).toBe(false)
  })
})

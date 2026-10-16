import { beforeEach, describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { BackupError, exportBackup, parseBackup, restoreBackup, transactionsToCsv } from './backup'
import { createDb, type JodDB } from './db'

let db: JodDB
const account = { id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' }

beforeEach(async () => {
  db = createDb(`test-${crypto.randomUUID()}`)
  await db.accounts.add(account)
  await db.transactions.add(makeTx({ id: 'keep-me' }))
})

describe('backup round trip', () => {
  it('restores exactly what was exported', async () => {
    const backup = await exportBackup(db, new Date('2024-06-01T00:00:00Z'))
    const target = createDb(`test-${crypto.randomUUID()}`)
    await restoreBackup(target, parseBackup(JSON.stringify(backup)))
    expect(await target.transactions.toArray()).toEqual(await db.transactions.toArray())
    expect(await target.accounts.toArray()).toEqual([account])
  })
})

describe('parseBackup', () => {
  it('rejects files that are not JSON or not from JOD', () => {
    expect(() => parseBackup('hello')).toThrow(BackupError)
    expect(() => parseBackup('{"app":"other","version":1}')).toThrow('ไม่ใช่ไฟล์สำรองของ JOD')
  })

  it('rejects transactions that fail validation or point at a missing account', () => {
    const bad = {
      app: 'jod',
      version: 1,
      exportedAt: '',
      data: { accounts: [account], instruments: [], settings: [], transactions: [makeTx({ id: 'x', quantity: '-1' })] },
    }
    expect(() => parseBackup(JSON.stringify(bad))).toThrow('รายการ x ไม่ถูกต้อง')
    const orphan = { ...bad, data: { ...bad.data, transactions: [makeTx({ id: 'y', accountId: 'ghost' })] } }
    expect(() => parseBackup(JSON.stringify(orphan))).toThrow('รายการ y อ้างถึงบัญชีที่ไม่มีในไฟล์')
  })
})

describe('restoreBackup', () => {
  it('leaves existing data untouched when the restore fails part-way', async () => {
    const broken = {
      app: 'jod' as const,
      version: 1 as const,
      exportedAt: '',
      data: { accounts: [account, account], instruments: [], transactions: [], settings: [] },
    }
    await expect(restoreBackup(db, broken)).rejects.toThrow()
    expect(await db.transactions.get('keep-me')).toBeDefined()
  })
})

describe('transactionsToCsv', () => {
  it('starts with a BOM and escapes commas, quotes and Thai text', () => {
    const csv = transactionsToCsv([makeTx({ note: 'ซื้อเพิ่ม, "ลองดู"' })], [account], 'THB')
    expect(csv.startsWith('﻿date,time,type,account')).toBe(true)
    expect(csv).toContain('net_amount_THB')
    expect(csv).toContain('"ซื้อเพิ่ม, ""ลองดู"""')
    expect(csv).toContain('Dime US')
    expect(csv).toContain(',-100,-3500,')
  })
})

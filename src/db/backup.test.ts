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

const day = { date: '2024-06-01', valueBase: '35788.50', netInvestedBase: '34000.00', recordedAt: '2024-06-01T10:00:00.000Z' }

describe('backup round trip', () => {
  it('restores exactly what was exported', async () => {
    const backup = await exportBackup(db, new Date('2024-06-01T00:00:00Z'))
    const target = createDb(`test-${crypto.randomUUID()}`)
    await restoreBackup(target, parseBackup(JSON.stringify(backup)))
    expect(await target.transactions.toArray()).toEqual(await db.transactions.toArray())
    expect(await target.accounts.toArray()).toEqual([account])
  })

  it('writes version 2 with the daily values and brings them back', async () => {
    await db.dailyValues.add(day)
    const backup = await exportBackup(db)
    expect(backup.version).toBe(2)
    const target = createDb(`test-${crypto.randomUUID()}`)
    await restoreBackup(target, parseBackup(JSON.stringify(backup)))
    expect(await target.dailyValues.toArray()).toEqual([day])
  })

  it('still restores a version 1 file, which has no daily values', async () => {
    const v1 = { app: 'jod', version: 1, exportedAt: '', data: { accounts: [account], instruments: [], settings: [], transactions: [makeTx({ id: 'old' })] } }
    const target = createDb(`test-${crypto.randomUUID()}`)
    await target.dailyValues.add(day)
    await restoreBackup(target, parseBackup(JSON.stringify(v1)))
    expect(await target.transactions.get('old')).toBeDefined()
    expect(await target.dailyValues.count()).toBe(0)
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

  it('rejects a transfer to an account that is not in the file', () => {
    const lost = makeTx({ id: 'z', type: 'transfer', toAccountId: 'ghost', quantity: '1', price: undefined })
    const file = { app: 'jod', version: 2, exportedAt: '', data: { accounts: [account], instruments: [], settings: [], transactions: [lost] } }
    expect(() => parseBackup(JSON.stringify(file))).toThrow('รายการ z อ้างถึงบัญชีที่ไม่มีในไฟล์')
  })

  it('keeps how a fee was paid and rejects a way that does not exist', () => {
    const paid = makeTx({ id: 'f', feePaidIn: 'asset', feeInstrumentId: 'CRYPTO:BNB', feeQuantity: '0.001', fees: '0.6' })
    const file = (tx: unknown) => JSON.stringify({ app: 'jod', version: 2, exportedAt: '', data: { accounts: [account], instruments: [], settings: [], transactions: [tx] } })
    expect(parseBackup(file(paid)).data.transactions[0]).toMatchObject({ feePaidIn: 'asset', feeInstrumentId: 'CRYPTO:BNB', feeQuantity: '0.001' })
    expect(() => parseBackup(file({ ...paid, feePaidIn: 'gold' }))).toThrow('รายการ f ไม่ถูกต้อง: วิธีจ่ายค่าธรรมเนียมไม่ถูกต้อง')
  })

  it('keeps a fee formula on an account and still reads an account without one', () => {
    const template = { currency: 'THB', commissionPct: '0.157', minimum: '50', vatPct: '7', perOrder: '0' }
    const file = (accounts: unknown[]) =>
      JSON.stringify({ app: 'jod', version: 2, exportedAt: '', data: { accounts, instruments: [], settings: [], transactions: [] } })
    expect(parseBackup(file([{ ...account, feeTemplate: template }])).data.accounts[0].feeTemplate).toEqual(template)
    expect(parseBackup(file([account])).data.accounts[0]).not.toHaveProperty('feeTemplate')
  })

  it('rejects an account with a fee formula that does not make sense', () => {
    const template = { currency: 'THB', commissionPct: '0.157', minimum: '50', vatPct: '7', perOrder: '0' }
    const file = (feeTemplate: unknown) =>
      JSON.stringify({ app: 'jod', version: 2, exportedAt: '', data: { accounts: [{ ...account, feeTemplate }], instruments: [], settings: [], transactions: [] } })
    const message = `บัญชี ${account.name} มีสูตรค่าธรรมเนียมที่ไม่ถูกต้อง`
    expect(() => parseBackup(file({ ...template, commissionPct: '-1' }))).toThrow(message)
    expect(() => parseBackup(file({ ...template, currency: 'baht' }))).toThrow(message)
    expect(() => parseBackup(file({ currency: 'THB', commissionPct: '1' }))).toThrow(message)
    expect(() => parseBackup(file({ ...template, minimum: 50 }))).toThrow(message)
    expect(() => parseBackup(file('free'))).toThrow(message)
    expect(() => parseBackup(file(null))).toThrow(message)
  })

  it('rejects a damaged daily value and an unknown version', () => {
    const file = { app: 'jod', version: 2, exportedAt: '', data: { accounts: [account], instruments: [], settings: [], transactions: [], dailyValues: [{ ...day, valueBase: 'abc' }] } }
    expect(() => parseBackup(JSON.stringify(file))).toThrow('พบมูลค่ารายวันที่เสียหายในไฟล์')
    expect(() => parseBackup(JSON.stringify({ ...file, version: 3 }))).toThrow('เป็นเวอร์ชันที่ไม่รองรับ')
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

  it('names the receiving account of a transfer just before the received kind and the note', () => {
    const other = { ...account, id: 'acc-2', name: 'IBKR' }
    const transfer = makeTx({ type: 'transfer', accountId: 'acc-1', toAccountId: 'acc-2', quantity: '4', price: undefined, note: 'move' })
    const [header, row, plain] = transactionsToCsv([transfer, makeTx({ date: '2024-02-01' })], [account, other], 'THB')
      .replace('\uFEFF', '')
      .trimEnd()
      .split('\r\n')
    expect(header.endsWith(',tax_year,to_account,to_instrument,to_quantity,receive_kind,fee_paid_in,fee_instrument,fee_quantity,note')).toBe(true)
    expect(row.endsWith(',,IBKR,,,,,,,move')).toBe(true)
    expect(plain.endsWith(',,,,,,,,,')).toBe(true)
  })

  it('names the coin received in a swap and how much of it just before the received kind and the note', () => {
    const swap = makeTx({
      type: 'swap',
      instrumentId: 'CRYPTO:BTC',
      quantity: '0.01',
      price: undefined,
      toInstrumentId: 'CRYPTO:ETH',
      toQuantity: '0.25',
      amount: '660',
      fees: '1.5',
      note: 'rotate',
    })
    const [, row] = transactionsToCsv([swap], [account], 'THB').replace('\uFEFF', '').trimEnd().split('\r\n')
    expect(row).toBe('2024-01-15,,swap,Dime US,CRYPTO:BTC,0.01,,660,USD,1.5,0,35,manual,-1.5,-52.5,,,,CRYPTO:ETH,0.25,,,,,rotate')
  })

  it('writes the kind of an asset received just before the note', () => {
    const received = makeTx({
      type: 'receive_asset',
      receiveKind: 'staking',
      instrumentId: 'CRYPTO:SOL',
      quantity: '0.5',
      price: '150',
      note: 'reward',
    })
    const [, row] = transactionsToCsv([received], [account], 'THB').replace('\uFEFF', '').trimEnd().split('\r\n')
    expect(row).toBe('2024-01-15,,receive_asset,Dime US,CRYPTO:SOL,0.5,150,,USD,0,0,35,manual,0,0,,,,,,staking,,,,reward')
  })
})

describe('transactionsToCsv for a fee paid in something else', () => {
  it('names what the fee is paid in, the asset and the units just before the note, and leaves a fee in cash empty', () => {
    const paidInBnb = makeTx({
      instrumentId: 'CRYPTO:ETH',
      quantity: '1',
      price: '2000',
      fees: '0.6',
      feePaidIn: 'asset',
      feeInstrumentId: 'CRYPTO:BNB',
      feeQuantity: '0.001',
      note: 'gas',
    })
    const taken = makeTx({ instrumentId: 'CRYPTO:ETH', quantity: '1', price: '2000', feePaidIn: 'received', feeQuantity: '0.001', date: '2024-01-16' })
    const cash = makeTx({ date: '2024-01-17' })
    const [, bnbRow, takenRow, cashRow] = transactionsToCsv([paidInBnb, taken, cash], [account], 'THB').replace('\uFEFF', '').trimEnd().split('\r\n')
    expect(bnbRow).toBe('2024-01-15,,buy,Dime US,CRYPTO:ETH,1,2000,,USD,0.6,0,35,manual,-2000,-70000,,,,,,,asset,CRYPTO:BNB,0.001,gas')
    expect(takenRow).toBe('2024-01-16,,buy,Dime US,CRYPTO:ETH,1,2000,,USD,0,0,35,manual,-2000,-70000,,,,,,,received,,0.001,')
    expect(cashRow.endsWith(',,,,,,,,,')).toBe(true)
  })
})


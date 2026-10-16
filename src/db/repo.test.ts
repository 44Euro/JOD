import { beforeEach, describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { createDb, type JodDB } from './db'
import {
  addAccount,
  deleteAccount,
  getSettings,
  saveSettings,
  saveTransaction,
  setInstrumentPrice,
  upsertInstrument,
} from './repo'

let db: JodDB

beforeEach(() => {
  db = createDb(`test-${crypto.randomUUID()}`)
})

describe('settings', () => {
  it('defaults to THB and persists changes', async () => {
    expect(await getSettings(db)).toEqual({ baseCurrency: 'THB' })
    await saveSettings(db, { baseCurrency: 'USD', lastBackupAt: '2024-06-01T00:00:00.000Z' })
    expect(await getSettings(db)).toEqual({ baseCurrency: 'USD', lastBackupAt: '2024-06-01T00:00:00.000Z' })
  })
})

describe('accounts', () => {
  it('refuses to delete an account that still has transactions', async () => {
    const account = await addAccount(db, { name: 'Dime US', broker: 'Dime', note: '' })
    await saveTransaction(db, makeTx({ accountId: account.id }))
    await expect(deleteAccount(db, account.id)).rejects.toThrow('ลบไม่ได้ บัญชีนี้ยังมี 1 รายการ')
    expect(await db.accounts.count()).toBe(1)
  })

  it('deletes an unused account', async () => {
    const account = await addAccount(db, { name: 'Empty', broker: '', note: '' })
    await deleteAccount(db, account.id)
    expect(await db.accounts.count()).toBe(0)
  })
})

describe('instruments', () => {
  it('keeps the last price when instrument details are updated', async () => {
    const base = { id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD' } as const
    await upsertInstrument(db, base)
    await setInstrumentPrice(db, 'US:AAPL', '190.5', new Date('2024-05-01T00:00:00Z'))
    await upsertInstrument(db, { ...base, name: 'Apple Inc.' })
    const stored = await db.instruments.get('US:AAPL')
    expect(stored?.name).toBe('Apple Inc.')
    expect(stored?.lastPrice).toBe('190.5')
    expect(stored?.lastPriceAt).toBe('2024-05-01T00:00:00.000Z')
  })
})

describe('transactions', () => {
  it('rejects an invalid transaction instead of storing it', async () => {
    await expect(saveTransaction(db, makeTx({ quantity: '0' }))).rejects.toThrow('จำนวนหน่วยต้องเป็นตัวเลขมากกว่า 0')
    expect(await db.transactions.count()).toBe(0)
  })

  it('stamps updatedAt on save', async () => {
    const tx = makeTx()
    await saveTransaction(db, tx, new Date('2024-06-01T10:00:00Z'))
    expect((await db.transactions.get(tx.id))?.updatedAt).toBe('2024-06-01T10:00:00.000Z')
  })
})

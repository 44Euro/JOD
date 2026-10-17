import { beforeEach, describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { createDb, type JodDB } from './db'
import {
  addAccount,
  deleteAccount,
  getSettings,
  recordDailyValue,
  saveInstrumentThesis,
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

  it('keeps an account that only receives transfers', async () => {
    await db.transactions.add(makeTx({ type: 'transfer', accountId: 'acc-1', toAccountId: 'acc-2', quantity: '1', price: undefined }))
    await expect(deleteAccount(db, 'acc-2')).rejects.toThrow('ลบไม่ได้ บัญชีนี้ยังมี 1 รายการ')
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

describe('instrument thesis', () => {
  const base = { id: 'US:VOO', market: 'US', symbol: 'VOO', name: 'Vanguard', assetType: 'etf', currency: 'USD' } as const

  it('stores the reason, target and review date, and removes fields that are cleared', async () => {
    await upsertInstrument(db, base)
    await saveInstrumentThesis(db, 'US:VOO', { holdReason: ' ถือยาว ', targetPrice: '600', reviewDate: '2027-01-01' })
    expect(await db.instruments.get('US:VOO')).toMatchObject({ holdReason: 'ถือยาว', targetPrice: '600', reviewDate: '2027-01-01' })

    await saveInstrumentThesis(db, 'US:VOO', { holdReason: 'ถือยาว', targetPrice: '', reviewDate: '' })
    const stored = await db.instruments.get('US:VOO')
    expect(stored).not.toHaveProperty('targetPrice')
    expect(stored).not.toHaveProperty('reviewDate')
  })

  it('keeps the thesis when the form updates the instrument details', async () => {
    await upsertInstrument(db, base)
    await saveInstrumentThesis(db, 'US:VOO', { holdReason: 'ถือยาว', targetPrice: '600', reviewDate: '' })
    await upsertInstrument(db, { ...base, name: 'Vanguard S&P 500 ETF' })
    expect((await db.instruments.get('US:VOO'))?.holdReason).toBe('ถือยาว')
  })

  it('refuses a bad target price or date, and an unknown instrument', async () => {
    await upsertInstrument(db, base)
    await expect(saveInstrumentThesis(db, 'US:VOO', { holdReason: '', targetPrice: '-1', reviewDate: '' })).rejects.toThrow(
      'ราคาเป้าหมายต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป',
    )
    await expect(saveInstrumentThesis(db, 'US:VOO', { holdReason: '', targetPrice: '', reviewDate: '2027-02-30' })).rejects.toThrow(
      'วันทบทวนไม่ถูกต้อง',
    )
    await expect(saveInstrumentThesis(db, 'US:NOPE', { holdReason: 'x', targetPrice: '', reviewDate: '' })).rejects.toThrow('ไม่พบสินทรัพย์นี้')
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

describe('daily values', () => {
  it('keeps one row per day and only rewrites it when the numbers change', async () => {
    const day = { date: '2024-07-01', valueBase: '50950.00', netInvestedBase: '50000.00' }
    expect(await recordDailyValue(db, day, new Date('2024-07-01T02:00:00Z'))).toBe(true)
    expect(await recordDailyValue(db, day, new Date('2024-07-01T03:00:00Z'))).toBe(false)
    expect((await db.dailyValues.get('2024-07-01'))?.recordedAt).toBe('2024-07-01T02:00:00.000Z')

    expect(await recordDailyValue(db, { ...day, valueBase: '51000.00' }, new Date('2024-07-01T09:00:00Z'))).toBe(true)
    expect(await db.dailyValues.toArray()).toEqual([
      { date: '2024-07-01', valueBase: '51000.00', netInvestedBase: '50000.00', recordedAt: '2024-07-01T09:00:00.000Z' },
    ])
  })
})

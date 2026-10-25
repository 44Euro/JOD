import { beforeEach, describe, expect, it } from 'vitest'
import { computeLedger } from '../domain/ledger'
import { matchTrades } from '../domain/trades'
import { validateTransaction } from '../domain/validation'
import { makeTx } from '../test/fixtures'
import { resetDb } from '../test/render'
import { db } from './db'
import { addAccount, removeSampleData, saveTransaction } from './repo'
import { hasSampleData, loadSampleData, sampleData } from './sampleData'

beforeEach(async () => {
  await resetDb()
})

describe('sample data', () => {
  it('builds sample data that the ledger counts without a problem', () => {
    const { accounts, instruments, transactions } = sampleData('2026-10-19')
    expect(accounts.every((a) => a.id.startsWith('sample-'))).toBe(true)
    expect(transactions.every((t) => t.id.startsWith('sample-') && validateTransaction(t, '2026-10-19').length === 0)).toBe(true)
    expect(transactions.every((t) => t.date >= '2025-10-19' && t.date <= '2026-10-19')).toBe(true)
    const ledger = computeLedger(transactions)
    expect(ledger.issues).toEqual([])
    const markets = new Set(ledger.positions.map((p) => p.instrumentId.split(':')[0]))
    expect(markets.size).toBeGreaterThanOrEqual(3)
    expect(ledger.positions.every((p) => instruments.find((i) => i.id === p.instrumentId)?.lastPriceAt === '2026-10-19')).toBe(true)
    expect(matchTrades(transactions, ledger).filter((t) => t.closeDate).length).toBeGreaterThanOrEqual(2)
    expect(ledger.cash.every((c) => c.amount.greaterThanOrEqualTo(0))).toBe(true)
  })

  it('removes only the sample rows', async () => {
    await loadSampleData(db, '2026-10-19')
    expect(hasSampleData(await db.accounts.toArray())).toBe(true)
    const mine = await addAccount(db, { name: 'บัญชีของฉัน', broker: 'Dime', note: '' })
    const sampleUs = (await db.instruments.toArray()).find((i) => i.id.startsWith('US:'))!
    const myBuy = makeTx({ accountId: mine.id, instrumentId: sampleUs.id })
    await saveTransaction(db, myBuy)
    await removeSampleData(db)
    expect((await db.accounts.toArray()).map((a) => a.id)).toEqual([mine.id])
    expect((await db.transactions.toArray()).map((t) => t.id)).toEqual([myBuy.id])
    expect((await db.instruments.toArray()).map((i) => i.id)).toEqual([sampleUs.id])
    expect(hasSampleData(await db.accounts.toArray())).toBe(false)
  })

  it('keeps an instrument the user already had, with its own price', async () => {
    await db.instruments.add({ id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD', lastPrice: '199' })
    await loadSampleData(db, '2026-10-19')
    expect((await db.instruments.get('US:AAPL'))!.lastPrice).toBe('199')
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { makeTx } from '../test/fixtures'
import { resetDb } from '../test/render'
import { prepareSave, writeSave } from './saveDraft'
import { emptyDraft, type Draft } from './transactionDraft'

const at = new Date('2024-01-15T03:00:00.000Z')

function draft(overrides: Partial<Draft> = {}): Draft {
  return { ...emptyDraft('acc-1', '2024-01-15'), symbol: 'aapl', quantity: '2', price: '100', fxRate: '35', fxSource: 'manual', ...overrides }
}

const ctx = { others: [], instruments: [], baseCurrency: 'THB', reinvesting: false, at }

beforeEach(async () => {
  await resetDb()
})

describe('saveDraft', () => {
  it('writes a buy of a new symbol together with its instrument', async () => {
    const prepared = prepareSave(draft(), ctx)
    expect(prepared.errors).toEqual([])
    await writeSave(db, draft(), prepared, [], at)
    expect((await db.instruments.get('US:AAPL'))?.currency).toBe('USD')
    const [stored] = await db.transactions.toArray()
    expect([stored.instrumentId, stored.quantity, stored.price]).toEqual(['US:AAPL', '2', '100'])
  })

  it('refuses a sell the ledger would skip, and writes nothing', async () => {
    const held = makeTx({ id: 'buy-1', quantity: '1', date: '2024-01-10' })
    const prepared = prepareSave(draft({ type: 'sell', quantity: '5' }), { ...ctx, others: [held] })
    expect(prepared.errors).toEqual(['ขาย 5 หน่วย แต่ถืออยู่ 1 หน่วย'])
    expect(await db.transactions.count()).toBe(0)
  })
})

import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import { makeTx } from '../test/fixtures'
import { renderRoute, resetDb } from '../test/render'

beforeEach(async () => {
  await resetDb()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2024, 6, 1, 9, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DailyValueRecorder', () => {
  it('records today’s value and money invested from any page', async () => {
    await db.accounts.add({ id: 'acc-1', name: 'Streaming', broker: 'Streaming', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
    await db.instruments.add({ id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'ปตท.', assetType: 'stock', currency: 'THB', lastPrice: '36' })
    const baht = { currency: 'THB', fxRate: '1', fxSource: 'same' as const }
    await db.transactions.bulkAdd([
      makeTx({ ...baht, type: 'deposit', instrumentId: undefined, quantity: undefined, price: undefined, amount: '50000', date: '2024-06-03' }),
      makeTx({ ...baht, instrumentId: 'SET:PTT', quantity: '1000', price: '35', fees: '50', date: '2024-06-04' }),
    ])
    renderRoute('/settings')
    await waitFor(async () =>
      expect(await db.dailyValues.get('2024-07-01')).toMatchObject({ valueBase: '50950.00', netInvestedBase: '50000.00' }),
    )
  })
})

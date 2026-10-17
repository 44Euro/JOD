import { cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import { fakeFxProvider, lateFxProvider } from '../test/fakeFx'
import { makeTx } from '../test/fixtures'
import { renderRoute, resetDb } from '../test/render'

const baht = { currency: 'THB', fxRate: '1', fxSource: 'same' as const }

async function seedBahtPortfolio() {
  await db.accounts.add({ id: 'acc-1', name: 'Streaming', broker: 'Streaming', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
  await db.instruments.add({ id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'ปตท.', assetType: 'stock', currency: 'THB', lastPrice: '36' })
  await db.transactions.bulkAdd([
    makeTx({ ...baht, type: 'deposit', instrumentId: undefined, quantity: undefined, price: undefined, amount: '50000', date: '2024-06-03' }),
    makeTx({ ...baht, instrumentId: 'SET:PTT', quantity: '1000', price: '35', fees: '50', date: '2024-06-04' }),
  ])
}

beforeEach(async () => {
  await resetDb()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2024, 6, 1, 9, 0))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('DailyValueRecorder', () => {
  it('records today’s value and money invested from any page', async () => {
    await seedBahtPortfolio()
    renderRoute('/settings')
    await waitFor(async () =>
      expect(await db.dailyValues.get('2024-07-01')).toMatchObject({ valueBase: '50950.00', netInvestedBase: '50000.00' }),
    )
  })

  it('records nothing while the rates of a foreign holding are still on their way', async () => {
    await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
    await db.instruments.add({ id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD', lastPrice: '120' })
    await db.transactions.add(makeTx({ quantity: '10', price: '100', fxRate: '35', date: '2024-06-04' }))
    const { provider, release, requested } = lateFxProvider({ 'USD|THB': '33' })
    renderRoute('/settings', provider)
    await waitFor(() => expect(requested()).toBeGreaterThan(0))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await db.dailyValues.count()).toBe(0)

    release()
    await waitFor(async () =>
      expect(await db.dailyValues.get('2024-07-01')).toMatchObject({ valueBase: '39600.00', netInvestedBase: '35000.00' }),
    )
  })

  it('waits for a confirmed rate instead of recording from a stale cached one', async () => {
    await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
    await db.instruments.add({ id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD', lastPrice: '120' })
    await db.transactions.add(makeTx({ quantity: '10', price: '100', fxRate: '35', date: '2024-06-04' }))
    await db.fxRates.put({ key: 'USD|THB|latest', rate: '31', rateDate: '2024-05-31', fetchedAt: new Date(2024, 4, 31, 18).toISOString() })
    const { provider, release, requested } = lateFxProvider({ 'USD|THB': '33' })
    renderRoute('/settings', provider)
    await waitFor(() => expect(requested()).toBeGreaterThan(0))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await db.dailyValues.count()).toBe(0)

    release()
    await waitFor(async () =>
      expect(await db.dailyValues.get('2024-07-01')).toMatchObject({ valueBase: '39600.00', netInvestedBase: '35000.00' }),
    )
    expect(await db.dailyValues.count()).toBe(1)
  })

  it('survives a failed write and records again on the next change', async () => {
    await seedBahtPortfolio()
    const failing = vi.spyOn(db.dailyValues, 'get').mockRejectedValueOnce(new Error('storage full'))
    renderRoute('/settings', fakeFxProvider({}).provider)
    await waitFor(() => expect(failing).toHaveBeenCalled())
    expect(await db.dailyValues.count()).toBe(0)

    await db.transactions.add(
      makeTx({ ...baht, type: 'deposit', instrumentId: undefined, quantity: undefined, price: undefined, amount: '10000', date: '2024-06-05' }),
    )
    await waitFor(async () =>
      expect(await db.dailyValues.get('2024-07-01')).toMatchObject({ valueBase: '60950.00', netInvestedBase: '60000.00' }),
    )
  })

  describe('when the app comes back to the front', () => {
    function setVisibility(state: 'visible' | 'hidden') {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)
      document.dispatchEvent(new Event('visibilitychange'))
    }

    it('records the new day if midnight passed while it was in the background', async () => {
      await seedBahtPortfolio()
      renderRoute('/settings')
      await waitFor(async () => expect(await db.dailyValues.get('2024-07-01')).toBeDefined())

      vi.setSystemTime(new Date(2024, 6, 2, 0, 5))
      setVisibility('hidden')
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(await db.dailyValues.get('2024-07-02')).toBeUndefined()

      setVisibility('visible')
      await waitFor(async () =>
        expect(await db.dailyValues.get('2024-07-02')).toMatchObject({ valueBase: '50950.00', netInvestedBase: '50000.00' }),
      )
    })

    it('keeps yesterday’s row when the data changes after midnight without the app being brought forward', async () => {
      vi.setSystemTime(new Date(2024, 6, 1, 23, 50))
      await seedBahtPortfolio()
      renderRoute('/settings')
      await waitFor(async () =>
        expect(await db.dailyValues.get('2024-07-01')).toMatchObject({ valueBase: '50950.00', netInvestedBase: '50000.00' }),
      )

      vi.setSystemTime(new Date(2024, 6, 2, 0, 10))
      await db.transactions.add(
        makeTx({ ...baht, type: 'deposit', instrumentId: undefined, quantity: undefined, price: undefined, amount: '10000', date: '2024-07-02' }),
      )
      await waitFor(async () =>
        expect(await db.dailyValues.get('2024-07-02')).toMatchObject({ valueBase: '60950.00', netInvestedBase: '60000.00' }),
      )
      expect(await db.dailyValues.get('2024-07-01')).toMatchObject({ valueBase: '50950.00', netInvestedBase: '50000.00' })
    })

    it('stops listening once the recorder is gone', async () => {
      const added: EventListenerOrEventListenerObject[] = []
      const removed: EventListenerOrEventListenerObject[] = []
      const add = document.addEventListener.bind(document)
      const remove = document.removeEventListener.bind(document)
      vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
        if (type === 'visibilitychange' && listener) added.push(listener)
        add(type, listener, options)
      })
      vi.spyOn(document, 'removeEventListener').mockImplementation((type, listener, options) => {
        if (type === 'visibilitychange' && listener) removed.push(listener)
        remove(type, listener, options)
      })
      renderRoute('/settings')
      await waitFor(() => expect(added.length).toBeGreaterThan(0))
      cleanup()
      expect(removed).toEqual(expect.arrayContaining(added))
    })
  })
})

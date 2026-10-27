import { describe, expect, it } from 'vitest'
import { D } from '../domain/decimal'
import type { Position } from '../domain/ledger'
import type { Instrument } from '../domain/types'
import { valuePosition } from '../domain/valuation'
import { buildHoldingsBoard } from './holdingsBoard'

function position(overrides: Partial<Position>): Position {
  return {
    key: 'acc-1|US:AAPL',
    accountId: 'acc-1',
    instrumentId: 'US:AAPL',
    currency: 'USD',
    quantity: D(10),
    costQuote: D(1000),
    costBase: D(35000),
    receivedCostBase: D(0),
    ...overrides,
  }
}

function instrument(overrides: Partial<Instrument>): Instrument {
  return { id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD', ...overrides }
}

describe('buildHoldingsBoard', () => {
  it('merges one asset held in two accounts into one row with the units added', () => {
    const rows = buildHoldingsBoard(
      [valuePosition(position({ quantity: D(3) }), '200', '35'), valuePosition(position({ key: 'acc-2|US:AAPL', accountId: 'acc-2', quantity: D(2) }), '200', '35')],
      [instrument({ lastPrice: '200' })],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].quantity.toString()).toBe('5')
  })

  it('orders rows by value in the base currency, unpriced ones last by cost', () => {
    const rows = buildHoldingsBoard(
      [
        valuePosition(position({ instrumentId: 'US:SMALL', key: 'a|US:SMALL' }), '1', '35'),
        valuePosition(position({ instrumentId: 'US:NOPRICE', key: 'a|US:NOPRICE', costBase: D(999999) })),
        valuePosition(position({ instrumentId: 'US:BIG', key: 'a|US:BIG' }), '500', '35'),
      ],
      [instrument({ id: 'US:SMALL', symbol: 'SMALL' }), instrument({ id: 'US:NOPRICE', symbol: 'NOPRICE' }), instrument({ id: 'US:BIG', symbol: 'BIG' })],
    )
    expect(rows.map((r) => r.symbol)).toEqual(['BIG', 'SMALL', 'NOPRICE'])
  })

  it('gives the signed change from the previous price', () => {
    const at = (lastPrice: string) =>
      buildHoldingsBoard([valuePosition(position({}), lastPrice, '35')], [
        instrument({ lastPrice, lastPriceAt: '2026-10-27T01:00:00.000Z', previousPrice: '100', previousPriceAt: '2026-10-26T01:00:00.000Z' }),
      ])[0]
    expect(at('104').changePct?.toString()).toBe('4')
    expect(at('96').changePct?.toString()).toBe('-4')
    expect(at('104').comparedWithDay).toBe('2026-10-26')
  })

  it('leaves change empty without a previous price, and price empty without a price', () => {
    const [priced] = buildHoldingsBoard([valuePosition(position({}), '200', '35')], [instrument({ lastPrice: '200', lastPriceAt: '2026-10-27T01:00:00.000Z' })])
    expect([priced.price?.toString(), priced.changePct, priced.priceDay]).toEqual(['200', null, '2026-10-27'])
    const [unpriced] = buildHoldingsBoard([valuePosition(position({}))], [instrument({})])
    expect([unpriced.price, unpriced.changePct, unpriced.priceDay]).toEqual([null, null, null])
  })

  it('skips closed positions', () => {
    expect(buildHoldingsBoard([valuePosition(position({ quantity: D(0) }), '200', '35')], [instrument({ lastPrice: '200' })])).toEqual([])
  })
})

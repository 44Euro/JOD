import { describe, expect, it } from 'vitest'
import { D } from '../domain/decimal'
import type { Position } from '../domain/ledger'
import { valuePosition } from '../domain/valuation'
import { buildRateBoard } from './rateBoard'

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

describe('buildRateBoard', () => {
  it('compares your average rate with today and sums the currency effect', () => {
    const usd = valuePosition(position({}), '120', '33')
    const thb = valuePosition(
      position({ key: 'acc-1|SET:PTT', instrumentId: 'SET:PTT', currency: 'THB', costQuote: D(330), costBase: D(330) }),
      '35',
      '1',
    )
    const rows = buildRateBoard([usd, thb], 'THB', { USD: { rate: '33', note: 'ECB 15 ม.ค. 2024' }, THB: { rate: '1', note: '' } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ currency: 'USD', todayNote: 'ECB 15 ม.ค. 2024' })
    expect(rows[0].mine.toString()).toBe('35')
    expect(rows[0].today?.toString()).toBe('33')
    expect(rows[0].diffPct?.toFixed(2)).toBe('-5.71')
    expect(rows[0].effectBase?.toString()).toBe('-2400')
  })

  it('holds the market value of the priced positions plus the cost of the unpriced ones, in the currency', () => {
    const priced = valuePosition(position({ quantity: D(5), costQuote: D(501), costBase: D(17034) }), '120', '33')
    const unpriced = valuePosition(
      position({ key: 'acc-1|US:MSFT', instrumentId: 'US:MSFT', quantity: D(1), costQuote: D(400), costBase: D(13600) }),
      undefined,
      '33',
    )
    const [row] = buildRateBoard([priced, unpriced], 'THB', { USD: { rate: '33', note: '' } })
    expect(row.heldQuote.toString()).toBe('1000')
  })

  it('leaves today empty when no rate is known yet', () => {
    const [row] = buildRateBoard([valuePosition(position({}), '120')], 'THB', {})
    expect(row.today).toBeNull()
    expect(row.diffPct).toBeNull()
    expect(row.effectBase).toBeNull()
  })
})

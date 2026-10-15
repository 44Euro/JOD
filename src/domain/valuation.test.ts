import { describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { D } from './decimal'
import type { Position } from './ledger'
import { avgFxByCurrency, latestRecordedRate, summarizePortfolio, valuePosition } from './valuation'

function position(overrides: Partial<Position> = {}): Position {
  return {
    key: 'acc-1|US:AAPL',
    accountId: 'acc-1',
    instrumentId: 'US:AAPL',
    currency: 'USD',
    quantity: D(10),
    costQuote: D(1000),
    costBase: D(35000),
    ...overrides,
  }
}

describe('valuePosition', () => {
  it('splits unrealized P/L into stock move and currency move', () => {
    const v = valuePosition(position(), '120', '33')
    expect(v.avgCostQuote.toString()).toBe('100')
    expect(v.avgFxRate?.toString()).toBe('35')
    expect(v.marketValueQuote?.toString()).toBe('1200')
    expect(v.marketValueBase?.toString()).toBe('39600')
    expect(v.unrealizedQuote?.toString()).toBe('200')
    expect(v.unrealizedBase?.toString()).toBe('4600')
    expect(v.priceEffectBase?.toString()).toBe('7000')
    expect(v.fxEffectBase?.toString()).toBe('-2400')
  })

  it('leaves market fields empty when there is no price', () => {
    const v = valuePosition(position(), undefined, '33')
    expect(v.marketValueQuote).toBeNull()
    expect(v.unrealizedBase).toBeNull()
  })

  it('computes quote values but not base values when the FX rate is missing', () => {
    const v = valuePosition(position(), '120', undefined)
    expect(v.unrealizedQuote?.toString()).toBe('200')
    expect(v.marketValueBase).toBeNull()
  })
})

describe('summarizePortfolio', () => {
  it('sums valued positions and counts the ones without a price', () => {
    const summary = summarizePortfolio([
      valuePosition(position(), '120', '33'),
      valuePosition(position({ key: 'acc-1|SET:PTT', currency: 'THB', costQuote: D(3400), costBase: D(3400), quantity: D(100) }), '35', '1'),
      valuePosition(position({ key: 'acc-1|US:MSFT' })),
    ])
    expect(summary.marketValueBase.toString()).toBe('43100')
    expect(summary.unrealizedBase.toString()).toBe('4700')
    expect(summary.fxEffectBase.toString()).toBe('-2400')
    expect(summary.unvaluedCount).toBe(1)
  })
})

describe('avgFxByCurrency', () => {
  it('returns the weighted average conversion rate per foreign currency', () => {
    const rows = avgFxByCurrency(
      [position(), position({ key: 'b', costQuote: D(1000), costBase: D(33000) }), position({ key: 'c', currency: 'THB' })],
      'THB',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].currency).toBe('USD')
    expect(rows[0].avgRate.toString()).toBe('34')
  })
})

describe('latestRecordedRate', () => {
  it('returns the rate of the most recent transaction in that currency', () => {
    const txs = [
      makeTx({ currency: 'VND', fxRate: '0.0014', date: '2024-03-01' }),
      makeTx({ currency: 'VND', fxRate: '0.0013', date: '2024-01-01' }),
    ]
    expect(latestRecordedRate(txs, 'VND')).toBe('0.0014')
    expect(latestRecordedRate(txs, 'TWD')).toBeUndefined()
  })
})

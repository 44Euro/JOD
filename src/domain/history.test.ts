import { describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { D } from './decimal'
import {
  cumulativeRealized,
  maxDrawdown,
  monthGrid,
  monthTotal,
  periodReturn,
  realizedByDay,
  timeWeighted,
  toDailyPoints,
  tradePricePoints,
} from './history'
import type { RealizedEvent } from './ledger'

const day = (date: string, value: string, invested: string) => ({ date, valueBase: value, netInvestedBase: invested })

describe('timeWeighted', () => {
  it('strips money put in, so a deposit is not taken for growth', () => {
    const points = timeWeighted(toDailyPoints([day('2024-01-02', '1100', '1000'), day('2024-01-01', '1000', '1000'), day('2024-01-03', '2100', '2000')]))
    expect(points.map((p) => p.date)).toEqual(['2024-01-01', '2024-01-02', '2024-01-03'])
    expect(points.map((p) => p.index.toFixed(4))).toEqual(['1.0000', '1.1000', '1.1000'])
    expect(periodReturn(points)?.toFixed(4)).toBe('0.1000')
  })

  it('does not count a withdrawal as a fall', () => {
    const points = timeWeighted(toDailyPoints([day('2024-01-01', '1000', '1000'), day('2024-01-02', '500', '500')]))
    expect(points[1].index.toFixed(4)).toBe('1.0000')
    expect(maxDrawdown(points)).toBeNull()
  })
})

describe('maxDrawdown', () => {
  it('finds the deepest fall from a high and when it happened', () => {
    const points = timeWeighted(
      toDailyPoints([day('2024-01-01', '100', '100'), day('2024-01-02', '120', '100'), day('2024-01-03', '90', '100'), day('2024-01-04', '130', '100'), day('2024-01-05', '117', '100')]),
    )
    const dd = maxDrawdown(points)!
    expect([dd.pct.toFixed(4), dd.peakDate, dd.troughDate]).toEqual(['-0.2500', '2024-01-02', '2024-01-03'])
  })
})

function sold(date: string, realized: string): RealizedEvent {
  const zero = D(0)
  return {
    txId: date, date, accountId: 'a', instrumentId: 'US:X', currency: 'USD', quantity: D(1), proceedsQuote: zero, costQuote: zero, realizedQuote: zero,
    proceedsBase: zero, costBase: zero, realizedBase: D(realized), priceEffectBase: zero, fxEffectBase: zero,
  } as RealizedEvent
}

describe('realised P/L over time', () => {
  const events = [sold('2024-03-05', '100'), sold('2024-03-05', '-30'), sold('2024-04-01', '50')]

  it('adds up day by day', () => {
    expect(cumulativeRealized(events).map((p) => [p.date, p.total.toString()])).toEqual([['2024-03-05', '70'], ['2024-04-01', '120']])
  })

  it('lays a month out from Monday with each day’s result', () => {
    const grid = monthGrid('2024-03', realizedByDay(events))
    expect(grid.slice(0, 4)).toEqual([null, null, null, null])
    expect(grid[4]).toEqual({ date: '2024-03-01', day: 1, pl: null })
    expect(grid.find((c) => c?.date === '2024-03-05')?.pl?.toString()).toBe('70')
    expect(grid.length).toBe(4 + 31)
    expect(monthTotal('2024-03', realizedByDay(events)).toString()).toBe('70')
  })
})

describe('tradePricePoints', () => {
  it('draws the asset from its own trades, oldest first, ending at the latest price', () => {
    const txs = [
      makeTx({ id: 's', type: 'sell', date: '2024-02-01', price: '120' }),
      makeTx({ id: 'b', type: 'buy', date: '2024-01-01', price: '100' }),
      makeTx({ id: 'd', type: 'dividend', date: '2024-01-15', price: undefined, amount: '5' }),
      makeTx({ id: 'o', instrumentId: 'US:MSFT', date: '2024-01-01' }),
    ]
    const points = tradePricePoints(txs, 'US:AAPL', { price: '130', date: '2024-03-01' })
    expect(points.map((p) => [p.date, p.kind, p.price.toString()])).toEqual([
      ['2024-01-01', 'buy', '100'],
      ['2024-02-01', 'sell', '120'],
      ['2024-03-01', 'last', '130'],
    ])
  })
})

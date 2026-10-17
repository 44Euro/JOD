import { describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { lastTwelveMonths } from './dates'
import { D } from './decimal'
import { allocate, currencyAllocation, groupHoldings, holdingStats, instrumentStats } from './holdings'
import { computeLedger } from './ledger'
import type { Transaction } from './types'
import { valuePosition } from './valuation'

const voo = { instrumentId: 'US:VOO' }
const transactions: Transaction[] = [
  makeTx({ ...voo, quantity: '10', price: '400', fxRate: '35', date: '2024-01-10' }),
  makeTx({ ...voo, type: 'dividend', quantity: undefined, price: undefined, amount: '20', tax: '3', fxRate: '34', date: '2024-03-01' }),
  makeTx({ ...voo, type: 'sell', quantity: '2', price: '450', fxRate: '34', date: '2024-04-01' }),
  makeTx({ ...voo, accountId: 'acc-2', quantity: '2', price: '400', fxRate: '35', date: '2024-02-01' }),
]

function setup(txs: Transaction[], price?: string) {
  const ledger = computeLedger(txs)
  const valuations = ledger.positions.map((p) => valuePosition(p, price, '33'))
  return { ledger, valuations }
}

describe('lastTwelveMonths', () => {
  it('lists the current month and the eleven before it, across the new year', () => {
    expect(lastTwelveMonths('2024-10-16')).toEqual([
      '2023-11', '2023-12', '2024-01', '2024-02', '2024-03', '2024-04',
      '2024-05', '2024-06', '2024-07', '2024-08', '2024-09', '2024-10',
    ])
  })
})

describe('holdingStats', () => {
  it('adds unrealized, realized and dividends of the holding in its own account', () => {
    const { ledger, valuations } = setup(transactions, '500')
    const [mine, other] = holdingStats(valuations, ledger, '2024-10-16')
    expect(mine.key).toBe('acc-1|US:VOO')
    expect(mine.unrealizedBase?.toString()).toBe('20000')
    expect(mine.realizedBase.toString()).toBe('2600')
    expect(mine.incomeBase.toString()).toBe('578')
    expect(mine.totalReturnBase?.toString()).toBe('23178')
    expect(mine.totalReturnPct?.toFixed(2)).toBe('20.69')
    expect(mine.yieldOnCostPct?.toFixed(2)).toBe('0.52')
    expect(other.key).toBe('acc-2|US:VOO')
    expect(other.totalReturnBase?.toString()).toBe('5000')
  })

  it('only counts income from the last twelve months in the yield on cost', () => {
    const { ledger, valuations } = setup(transactions, '500')
    const [mine] = holdingStats(valuations, ledger, '2025-06-20')
    expect(mine.income12mBase.toString()).toBe('0')
    expect(mine.yieldOnCostPct?.toString()).toBe('0')
    expect(mine.incomeBase.toString()).toBe('578')
  })

  it('has no total return while the price is unknown but keeps what is already realized', () => {
    const { ledger, valuations } = setup(transactions)
    const [mine] = holdingStats(valuations, ledger, '2024-10-16')
    expect(mine.valueBase).toBeNull()
    expect(mine.totalReturnBase).toBeNull()
    expect(mine.realizedBase.toString()).toBe('2600')
  })
})

describe('instrumentStats', () => {
  it('combines one instrument across accounts', () => {
    const { ledger, valuations } = setup(transactions, '500')
    const stats = instrumentStats('US:VOO', valuations, ledger, '2024-10-16')
    expect(stats?.quantity.toString()).toBe('10')
    expect(stats?.costBase.toString()).toBe('140000')
    expect(stats?.valueBase?.toString()).toBe('165000')
    expect(stats?.totalReturnBase?.toString()).toBe('28178')
    expect(stats?.totalReturnPct?.toFixed(2)).toBe('20.13')
    expect(stats?.yieldOnCostPct?.toFixed(2)).toBe('0.41')
  })

  it('still reports an instrument that was sold out', () => {
    const msft = [
      makeTx({ instrumentId: 'US:MSFT', quantity: '1', price: '100', fxRate: '35', date: '2024-01-10' }),
      makeTx({ instrumentId: 'US:MSFT', type: 'sell', quantity: '1', price: '120', fxRate: '35', date: '2024-02-10' }),
    ]
    const { ledger, valuations } = setup(msft, '130')
    const stats = instrumentStats('US:MSFT', valuations, ledger, '2024-10-16')
    expect(stats?.quantity.toString()).toBe('0')
    expect(stats?.valueBase?.toString()).toBe('0')
    expect(stats?.totalReturnBase?.toString()).toBe('700')
    expect(stats?.totalReturnPct).toBeNull()
    expect(instrumentStats('US:TSLA', valuations, ledger, '2024-10-16')).toBeNull()
  })
})

describe('allocation', () => {
  it('groups by key, adds cash and gives each group its share', () => {
    const rows = allocate([
      { key: 'THB', assetsBase: D(36000) },
      { key: 'USD', assetsBase: D(132000) },
      { key: 'USD', cashBase: D(3300) },
    ])
    expect(rows.map((r) => [r.key, r.assetsBase.toString(), r.cashBase.toString(), r.pct?.toFixed(2)])).toEqual([
      ['USD', '132000', '3300', '78.98'],
      ['THB', '36000', '0', '21.02'],
    ])
  })

  it('counts holdings by trading currency and skips cash with no rate yet', () => {
    const { valuations } = setup(transactions, '500')
    const rows = currencyAllocation(valuations, [
      { accountId: 'acc-1', currency: 'USD', amount: D(100), base: D(3300) },
      { accountId: 'acc-1', currency: 'JPY', amount: D(1000), base: null },
    ])
    expect(rows.map((r) => [r.key, r.totalBase.toString(), r.pct?.toString()])).toEqual([['USD', '168300', '100']])
  })
})

describe('groupHoldings', () => {
  it('adds value, gains and count per group with each group’s share', () => {
    const txs = [
      ...transactions,
      makeTx({ instrumentId: 'SET:PTT', currency: 'THB', quantity: '1000', price: '35', fxRate: '1', fxSource: 'same', date: '2024-05-01' }),
    ]
    const ledger = computeLedger(txs)
    const prices: Record<string, string> = { 'US:VOO': '500', 'SET:PTT': '36' }
    const valuations = ledger.positions.map((p) => valuePosition(p, prices[p.instrumentId], p.currency === 'THB' ? '1' : '33'))
    const groups = groupHoldings(holdingStats(valuations, ledger, '2024-10-16'), (s) => s.instrumentId.split(':')[0])
    expect(groups.map((g) => [g.key, g.totalBase.toString(), g.unrealizedBase.toString(), g.totalReturnBase.toString(), g.count, g.pct?.toFixed(1)])).toEqual([
      ['US', '165000', '25000', '28178', 2, '82.1'],
      ['SET', '36000', '1000', '1000', 1, '17.9'],
    ])
  })
})

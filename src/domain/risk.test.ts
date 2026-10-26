import { describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { D } from './decimal'
import { averageR, closedTradeDrawdown, initialRiskBase, positionSize, rMultiple } from './risk'
import type { Trade } from './trades'

function trade(overrides: Partial<Trade>): Trade {
  return {
    id: 't', instrumentId: 'US:AAPL', accountIds: ['acc-1'], openDate: '2024-01-01', closeDate: '2024-02-01', realizedBase: D(0),
    holdingDays: 31, txIds: [], closingTxId: null, hasStopLoss: true, mistakes: [], reviewed: false, ...overrides,
  }
}

describe('R-multiple', () => {
  const buy = makeTx({ id: 'b', quantity: '10', price: '100', fxRate: '35', journal: { stopLoss: '90' } })
  const byId = new Map([[buy.id, buy]])

  it('measures the result against the money at risk on the stop', () => {
    expect(initialRiskBase(trade({ txIds: ['b'] }), byId)?.toString()).toBe('3500')
    expect(rMultiple(trade({ txIds: ['b'], realizedBase: D(7000) }), byId)?.toString()).toBe('2')
  })

  it('has no R when a buy has no stop below its price', () => {
    const noStop = makeTx({ id: 'n', price: '100', journal: { stopLoss: '105' } })
    expect(rMultiple(trade({ txIds: ['b', 'n'] }), new Map([...byId, ['n', noStop]]))).toBeNull()
  })

  it('averages R over closed trades that have one', () => {
    const r = averageR([trade({ txIds: ['b'], realizedBase: D(7000) }), trade({ txIds: ['b'], realizedBase: D(-3500) }), trade({ txIds: [] })], byId)
    expect([r?.avg.toString(), r?.count]).toEqual(['0.5', 2])
  })
})

describe('closedTradeDrawdown', () => {
  it('finds the deepest fall of the running total in closing order', () => {
    const trades = [
      trade({ closeDate: '2024-01-03', realizedBase: D(-300) }),
      trade({ closeDate: '2024-01-01', realizedBase: D(500) }),
      trade({ closeDate: '2024-01-02', realizedBase: D(-200) }),
      trade({ closeDate: null, realizedBase: D(-9999) }),
    ]
    expect(closedTradeDrawdown(trades).toString()).toBe('-500')
  })
})

describe('positionSize', () => {
  it('sizes the buy so the stop loses the chosen share of the account, in whole lots', () => {
    const size = positionSize({ account: '100000', riskPct: '1', entry: '35', stop: '33', lot: '100' })
    expect([size?.units.toString(), size?.value.toString(), size?.riskAmount.toString()]).toEqual(['500', '17500', '1000'])
  })

  it('refuses a stop at or above the entry, and unfinished numbers', () => {
    expect(positionSize({ account: '100000', riskPct: '1', entry: '35', stop: '35', lot: '1' })).toBeNull()
    expect(positionSize({ account: '', riskPct: '1', entry: '35', stop: '30', lot: '1' })).toBeNull()
  })
})

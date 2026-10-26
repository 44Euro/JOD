import { describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { D } from './decimal'
import { planProgress, rebalance } from './plans'
import type { DcaPlan } from './types'

describe('rebalance', () => {
  const holdings = [
    { instrumentId: 'US:VOO', valueBase: D(60000) },
    { instrumentId: 'SET:PTT', valueBase: D(30000) },
    { instrumentId: 'CRYPTO:BTC', valueBase: D(10000) },
  ]

  it('says how much to buy or sell to reach each target, leaving untargeted holdings alone', () => {
    const r = rebalance(holdings, { 'US:VOO': '50', 'SET:PTT': '40' }, D(0))
    const row = (id: string) => r.rows.find((x) => x.instrumentId === id)!
    expect([row('US:VOO').currentPct.toString(), row('US:VOO').diffBase?.toString()]).toEqual(['60', '-10000'])
    expect(row('SET:PTT').diffBase?.toString()).toBe('10000')
    expect(row('CRYPTO:BTC').diffBase).toBeNull()
    expect(r.targetSum.toString()).toBe('90')
  })

  it('spends new cash on what is short of target, without selling', () => {
    const r = rebalance(holdings, { 'US:VOO': '50', 'SET:PTT': '40', 'CRYPTO:BTC': '10' }, D(20000))
    const row = (id: string) => r.rows.find((x) => x.instrumentId === id)!
    // Total 120,000: VOO is over (60,000 ≥ 60,000), PTT short 18,000, BTC short 2,000; exactly the new cash.
    expect([row('US:VOO').buyOnlyBase?.toString(), row('SET:PTT').buyOnlyBase?.toString(), row('CRYPTO:BTC').buyOnlyBase?.toString()]).toEqual(['0', '18000', '2000'])
  })

  it('spreads cash left over once every target is met', () => {
    const r = rebalance([{ instrumentId: 'A', valueBase: D(50) }, { instrumentId: 'B', valueBase: D(50) }], { A: '50', B: '50' }, D(100))
    expect(r.rows.map((x) => x.buyOnlyBase?.toString())).toEqual(['50', '50'])
  })
})

describe('planProgress', () => {
  const plan: DcaPlan = { id: 'p', accountId: 'acc-1', instrumentId: 'US:AAPL', amount: '100', currency: 'USD', frequency: 'monthly', startDate: '2024-01-10', createdAt: '' }

  it('marks each month done, partial, missed or still running', () => {
    const txs = [
      makeTx({ date: '2024-01-15', quantity: '1', price: '99.5' }),
      makeTx({ date: '2024-02-03', quantity: '0.5', price: '100' }),
      makeTx({ date: '2024-04-02', quantity: '1', price: '100', accountId: 'other' }),
      makeTx({ date: '2024-01-05', quantity: '5', price: '100' }),
    ]
    expect(planProgress(plan, txs, '2024-04-20').map((p) => [p.start, p.spent.toString(), p.state])).toEqual([
      ['2024-01-01', '99.5', 'done'],
      ['2024-02-01', '50', 'partial'],
      ['2024-03-01', '0', 'missed'],
      ['2024-04-01', '0', 'current'],
    ])
  })

  it('runs weekly periods from Monday', () => {
    const weeks = planProgress({ ...plan, frequency: 'weekly', startDate: '2024-01-10' }, [], '2024-01-20')
    expect(weeks.map((w) => [w.start, w.end])).toEqual([
      ['2024-01-08', '2024-01-14'],
      ['2024-01-15', '2024-01-21'],
    ])
  })
})

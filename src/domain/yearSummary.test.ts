import { describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { investorFlows } from './investor'
import { computeLedger } from './ledger'
import { yearSummary, yearsWithData } from './yearSummary'

const thb = { currency: 'THB', fxRate: '1', fxSource: 'same' as const }

describe('yearSummary', () => {
  const txs = [
    makeTx({ ...thb, id: 'd', type: 'deposit', amount: '50000', date: '2025-01-02', instrumentId: undefined, quantity: undefined, price: undefined }),
    makeTx({ id: 'b', date: '2025-01-05', quantity: '10', price: '100', fees: '2', fxRate: '35' }),
    makeTx({ id: 's', type: 'sell', date: '2026-02-01', quantity: '5', price: '120', fees: '1', fxRate: '34' }),
    makeTx({ id: 'div', type: 'dividend', date: '2026-03-01', amount: '10', tax: '1.5', fxRate: '34', quantity: undefined, price: undefined }),
    makeTx({ id: 'w', type: 'withdraw', date: '2026-04-01', amount: '100', fxRate: '34', remitToThailand: true, taxYear: 2026, instrumentId: undefined, quantity: undefined, price: undefined }),
  ]
  const ledger = computeLedger(txs)
  const flows = investorFlows(txs, ledger)

  it('counts only the year asked for, at each transaction’s own rate', () => {
    const s = yearSummary(2026, txs, ledger, flows, [
      { date: '2026-01-01', valueBase: '30000' },
      { date: '2025-12-31', valueBase: '29000' },
      { date: '2026-06-30', valueBase: '31000' },
    ])
    // Sold 5 of 10 bought for 1,002 USD at 35: cost 17,535; proceeds (600 − 1) × 34 = 20,366.
    expect(s.realizedBase.toString()).toBe('2831')
    expect(s.sells).toBe(1)
    expect([s.income.dividend.grossBase.toString(), s.income.dividend.taxBase.toString()]).toEqual(['340', '51'])
    expect(s.feesBase.toString()).toBe('34')
    expect(s.remittedBase.toString()).toBe('3400')
    expect([s.startValue?.date, s.endValue?.valueBase.toString()]).toEqual(['2026-01-01', '31000'])
  })

  it('counts money put in during the year', () => {
    const s = yearSummary(2025, txs, ledger, flows, [])
    expect(s.putInBase.toString()).toBe('50000')
    expect(s.feesBase.toString()).toBe('70')
    expect(s.startValue).toBeNull()
  })

  it('lists the years with records, newest first, including this one', () => {
    expect(yearsWithData(txs, '2027-01-05')).toEqual([2027, 2026, 2025])
  })
})

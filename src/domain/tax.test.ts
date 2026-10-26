import { describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { D } from './decimal'
import { computeLedger } from './ledger'
import { fundPurchases, incomeForTax, taxFundOf, taxFundStatus } from './tax'
import type { Instrument } from './types'

const fund = (symbol: string, taxFund?: Instrument['taxFund']): Instrument => ({
  id: `FUND:${symbol}`, market: 'FUND', symbol, name: symbol, assetType: 'fund', currency: 'THB', taxFund,
})
const thb = { currency: 'THB', fxRate: '1', fxSource: 'same' as const }

describe('taxFundOf', () => {
  it('reads the kind from the fund name unless the user set it', () => {
    expect(taxFundOf(fund('KFGBRANSSF'))).toBe('SSF')
    expect(taxFundOf(fund('K-USA-RMF'))).toBe('RMF')
    expect(taxFundOf(fund('KKP GB THAI ESG'))).toBe('THAIESG')
    expect(taxFundOf(fund('SCBS&P500'))).toBeNull()
    expect(taxFundOf(fund('KTAG70/30-ThaiESG'))).toBe('THAIESG')
    expect(taxFundOf(fund('PLAIN', 'SSF'))).toBe('SSF')
    expect(taxFundOf({ ...fund('XRMF'), assetType: 'stock' })).toBeNull()
  })
})

describe('taxFundStatus', () => {
  const ssf = fund('KFSSF')
  const txs = [
    makeTx({ ...thb, id: 'b1', instrumentId: ssf.id, date: '2020-03-10', quantity: '100', price: '10' }),
    makeTx({ ...thb, id: 'b2', instrumentId: ssf.id, date: '2024-02-29', quantity: '100', price: '12' }),
    makeTx({ ...thb, id: 's1', type: 'sell', instrumentId: ssf.id, date: '2030-03-10', quantity: '150', price: '15' }),
  ]

  it('lists when each held lot may be sold and flags units sold too early, first in first out', () => {
    const { lots, breaches } = taxFundStatus(txs, [ssf])
    expect(lots.map((l) => [l.txId, l.quantity.toString(), l.freeFrom])).toEqual([['b2', '50', '2034-03-01']])
    expect(breaches.map((b) => [b.boughtOn, b.quantity.toString(), b.freeFrom])).toEqual([['2024-02-29', '50', '2034-03-01']])
  })
})

describe('fundPurchases', () => {
  it('limits the deduction by share of income and cap, and warns when retirement funds pass 500,000', () => {
    const ssf = fund('ASSF')
    const rmf = fund('BRMF')
    const txs = [
      makeTx({ ...thb, instrumentId: ssf.id, date: '2025-05-01', quantity: '25000', price: '10' }),
      makeTx({ ...thb, instrumentId: rmf.id, date: '2025-06-01', quantity: '40000', price: '10' }),
      makeTx({ ...thb, instrumentId: rmf.id, date: '2024-06-01', quantity: '1', price: '10' }),
    ]
    const r = fundPurchases(2025, txs, [ssf, rmf], D(2_000_000))
    expect(r.rows.map((x) => [x.kind, x.boughtBase.toString(), x.deductibleBase?.toString()])).toEqual([
      ['SSF', '250000', '200000'],
      ['RMF', '400000', '400000'],
    ])
    expect(r.retirementOverCap).toBe(true)
    expect(fundPurchases(2025, txs, [ssf, rmf], null).rows[0].deductibleBase).toBeNull()
  })
})

describe('incomeForTax', () => {
  it('splits Thai dividends and interest from foreign income', () => {
    const ptt = { id: 'SET:PTT', market: 'SET' as const, symbol: 'PTT', name: 'PTT', assetType: 'stock' as const, currency: 'THB' }
    const txs = [
      makeTx({ ...thb, type: 'deposit', amount: '1000', instrumentId: undefined, quantity: undefined, price: undefined, date: '2025-01-01' }),
      makeTx({ ...thb, type: 'dividend', instrumentId: 'SET:PTT', amount: '100', tax: '10', quantity: undefined, price: undefined, date: '2025-03-01' }),
      makeTx({ ...thb, type: 'interest', amount: '50', tax: '7.5', instrumentId: undefined, quantity: undefined, price: undefined, date: '2025-04-01' }),
      makeTx({ type: 'dividend', amount: '10', tax: '1.5', fxRate: '34', quantity: undefined, price: undefined, date: '2025-05-01' }),
    ]
    const r = incomeForTax(2025, computeLedger(txs), [ptt])
    expect([r.thaiDividend.grossBase.toString(), r.thaiDividend.taxBase.toString()]).toEqual(['100', '10'])
    expect([r.thaiInterest.grossBase.toString(), r.thaiInterest.taxBase.toString()]).toEqual(['50', '7.5'])
    expect([r.foreign.grossBase.toString(), r.foreign.taxBase.toString()]).toEqual(['340', '51'])
  })
})

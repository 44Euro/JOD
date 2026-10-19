import { describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { D } from './decimal'
import { cashFxRows, convertHistory, convertSummaries, remittancesByTaxYear } from './fx'
import { computeLedger, type Ledger } from './ledger'

const thb = { currency: 'THB', fxRate: '1', fxSource: 'same' as const, instrumentId: undefined, quantity: undefined, price: undefined }
const convert = (amount: string, toAmount: string, marketRate: string | undefined, date: string) =>
  makeTx({ ...thb, type: 'fx_convert', amount, toCurrency: 'USD', toAmount, marketRate, date })

const skipping = (ledger: Ledger, ...txIds: string[]): Ledger => ({ ...ledger, issues: txIds.map((txId) => ({ txId, message: 'skipped' })) })

describe('convertSummaries', () => {
  it('sums exchanges per pair with the average rate and the spread paid (spec 7.3)', () => {
    const txs = [convert('34000', '1000', '33.5', '2024-01-03'), convert('33700', '1000', '33.52', '2024-02-03')]
    const [s] = convertSummaries(txs, computeLedger(txs))
    expect([s.from, s.to, s.count, s.fromTotal.toString(), s.toTotal.toString(), s.avgRate.toString()]).toEqual(['THB', 'USD', 2, '67700', '2000', '33.85'])
    expect(s.avgSpreadPct?.toFixed(2)).toBe('1.01')
    expect(s.spreadLostBase?.toString()).toBe('680')
  })

  it('leaves exchanges without a market rate out of the spread', () => {
    const txs = [convert('34000', '1000', '33.5', '2024-01-03'), convert('3400', '100', undefined, '2024-02-03')]
    const [s] = convertSummaries(txs, computeLedger(txs))
    expect([s.count, s.fromTotal.toString(), s.spreadLostBase?.toString()]).toEqual([2, '37400', '500'])
    expect(s.avgSpreadPct?.toFixed(2)).toBe('1.49')
  })

  it('has no spread when no exchange has a market rate', () => {
    const txs = [convert('34000', '1000', undefined, '2024-01-03')]
    const [s] = convertSummaries(txs, computeLedger(txs))
    expect([s.avgSpreadPct, s.spreadLostBase]).toEqual([null, null])
  })

  it('counts the spread in baht at the rate of the day when the source is a foreign currency', () => {
    const txs = [makeTx({ ...thb, type: 'fx_convert', currency: 'USD', fxRate: '34', amount: '100', toCurrency: 'JPY', toAmount: '14000', marketRate: '0.007', date: '2024-01-03' })]
    const [s] = convertSummaries(txs, computeLedger(txs))
    expect([s.from, s.to, s.spreadLostBase?.toString(), s.avgSpreadPct?.toFixed(2)]).toEqual(['USD', 'JPY', '68', '2.04'])
  })

  it('keeps each pair apart and puts the one used most often first', () => {
    const jpy = makeTx({ ...thb, type: 'fx_convert', amount: '1000', toCurrency: 'JPY', toAmount: '4300', date: '2024-01-02' })
    const txs = [jpy, convert('34000', '1000', '33.5', '2024-01-03'), convert('33700', '1000', '33.52', '2024-02-03')]
    expect(convertSummaries(txs, computeLedger(txs)).map((s) => [s.from, s.to, s.count])).toEqual([['THB', 'USD', 2], ['THB', 'JPY', 1]])
  })

  it('leaves out an exchange the ledger skipped', () => {
    const txs = [convert('34000', '1000', '33.5', '2024-01-03'), convert('33700', '1000', '33.52', '2024-02-03')]
    const [s] = convertSummaries(txs, skipping(computeLedger(txs), txs[1].id))
    expect([s.count, s.fromTotal.toString()]).toEqual([1, '34000'])
  })
})

describe('convertHistory', () => {
  it('lists exchanges newest first with the rate actually paid and its spread', () => {
    const txs = [convert('34000', '1000', '33.5', '2024-01-03'), convert('3400', '100', undefined, '2024-02-03')]
    const rows = convertHistory(txs, computeLedger(txs))
    expect(rows.map((r) => [r.txId, r.date, r.from, r.to, r.amount.toString(), r.toAmount.toString(), r.effectiveRate.toString()])).toEqual([
      [txs[1].id, '2024-02-03', 'THB', 'USD', '3400', '100', '34'],
      [txs[0].id, '2024-01-03', 'THB', 'USD', '34000', '1000', '34'],
    ])
    expect([rows[0].marketRate, rows[0].spreadPct]).toEqual([null, null])
    expect([rows[1].marketRate?.toString(), rows[1].spreadPct?.toFixed(2)]).toEqual(['33.5', '1.49'])
  })

  it('leaves out an exchange the ledger skipped', () => {
    const txs = [convert('34000', '1000', '33.5', '2024-01-03')]
    expect(convertHistory(txs, skipping(computeLedger(txs), txs[0].id))).toEqual([])
  })
})

describe('cashFxRows', () => {
  const held = [
    makeTx({ ...thb, type: 'deposit', amount: '35000', date: '2024-01-02' }),
    convert('34000', '1000', '33.5', '2024-01-03'),
    makeTx({ type: 'buy', quantity: '5', price: '100', fees: '1', fxRate: '34', date: '2024-01-04' }),
  ]

  it('values foreign cash against what it cost in baht', () => {
    const ledger = computeLedger(held)
    const usd = ledger.cash.find((c) => c.currency === 'USD')!
    expect([usd.amount.toString(), usd.costBase.toString()]).toEqual(['499', '16966'])
    const [row] = cashFxRows([{ ...usd, base: usd.amount.times(33) }], ledger, 'THB')
    expect([row.valueBase?.toString(), row.effectBase?.toString()]).toEqual(['16467', '-499'])
  })

  it('skips the base currency and gives no effect to cash that has no rate', () => {
    const ledger = computeLedger(held)
    const cash = ledger.cash.map((c) => ({ accountId: c.accountId, currency: c.currency, amount: c.amount, base: null }))
    const rows = cashFxRows(cash, ledger, 'THB')
    expect(rows.map((r) => [r.currency, r.amount.toString(), r.costBase.toString(), r.valueBase, r.effectBase])).toEqual([['USD', '499', '16966', null, null]])
  })

  it('leaves out cash that is not above zero, which has no cost to compare with', () => {
    const ledger = computeLedger([makeTx({ type: 'buy', quantity: '5', price: '100', fees: '1', fxRate: '34' })])
    const cash = ledger.cash.map((c) => ({ accountId: c.accountId, currency: c.currency, amount: c.amount, base: c.amount.times(33) }))
    expect(cash.map((c) => c.amount.toString())).toEqual(['-501'])
    expect(cashFxRows(cash, ledger, 'THB')).toEqual([])
  })

  it('shows no gain for cash that was sent in by an account that could not cover it', () => {
    const short = makeTx({ type: 'buy', quantity: '5', price: '100', fees: '1', fxRate: '34', date: '2024-01-04' })
    const send = makeTx({ type: 'transfer', toAccountId: 'acc-2', instrumentId: undefined, quantity: undefined, price: undefined, amount: '1000', fxRate: '34', date: '2024-01-05' })
    const ledger = computeLedger([short, send])
    const cash = ledger.cash.map((c) => ({ accountId: c.accountId, currency: c.currency, amount: c.amount, base: c.amount.times(33) }))
    const rows = cashFxRows(cash, ledger, 'THB')
    expect(rows.map((r) => [r.accountId, r.costBase.toString(), r.valueBase?.toString(), r.effectBase?.toString()])).toEqual([
      ['acc-2', '34000', '33000', '-1000'],
    ])
  })

  it('shows a gain when the foreign currency rose', () => {
    const ledger = computeLedger(held)
    const [row] = cashFxRows([{ accountId: 'acc-1', currency: 'USD', amount: D(499), base: D(499).times(35) }], ledger, 'THB')
    expect(row.effectBase?.toString()).toBe('499')
  })
})

describe('remittancesByTaxYear', () => {
  const remit = (amount: string, taxYear: number, date: string) => makeTx({ ...thb, type: 'withdraw', amount, remitToThailand: true, taxYear, date })

  it('adds up money brought back to Thailand by tax year', () => {
    const txs = [
      makeTx({ ...thb, type: 'deposit', amount: '500000', date: '2024-01-01' }),
      remit('100000', 2026, '2026-03-01'), remit('20000', 2026, '2026-06-01'), remit('45000', 2025, '2025-09-01'),
      makeTx({ ...thb, type: 'withdraw', amount: '1000', date: '2026-07-01' }),
    ]
    expect(remittancesByTaxYear(txs, computeLedger(txs)).map((r) => [r.taxYear, r.totalBase.toString(), r.count])).toEqual([
      [2026, '120000', 2], [2025, '45000', 1],
    ])
  })

  it('counts a foreign withdrawal in baht at the rate of the day', () => {
    const txs = [makeTx({ ...thb, type: 'withdraw', currency: 'USD', fxRate: '34', amount: '1000', remitToThailand: true, taxYear: 2026, date: '2026-03-01' })]
    expect(remittancesByTaxYear(txs, computeLedger(txs)).map((r) => [r.taxYear, r.totalBase.toString()])).toEqual([[2026, '34000']])
  })

  it('leaves out a withdrawal the ledger skipped', () => {
    const txs = [remit('100000', 2026, '2026-03-01'), remit('20000', 2026, '2026-06-01')]
    expect(remittancesByTaxYear(txs, skipping(computeLedger(txs), txs[0].id)).map((r) => [r.totalBase.toString(), r.count])).toEqual([['20000', 1]])
  })
})

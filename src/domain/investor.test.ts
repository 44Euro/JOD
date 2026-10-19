import { describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { sumBy } from './decimal'
import { dailySnapshot, summarizeInvestor } from './investor'
import { computeLedger } from './ledger'
import type { Transaction } from './types'
import { valuePosition } from './valuation'

function run(transactions: Transaction[], prices: Record<string, string>, rates: Record<string, string>) {
  const ledger = computeLedger(transactions)
  const valuations = ledger.positions.map((p) => valuePosition(p, prices[p.instrumentId], rates[p.currency]))
  return summarizeInvestor({ transactions, ledger, valuations, rates })
}

const thb = { currency: 'THB', fxRate: '1', fxSource: 'same' as const, instrumentId: undefined, quantity: undefined, price: undefined }

// Dime US: deposits baht, converts to USD, trades, gets a dividend, pays an account fee, withdraws baht.
const cashAccount = [
  makeTx({ ...thb, type: 'deposit', amount: '35000', date: '2024-01-02' }),
  makeTx({ ...thb, type: 'fx_convert', amount: '34000', toCurrency: 'USD', toAmount: '1000', marketRate: '33.5', date: '2024-01-03' }),
  makeTx({ type: 'buy', quantity: '5', price: '100', fees: '1', fxRate: '34', date: '2024-01-04' }),
  makeTx({ type: 'dividend', quantity: undefined, price: undefined, amount: '10', tax: '1.5', fxRate: '34', date: '2024-02-01' }),
  makeTx({ type: 'sell', quantity: '2', price: '110', fees: '1', fxRate: '33', date: '2024-02-02' }),
  makeTx({ type: 'fee', instrumentId: undefined, quantity: undefined, price: undefined, amount: '2', fxRate: '33', date: '2024-02-03' }),
  makeTx({ ...thb, type: 'withdraw', amount: '1000', date: '2024-02-04' }),
]

// Webull: only trades are recorded, so its computed cash (−512.50 USD) is not a real balance.
const tradeOnly = [
  makeTx({ accountId: 'acc-2', instrumentId: 'US:MSFT', quantity: '10', price: '100', fees: '1', fxRate: '35', date: '2024-01-10' }),
  makeTx({ accountId: 'acc-2', instrumentId: 'US:MSFT', type: 'dividend', quantity: undefined, price: undefined, amount: '10', tax: '1.5', fxRate: '34', date: '2024-02-01' }),
  makeTx({ accountId: 'acc-2', instrumentId: 'US:MSFT', type: 'sell', quantity: '4', price: '120', fxRate: '33', date: '2024-03-10' }),
]

describe('summarizeInvestor for an account that records cash', () => {
  const result = run(cashAccount, { 'US:AAPL': '120' }, { USD: '33' })

  it('counts deposits minus withdrawals as money invested', () => {
    expect(result.invested.totalBase.toString()).toBe('34000')
    expect(result.invested.inBase.toString()).toBe('35000')
    expect(result.invested.outBase.toString()).toBe('1000')
  })

  it('values holdings and the cash of the account at today’s rate', () => {
    expect(result.worth.holdingsBase.toString()).toBe('11880')
    expect(result.worth.cashBase.toString()).toBe('23908.5')
    expect(result.worth.totalBase.toString()).toBe('35788.5')
  })

  it('splits the total gain into parts that add up exactly', () => {
    const { gain } = result
    expect(gain.totalBase.toString()).toBe('1788.5')
    expect(gain.unrealizedPriceBase.toString()).toBe('2019.6')
    expect(gain.unrealizedFxBase.toString()).toBe('-360')
    expect(gain.realizedBase.toString()).toBe('413.4')
    expect(gain.incomeBase.toString()).toBe('289')
    expect(gain.otherFeesBase.toString()).toBe('66')
    expect(gain.cashFxBase.toString()).toBe('-507.5')
  })
})

describe('summarizeInvestor for an account that only records trades', () => {
  const result = run(tradeOnly, { 'US:MSFT': '130' }, { USD: '33' })

  it('treats payments as money in and receipts as money out', () => {
    expect(result.invested.totalBase.toString()).toBe('18906')
    expect(result.invested.inBase.toString()).toBe('35035')
    expect(result.invested.outBase.toString()).toBe('16129')
  })

  it('leaves its computed cash out of the value', () => {
    expect(result.worth.cash).toEqual([])
    expect(result.worth.cashBase.toString()).toBe('0')
    expect(result.worth.totalBase.toString()).toBe('25740')
  })

  it('has no cash currency effect', () => {
    expect(result.gain.totalBase.toString()).toBe('6834')
    expect(result.gain.realizedBase.toString()).toBe('1826')
    expect(result.gain.incomeBase.toString()).toBe('289')
    expect(result.gain.unrealizedPriceBase.toString()).toBe('6279')
    expect(result.gain.unrealizedFxBase.toString()).toBe('-1560')
    expect(result.gain.cashFxBase.toString()).toBe('0')
  })
})

describe('summarizeInvestor across accounts and edge cases', () => {
  it('adds both kinds of accounts and keeps the parts adding up', () => {
    const { gain, invested, worth } = run([...cashAccount, ...tradeOnly], { 'US:AAPL': '120', 'US:MSFT': '130' }, { USD: '33' })
    expect(invested.totalBase.toString()).toBe('52906')
    expect(worth.totalBase.toString()).toBe('61528.5')
    expect(gain.totalBase.toString()).toBe('8622.5')
    const parts = gain.unrealizedPriceBase
      .plus(gain.unrealizedFxBase)
      .plus(gain.realizedBase)
      .plus(gain.incomeBase)
      .minus(gain.otherFeesBase)
      .plus(gain.cashFxBase)
    expect(parts.toString()).toBe('8622.5')
  })

  it('counts an opening holding and opening cash as money put in', () => {
    const result = run(
      [
        makeTx({ type: 'opening', instrumentId: 'US:VOO', quantity: '10', price: '400', fxRate: '34.5', fxSource: 'estimated', date: '2024-01-01' }),
        makeTx({ type: 'opening', instrumentId: undefined, quantity: undefined, price: undefined, amount: '100', fxRate: '34', date: '2024-01-01' }),
      ],
      { 'US:VOO': '400' },
      { USD: '34.5' },
    )
    expect(result.invested.totalBase.toString()).toBe('141400')
    expect(result.worth.totalBase.toString()).toBe('141450')
    expect(result.gain.cashFxBase.toString()).toBe('50')
  })

  it('counts fees on deposits, withdrawals and account fees as other fees', () => {
    const result = run(
      [
        makeTx({ ...thb, type: 'deposit', amount: '10000', fees: '10', date: '2024-01-01' }),
        makeTx({ ...thb, type: 'withdraw', amount: '2000', fees: '5', tax: '2', date: '2024-01-02' }),
        makeTx({ ...thb, type: 'fee', amount: '20', date: '2024-01-03' }),
      ],
      {},
      { THB: '1' },
    )
    expect(result.invested.totalBase.toString()).toBe('8000')
    expect(result.worth.totalBase.toString()).toBe('7963')
    expect(result.gain.otherFeesBase.toString()).toBe('37')
    expect(result.gain.cashFxBase.toString()).toBe('0')
  })

  it('counts an exchange fee once, as an other fee, because it comes out of the amount exchanged', () => {
    const result = run(
      [
        makeTx({ ...thb, type: 'deposit', amount: '20000', date: '2024-01-01' }),
        makeTx({ ...thb, type: 'fx_convert', amount: '20000', fees: '50', toCurrency: 'USD', toAmount: '595.52', marketRate: '33.5', date: '2024-01-02' }),
      ],
      {},
      { THB: '1', USD: '33.5' },
    )
    const { gain } = result
    expect(result.worth.totalBase.toString()).toBe('19949.92')
    expect(gain.totalBase.toString()).toBe('-50.08')
    expect(gain.otherFeesBase.toString()).toBe('50')
    expect(gain.cashFxBase.toString()).toBe('-0.08')
    const parts = [gain.unrealizedPriceBase, gain.unrealizedFxBase, gain.realizedBase, gain.incomeBase, gain.otherFeesBase.negated(), gain.cashFxBase]
    expect(sumBy(parts, (part) => part).toString()).toBe(gain.totalBase.toString())
  })

  it('values a holding without a price at its cost instead of zero', () => {
    const result = run([makeTx({ quantity: '2', price: '100', fxRate: '35' })], {}, { USD: '33' })
    expect(result.worth.holdingsBase.toString()).toBe('7000')
    expect(result.worth.unpricedCount).toBe(1)
    expect(result.gain.totalBase.toString()).toBe('0')
  })

  it('leaves out a sell the ledger could not count', () => {
    const buy = makeTx({ quantity: '2', price: '100', fxRate: '35', date: '2024-01-10' })
    const oversell = makeTx({ type: 'sell', quantity: '5', price: '100', fxRate: '35', date: '2024-01-20' })
    const result = run([buy, oversell], { 'US:AAPL': '100' }, { USD: '35' })
    expect(result.flows.map((f) => f.txId)).toEqual([buy.id])
    expect(result.gain.totalBase.toString()).toBe('0')
  })

  it('lists currencies that have no rate today and counts those holdings at cost', () => {
    const result = run([makeTx({ quantity: '1', price: '100', fxRate: '35' })], { 'US:AAPL': '120' }, {})
    expect(result.worth.missingRates).toEqual(['USD'])
    expect(result.worth.holdingsBase.toString()).toBe('3500')
  })
})

describe('summarizeInvestor with transfers', () => {
  it('leaves the gain at the price move alone when cash moves to a trade-only account that then buys', () => {
    // KBank records cash; Streaming only records trades, so its cash is not part of the value.
    const txs = [
      makeTx({ ...thb, accountId: 'kbank', type: 'deposit', amount: '50000', date: '2024-01-02' }),
      makeTx({ ...thb, accountId: 'kbank', type: 'transfer', toAccountId: 'streaming', amount: '20000', date: '2024-01-03' }),
      makeTx({ ...thb, accountId: 'streaming', type: 'buy', instrumentId: 'SET:PTT', quantity: '500', price: '36', date: '2024-01-04' }),
    ]
    const result = run(txs, { 'SET:PTT': '38' }, { THB: '1' })
    expect(result.invested.totalBase.toString()).toBe('48000')
    expect(result.worth.totalBase.toString()).toBe('49000')
    expect(result.gain.totalBase.toString()).toBe('1000')
    expect(result.gain.unrealizedPriceBase.toString()).toBe('1000')
    expect(result.gain.cashFxBase.toString()).toBe('0')
  })

  it('counts a transfer fee between two cash accounts as another fee', () => {
    const txs = [
      makeTx({ ...thb, accountId: 'acc-2', type: 'deposit', amount: '1', date: '2024-01-01' }),
      makeTx({ ...thb, type: 'deposit', amount: '50000', date: '2024-01-02' }),
      makeTx({ ...thb, type: 'transfer', toAccountId: 'acc-2', amount: '20000', fees: '25', date: '2024-01-03' }),
    ]
    const result = run(txs, {}, { THB: '1' })
    expect(result.invested.totalBase.toString()).toBe('50001')
    expect(result.worth.totalBase.toString()).toBe('49976')
    expect(result.gain.totalBase.toString()).toBe('-25')
    expect(result.gain.otherFeesBase.toString()).toBe('25')
    expect(result.gain.cashFxBase.toString()).toBe('0')
  })
})

describe('summarizeInvestor with swaps', () => {
  const buyBtc = makeTx({ instrumentId: 'CRYPTO:BTC', quantity: '0.01', price: '58000', fxRate: '34', date: '2024-03-01' })
  const swap = (fees: string) =>
    makeTx({
      type: 'swap',
      instrumentId: 'CRYPTO:BTC',
      quantity: '0.01',
      price: undefined,
      toInstrumentId: 'CRYPTO:ETH',
      toQuantity: '0.25',
      amount: '660',
      fees,
      fxRate: '35',
      date: '2024-04-01',
    })

  it('puts only the fee of a swap in as money, and the gain on the coin given up shows as realized', () => {
    const result = run([buyBtc, swap('1.5')], { 'CRYPTO:ETH': '2700' }, { USD: '36' })
    expect(result.flows.map((f) => f.amountBase.toString())).toEqual(['19720', '52.5'])
    expect(result.invested.totalBase.toString()).toBe('19772.5')
    expect(result.worth.totalBase.toString()).toBe('24300')
    expect(result.gain.totalBase.toString()).toBe('4527.5')
    expect(result.gain.realizedBase.toString()).toBe('3380')
    expect(result.gain.otherFeesBase.toString()).toBe('0')
    expect(result.gain.cashFxBase.toString()).toBe('0')
  })

  it('moves no money for a swap without fees', () => {
    expect(run([buyBtc, swap('0')], {}, { USD: '36' }).flows.map((f) => f.txId)).toEqual([buyBtc.id])
  })
})

describe('summarizeInvestor with a fee paid in an asset', () => {
  // A trade-only account: 1 BNB at 500, then 1 ETH at 2,000 whose fee is 0.001 BNB, worth 0.60 USD, all at rate 34.
  const buyBnb = makeTx({ instrumentId: 'CRYPTO:BNB', quantity: '1', price: '500', fxRate: '34', date: '2024-01-10' })
  const buyEth = makeTx({
    instrumentId: 'CRYPTO:ETH',
    quantity: '1',
    price: '2000',
    fxRate: '34',
    date: '2024-01-11',
    feePaidIn: 'asset',
    feeInstrumentId: 'CRYPTO:BNB',
    feeQuantity: '0.001',
    fees: '0.6',
  })

  it('keeps the parts of the gain adding up exactly, with the BNB sold at the value of the fee', () => {
    const result = run([buyBnb, buyEth], { 'CRYPTO:ETH': '2100', 'CRYPTO:BNB': '600' }, { USD: '34' })
    // Money put in: BNB 500 x 34 = 17,000, ETH paid in cash 2,000 x 34 = 68,000. The fee leaves no cash behind.
    expect(result.flows.map((f) => f.amountBase.toString())).toEqual(['17000', '68000'])
    expect(result.invested.totalBase.toString()).toBe('85000')
    // Worth: ETH 2,100 x 34 = 71,400, and 0.999 BNB x 600 x 34 = 20,379.6.
    expect(result.worth.totalBase.toString()).toBe('91779.6')
    expect(result.gain.totalBase.toString()).toBe('6779.6')
    // Unrealized: ETH costs 2,000.6 x 34 = 68,020.4, so 71,400 - 68,020.4 = 3,379.6; 0.999 BNB costs 16,983,
    // so 20,379.6 - 16,983 = 3,396.6; together 6,776.2, all from price because the rate never moved.
    expect(result.gain.unrealizedPriceBase.toString()).toBe('6776.2')
    expect(result.gain.unrealizedFxBase.toString()).toBe('0')
    // Realized: 0.001 BNB sold at 0.60 USD = 20.4, cost 17, so 3.4.
    expect(result.gain.realizedBase.toString()).toBe('3.4')
    // 6,776.2 + 3.4 = 6,779.6 is the whole gain, so nothing is left for fees, income or the currency of cash.
    expect(result.gain.otherFeesBase.toString()).toBe('0')
    expect(result.gain.incomeBase.toString()).toBe('0')
    expect(result.gain.cashFxBase.toString()).toBe('0')
  })
})

describe('summarizeInvestor with assets received as income', () => {
  const staking = (overrides: Partial<Transaction> = {}) =>
    makeTx({ type: 'receive_asset', receiveKind: 'staking', instrumentId: 'CRYPTO:SOL', quantity: '0.5', price: '150', fxRate: '35', ...overrides })

  it('counts an asset received in a trade-only account as income, not as gain from price', () => {
    const txs = [staking()]
    const result = run(txs, { 'CRYPTO:SOL': '150' }, { USD: '35' })
    expect(result.gain.totalBase.toString()).toBe('2625')
    expect(result.gain.incomeBase.toString()).toBe('2625')
    expect(result.gain.cashFxBase.toString()).toBe('0')
  })

  it('counts the tax paid on it as money put in, so the gain is the income after tax', () => {
    const result = run([staking({ tax: '5' })], { 'CRYPTO:SOL': '150' }, { USD: '35' })
    expect(result.invested.totalBase.toString()).toBe('175')
    expect(result.gain.totalBase.toString()).toBe('2450')
    expect(result.gain.incomeBase.toString()).toBe('2450')
    expect(result.gain.cashFxBase.toString()).toBe('0')
  })

  it('keeps the parts adding up in an account that records cash', () => {
    const deposit = makeTx({ ...thb, type: 'deposit', amount: '1000', date: '2024-01-01' })
    const result = run([deposit, staking({ currency: 'THB', fxRate: '1', price: '4000', tax: '10', fees: '5' })], { 'CRYPTO:SOL': '4000' }, { THB: '1' })
    expect(result.invested.totalBase.toString()).toBe('1000')
    expect(result.worth.totalBase.toString()).toBe('2985')
    expect(result.gain.totalBase.toString()).toBe('1985')
    expect(result.gain.incomeBase.toString()).toBe('1985')
    expect(result.gain.cashFxBase.toString()).toBe('0')
  })
})

describe('dailySnapshot', () => {
  it('rounds today’s value and money invested to satang', () => {
    const summary = run(cashAccount, { 'US:AAPL': '120' }, { USD: '33' })
    expect(dailySnapshot(summary)).toEqual({ valueBase: '35788.50', netInvestedBase: '34000.00' })
  })

  it('waits until every currency has a rate, and skips a portfolio with no money in yet', () => {
    expect(dailySnapshot(run([makeTx({ quantity: '1', price: '100', fxRate: '35' })], { 'US:AAPL': '120' }, {}))).toBeNull()
    expect(dailySnapshot(run([], {}, {}))).toBeNull()
  })
})

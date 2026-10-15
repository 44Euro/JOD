import { describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { computeLedger } from './ledger'

describe('computeLedger positions and realized P/L', () => {
  const buy1 = makeTx({ type: 'buy', quantity: '10', price: '100', fees: '1', fxRate: '35', date: '2024-01-10' })
  const buy2 = makeTx({ type: 'buy', quantity: '10', price: '120', fees: '1', fxRate: '33', date: '2024-02-10' })
  const sell1 = makeTx({ type: 'sell', quantity: '5', price: '130', fees: '1', fxRate: '34', date: '2024-03-10' })

  it('tracks average cost in both quote and base currency', () => {
    const { positions } = computeLedger([buy1, buy2])
    expect(positions).toHaveLength(1)
    expect(positions[0].quantity.toString()).toBe('20')
    expect(positions[0].costQuote.toString()).toBe('2202')
    expect(positions[0].costBase.toString()).toBe('74668')
  })

  it('splits realized P/L into price effect and FX effect that add up exactly', () => {
    const { realized, positions } = computeLedger([buy1, buy2, sell1])
    const event = realized[0]
    expect(event.costQuote.toString()).toBe('550.5')
    expect(event.realizedQuote.toString()).toBe('98.5')
    expect(event.proceedsBase.toString()).toBe('22066')
    expect(event.costBase.toString()).toBe('18667')
    expect(event.realizedBase.toString()).toBe('3399')
    expect(event.priceEffectBase.toFixed(2)).toBe('3340.05')
    expect(event.fxEffectBase.toFixed(2)).toBe('58.95')
    expect(event.priceEffectBase.plus(event.fxEffectBase).toString()).toBe('3399')
    expect(positions[0].quantity.toString()).toBe('15')
    expect(positions[0].costQuote.toString()).toBe('1651.5')
    expect(positions[0].costBase.toString()).toBe('56001')
  })

  it('removes the position with no leftover cost when everything is sold', () => {
    const sellAll = makeTx({ type: 'sell', quantity: '15', price: '90', fees: '1', fxRate: '36', date: '2024-04-10' })
    const { realized, positions } = computeLedger([buy1, buy2, sell1, sellAll])
    expect(positions).toHaveLength(0)
    expect(realized[1].realizedQuote.toString()).toBe('-302.5')
    expect(realized[1].realizedBase.toString()).toBe('-7437')
  })

  it('handles thirds without leaving a residue on the final sell', () => {
    const buy = makeTx({ type: 'buy', quantity: '3', price: '10', fees: '1', fxRate: '35' })
    const s1 = makeTx({ type: 'sell', quantity: '1', price: '10', fxRate: '35', date: '2024-01-16' })
    const s2 = makeTx({ type: 'sell', quantity: '2', price: '10', fxRate: '35', date: '2024-01-17' })
    const { realized, positions } = computeLedger([buy, s1, s2])
    expect(positions).toHaveLength(0)
    expect(realized[0].realizedBase.plus(realized[1].realizedBase).toString()).toBe('-35')
  })

  it('keeps tiny crypto quantities as plain decimals', () => {
    const btc = makeTx({ instrumentId: 'CRYPTO:BTC', quantity: '0.00000001', price: '60000', fees: '0.5', fxRate: '34' })
    const { positions } = computeLedger([btc])
    expect(positions[0].quantity.toString()).toBe('0.00000001')
    expect(positions[0].costQuote.toString()).toBe('0.5006')
  })

  it('multiplies quantity on a split and keeps total cost', () => {
    const buy = makeTx({ quantity: '10', price: '400', fxRate: '35' })
    const split = makeTx({ type: 'split', splitRatio: '4', date: '2024-02-01', quantity: undefined, price: undefined })
    const { positions } = computeLedger([buy, split])
    expect(positions[0].quantity.toString()).toBe('40')
    expect(positions[0].costQuote.toString()).toBe('4000')
  })

  it('reports an issue and skips a sell larger than the holding', () => {
    const buy = makeTx({ quantity: '2', price: '100' })
    const oversell = makeTx({ type: 'sell', quantity: '5', price: '100', date: '2024-01-20' })
    const { issues, realized, positions } = computeLedger([buy, oversell])
    expect(issues).toEqual([{ txId: oversell.id, message: 'ขาย 5 หน่วย แต่ถืออยู่ 2 หน่วย' }])
    expect(realized).toHaveLength(0)
    expect(positions[0].quantity.toString()).toBe('2')
  })

  it('orders same-day transactions by time before entry order', () => {
    const sell = makeTx({ type: 'sell', quantity: '1', price: '110', date: '2024-01-15', time: '15:00' })
    const buy = makeTx({ type: 'buy', quantity: '1', price: '100', date: '2024-01-15', time: '10:00' })
    const { issues, realized } = computeLedger([sell, buy])
    expect(issues).toHaveLength(0)
    expect(realized[0].realizedQuote.toString()).toBe('10')
  })

  it('reports an issue when a buy uses a different currency than the holding', () => {
    const usd = makeTx({ quantity: '1', price: '100', currency: 'USD' })
    const thb = makeTx({ quantity: '1', price: '3500', currency: 'THB', fxRate: '1', date: '2024-01-16' })
    const { issues, positions } = computeLedger([usd, thb])
    expect(issues[0].txId).toBe(thb.id)
    expect(positions[0].quantity.toString()).toBe('1')
  })
})

describe('computeLedger cash, income and fees', () => {
  it('tracks cash per account and currency across conversions', () => {
    const txs = [
      makeTx({ type: 'deposit', currency: 'THB', amount: '35000', fxRate: '1', fxSource: 'same', instrumentId: undefined, date: '2024-01-01' }),
      makeTx({ type: 'fx_convert', currency: 'THB', amount: '34000', toCurrency: 'USD', toAmount: '1000', fxRate: '1', fxSource: 'same', instrumentId: undefined, date: '2024-01-02' }),
      makeTx({ type: 'buy', quantity: '5', price: '100', fees: '1', fxRate: '34', date: '2024-01-03' }),
      makeTx({ type: 'dividend', amount: '10', tax: '1.5', fxRate: '34', date: '2024-02-01', quantity: undefined, price: undefined }),
      makeTx({ type: 'withdraw', currency: 'THB', amount: '500', fxRate: '1', fxSource: 'same', instrumentId: undefined, date: '2024-02-02' }),
      makeTx({ type: 'fee', amount: '2', fxRate: '34', instrumentId: undefined, date: '2024-02-03' }),
    ]
    const ledger = computeLedger(txs)
    const byCurrency = Object.fromEntries(ledger.cash.map((row) => [row.currency, row.amount.toString()]))
    expect(byCurrency).toEqual({ THB: '500', USD: '505.5' })
    expect(ledger.income[0]).toMatchObject({ kind: 'dividend', instrumentId: 'US:AAPL' })
    expect(ledger.income[0].netQuote.toString()).toBe('8.5')
    expect(ledger.income[0].netBase.toString()).toBe('289')
    expect(ledger.feesBase.toString()).toBe('102')
  })

  it('treats opening holdings as existing positions and opening cash as a balance', () => {
    const txs = [
      makeTx({ type: 'opening', instrumentId: 'US:VOO', quantity: '10', price: '400', fxRate: '34.5', fxSource: 'estimated', date: '2024-01-01' }),
      makeTx({ type: 'opening', instrumentId: undefined, quantity: undefined, price: undefined, amount: '100', fxRate: '34', date: '2024-01-01' }),
      makeTx({ type: 'interest', instrumentId: undefined, quantity: undefined, price: undefined, amount: '2', tax: '0.3', fxRate: '34', date: '2024-02-01' }),
    ]
    const ledger = computeLedger(txs)
    expect(ledger.positions[0].instrumentId).toBe('US:VOO')
    expect(ledger.positions[0].costQuote.toString()).toBe('4000')
    expect(ledger.positions[0].costBase.toString()).toBe('138000')
    expect(ledger.cash.map((row) => [row.currency, row.amount.toString()])).toEqual([['USD', '101.7']])
    expect(ledger.income).toHaveLength(1)
    expect(ledger.income[0]).toMatchObject({ kind: 'interest', instrumentId: '' })
    expect(ledger.income[0].netBase.toString()).toBe('57.8')
  })
})

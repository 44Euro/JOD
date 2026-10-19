import { describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { computeLedger } from './ledger'
import { matchTrades } from './trades'
import type { Transaction } from './types'

describe('matchTrades', () => {
  const buy1 = makeTx({ type: 'buy', quantity: '10', price: '100', fees: '1', fxRate: '35', date: '2024-01-10' })
  const buy2 = makeTx({ type: 'buy', quantity: '10', price: '120', fees: '1', fxRate: '33', date: '2024-02-10' })
  const sell1 = makeTx({ type: 'sell', quantity: '5', price: '130', fees: '1', fxRate: '34', date: '2024-03-10' })
  const sellAll = makeTx({ type: 'sell', quantity: '15', price: '90', fees: '1', fxRate: '36', date: '2024-04-10' })
  const trades = (txs: Transaction[]) => matchTrades(txs, computeLedger(txs))

  it('counts buys and sells from the first unit to the last as one trade (spec 7.6)', () => {
    const [t] = trades([buy1, buy2, sell1, sellAll])
    expect([t.openDate, t.closeDate, t.holdingDays, t.closingTxId]).toEqual(['2024-01-10', '2024-04-10', 91, sellAll.id])
    expect(t.realizedBase.toString()).toBe('-4038')
    expect(t.txIds).toEqual([buy1.id, buy2.id, sell1.id, sellAll.id])
  })

  it('starts a new trade when the holding comes back from zero', () => {
    const again = makeTx({ type: 'buy', quantity: '1', price: '95', fxRate: '36', date: '2024-05-01' })
    const list = trades([buy1, buy2, sell1, sellAll, again])
    expect(list.map((t) => [t.id, t.closeDate])).toEqual([[buy1.id, '2024-04-10'], [again.id, null]])
  })

  it('keeps a trade open when its units move to another account and closes it where they are sold', () => {
    const buy = makeTx({ quantity: '10', price: '100', fxRate: '34', date: '2024-01-10' })
    const move = makeTx({ type: 'transfer', toAccountId: 'acc-2', quantity: '4', price: undefined, date: '2024-01-20' })
    const sellHere = makeTx({ type: 'sell', quantity: '6', price: '110', fxRate: '34', date: '2024-02-01' })
    const sellThere = makeTx({ type: 'sell', accountId: 'acc-2', quantity: '4', price: '120', fxRate: '34', date: '2024-03-01' })
    const opened = trades([buy, move, sellHere])
    expect(opened).toHaveLength(1)
    expect(opened[0].closeDate).toBeNull()
    const [t] = trades([buy, move, sellHere, sellThere])
    expect([t.closeDate, t.holdingDays, t.accountIds]).toEqual(['2024-03-01', 51, ['acc-1', 'acc-2']])
    expect(t.realizedBase.toString()).toBe('4760')
  })

  it('keeps a trade open when its units move to another account (all of them)', () => {
    const buy = makeTx({ quantity: '10', price: '100', fxRate: '34', date: '2024-01-10' })
    const moveAll = makeTx({ type: 'transfer', toAccountId: 'acc-2', quantity: '10', price: undefined, date: '2024-01-20' })
    const list = trades([buy, moveAll])
    expect(list).toHaveLength(1)
    expect(list[0].closeDate).toBeNull()
    expect(list[0].accountIds).toEqual(['acc-1', 'acc-2'])
  })

  it('keeps a trade open and whole when all its units are sent to the same account', () => {
    const buy = makeTx({ quantity: '10', price: '100', fxRate: '34', date: '2024-01-10' })
    const moveAll = makeTx({ type: 'transfer', toAccountId: 'acc-1', quantity: '10', price: undefined, date: '2024-01-20' })
    const sell = makeTx({ type: 'sell', quantity: '10', price: '110', fxRate: '34', date: '2024-02-01' })
    const list = trades([buy, moveAll, sell])
    expect(list.map((t) => [t.id, t.closeDate, t.txIds])).toEqual([[buy.id, '2024-02-01', [buy.id, moveAll.id, sell.id]]])
  })

  describe('a transfer into an account that already holds the asset from a trade of its own', () => {
    const send = makeTx({ type: 'transfer', toAccountId: 'acc-2', quantity: '4', price: undefined, date: '2024-02-01' })
    const sellHere = makeTx({ type: 'sell', quantity: '6', price: '110', fxRate: '34', date: '2024-02-10' })
    const sellThere = makeTx({ type: 'sell', accountId: 'acc-2', quantity: '6', price: '120', fxRate: '34', date: '2024-03-01' })

    it('joins the two trades into the one opened first and closes it when both accounts have sold out', () => {
      const already = makeTx({ accountId: 'acc-2', quantity: '2', price: '110', fxRate: '33', date: '2024-01-05' })
      const buy = makeTx({ quantity: '10', price: '100', fxRate: '34', date: '2024-01-10' })
      expect(trades([already, buy])).toHaveLength(2)
      expect(trades([already, buy, send, sellHere])).toHaveLength(1)
      const [t] = trades([already, buy, send, sellHere, sellThere])
      expect([t.id, t.openDate, t.closeDate, t.holdingDays, t.closingTxId]).toEqual([already.id, '2024-01-05', '2024-03-01', 56, sellThere.id])
      expect(t.accountIds).toEqual(['acc-2', 'acc-1'])
      expect(t.txIds).toEqual([already.id, buy.id, send.id, sellHere.id, sellThere.id])
      expect(t.realizedBase.toString()).toBe('5660')
    })

    it('keeps the earlier trade when it is the one the units come from', () => {
      const buy = makeTx({ quantity: '10', price: '100', fxRate: '34', date: '2024-01-05' })
      const later = makeTx({ accountId: 'acc-2', quantity: '2', price: '110', fxRate: '33', date: '2024-01-10' })
      const list = trades([buy, later, send, sellHere, sellThere])
      expect(list.map((t) => [t.id, t.openDate, t.closeDate, t.accountIds])).toEqual([[buy.id, '2024-01-05', '2024-03-01', ['acc-1', 'acc-2']]])
    })
  })

  it('takes the strategy and feeling from the first buy that has them', () => {
    const plain = makeTx({ quantity: '1', price: '100', date: '2024-01-10' })
    const tagged = makeTx({ quantity: '1', price: '100', date: '2024-01-11', journal: { strategy: 'Breakout', emotion: 'fomo', stopLoss: '90' } })
    const close = makeTx({ type: 'sell', quantity: '2', price: '90', date: '2024-01-12', journal: { review: 'chased it', mistakes: ['chased'] } })
    const [t] = trades([plain, tagged, close])
    expect([t.strategy, t.emotion, t.hasStopLoss, t.mistakes, t.reviewed]).toEqual(['Breakout', 'fomo', true, ['chased'], true])
  })

  it('takes each of the strategy and the feeling from the first buy that filled it in', () => {
    const first = makeTx({ quantity: '1', price: '100', date: '2024-01-10', journal: { strategy: 'Breakout' } })
    const second = makeTx({ quantity: '1', price: '100', date: '2024-01-11', journal: { strategy: 'Pullback', emotion: 'calm' } })
    const [t] = trades([first, second])
    expect([t.strategy, t.emotion, t.hasStopLoss, t.mistakes, t.reviewed]).toEqual(['Breakout', 'calm', false, [], false])
  })

  it('lists each mistake once, whichever transaction of the trade named it', () => {
    const buy = makeTx({ quantity: '2', price: '100', date: '2024-01-10', journal: { mistakes: ['chased', 'no_stop'] } })
    const half = makeTx({ type: 'sell', quantity: '1', price: '90', date: '2024-01-11', journal: { mistakes: ['sold_early', 'chased'] } })
    const rest = makeTx({ type: 'sell', quantity: '1', price: '90', date: '2024-01-12' })
    expect(trades([buy, half, rest])[0].mistakes).toEqual(['chased', 'no_stop', 'sold_early'])
  })

  it('counts a trade as reviewed from the journal of the sell that closed it', () => {
    const buy = makeTx({ quantity: '2', price: '100', date: '2024-01-10' })
    const half = makeTx({ type: 'sell', quantity: '1', price: '90', date: '2024-01-11', journal: { review: 'too early' } })
    const rest = (journal?: Transaction['journal']) => makeTx({ type: 'sell', quantity: '1', price: '90', date: '2024-01-12', journal })
    expect(trades([buy, half])[0].reviewed).toBe(false)
    expect(trades([buy, half, rest()])[0].reviewed).toBe(false)
    expect(trades([buy, half, rest({ review: '  ' })])[0].reviewed).toBe(false)
    expect(trades([buy, half, rest({ score: 4 })])[0].reviewed).toBe(true)
    expect(trades([buy, half, rest({ review: 'ok' })])[0].reviewed).toBe(true)
  })

  it('closes the coin given up in a swap and opens the one received', () => {
    const btc = makeTx({ instrumentId: 'CRYPTO:BTC', quantity: '0.01', price: '58000', fxRate: '34', date: '2024-03-01' })
    const swap = makeTx({ instrumentId: 'CRYPTO:BTC', type: 'swap', quantity: '0.01', price: undefined, toInstrumentId: 'CRYPTO:ETH', toQuantity: '0.25', amount: '660', fxRate: '35', date: '2024-04-01' })
    const list = trades([btc, swap])
    expect(list.map((t) => [t.instrumentId, t.closeDate, t.realizedBase.toString()])).toEqual([
      ['CRYPTO:BTC', '2024-04-01', '3380'],
      ['CRYPTO:ETH', null, '0'],
    ])
  })

  it('neither opens nor closes a trade on a split', () => {
    const buy = makeTx({ quantity: '10', price: '100', date: '2024-01-10' })
    const split = makeTx({ type: 'split', splitRatio: '2', quantity: undefined, price: undefined, date: '2024-02-01' })
    expect(trades([buy, split])).toHaveLength(1)
  })

  it('opens a trade from an opening holding and from an asset received as income', () => {
    const received = makeTx({ instrumentId: 'CRYPTO:ETH', type: 'receive_asset', quantity: '2', price: '1000', date: '2024-01-05' })
    const opening = makeTx({ type: 'opening', quantity: '5', price: '100', fxRate: '34', date: '2024-01-01' })
    const sell = makeTx({ type: 'sell', quantity: '5', price: '120', fxRate: '34', date: '2024-02-01' })
    const list = trades([received, opening, sell])
    expect(list.map((t) => [t.id, t.instrumentId, t.openDate, t.closeDate, t.realizedBase.toString()])).toEqual([
      [opening.id, 'US:AAPL', '2024-01-01', '2024-02-01', '3400'],
      [received.id, 'CRYPTO:ETH', '2024-01-05', null, '0'],
    ])
  })

  it('lists trades by the day they opened', () => {
    const eth = makeTx({ instrumentId: 'CRYPTO:ETH', quantity: '1', price: '2000', date: '2024-02-01' })
    const aapl = makeTx({ quantity: '1', price: '100', date: '2024-01-01' })
    expect(trades([eth, aapl]).map((t) => t.instrumentId)).toEqual(['US:AAPL', 'CRYPTO:ETH'])
  })

  it('leaves out a transaction the ledger skipped', () => {
    const buy = makeTx({ quantity: '2', price: '100', date: '2024-01-10' })
    const oversell = makeTx({ type: 'sell', quantity: '5', price: '100', date: '2024-01-11' })
    const [t] = trades([buy, oversell])
    expect([t.closeDate, t.txIds]).toEqual([null, [buy.id]])
  })

  describe('a fee paid with another asset', () => {
    const bnb = makeTx({ instrumentId: 'CRYPTO:BNB', quantity: '1', price: '500', fxRate: '35', date: '2024-01-10' })
    const eth = makeTx({ instrumentId: 'CRYPTO:ETH', quantity: '1', price: '2000', fxRate: '35', date: '2024-01-11', feePaidIn: 'asset', feeInstrumentId: 'CRYPTO:BNB', feeQuantity: '0.001', fees: '0.6' })
    const sell = makeTx({ instrumentId: 'CRYPTO:ETH', type: 'sell', quantity: '1', price: '2100', fxRate: '35', date: '2024-01-12', feePaidIn: 'asset', feeInstrumentId: 'CRYPTO:BNB', feeQuantity: '0.999', fees: '1' })

    it('counts its gain in the trade of the fee asset and not in the trade it paid for', () => {
      const list = trades([bnb, eth, sell])
      const byAsset = new Map(list.map((t) => [t.instrumentId, t]))
      expect(byAsset.get('CRYPTO:ETH')!.realizedBase.toString()).toBe('3444')
      expect(byAsset.get('CRYPTO:BNB')!.realizedBase.toString()).toBe('-17444')
      expect(byAsset.get('CRYPTO:ETH')!.txIds).toEqual([eth.id, sell.id])
      expect(byAsset.get('CRYPTO:BNB')!.txIds).toEqual([bnb.id, eth.id, sell.id])
    })

    it('closes the trade of the fee asset when the fee takes the last of it', () => {
      const byAsset = new Map(trades([bnb, eth, sell]).map((t) => [t.instrumentId, t]))
      expect(byAsset.get('CRYPTO:BNB')!.closeDate).toBe('2024-01-12')
      expect(byAsset.get('CRYPTO:BNB')!.closingTxId).toBe(sell.id)
      expect(trades([bnb, eth]).find((t) => t.instrumentId === 'CRYPTO:BNB')!.closeDate).toBeNull()
    })
  })
})

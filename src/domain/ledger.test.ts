import { describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import {
  accountTracksCash,
  cashDeltaQuote,
  computeLedger,
  feeFromCash,
  feesQuote,
  receivedUnitCost,
  saleProceedsQuote,
  type Ledger,
} from './ledger'
import type { Transaction } from './types'

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

  it('takes an exchange fee out of the amount exchanged instead of adding it on top', () => {
    const ledger = computeLedger([
      makeTx({ type: 'opening', instrumentId: undefined, quantity: undefined, price: undefined, currency: 'THB', amount: '30000', fxRate: '1', fxSource: 'same', date: '2024-01-01' }),
      makeTx({ type: 'fx_convert', currency: 'THB', amount: '20000', fees: '50', toCurrency: 'USD', toAmount: '595.52', fxRate: '1', fxSource: 'same', instrumentId: undefined, date: '2024-01-02' }),
    ])
    expect(Object.fromEntries(ledger.cash.map((row) => [row.currency, row.amount.toString()]))).toEqual({ THB: '10000', USD: '595.52' })
    expect(ledger.feesBase.toString()).toBe('50')
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

describe('computeLedger transfers', () => {
  const thb = { currency: 'THB', fxRate: '1', fxSource: 'same' as const, instrumentId: undefined, quantity: undefined, price: undefined }
  const buy = makeTx({ quantity: '10', price: '100', fees: '1', fxRate: '34', date: '2024-01-10' })
  const send = (quantity: string) =>
    makeTx({ type: 'transfer', toAccountId: 'acc-2', quantity, price: undefined, fxRate: '35', date: '2024-02-01' })
  const rows = (ledger: Ledger) =>
    ledger.positions.map((p) => [p.key, p.quantity.toString(), p.costQuote.toString(), p.costBase.toString()])

  it('moves units with their cost and purchase rate to the other account, with no gain', () => {
    const ledger = computeLedger([buy, send('4')])
    expect(ledger.issues).toEqual([])
    expect(ledger.realized).toEqual([])
    expect(rows(ledger)).toEqual([
      ['acc-1|US:AAPL', '6', '600.6', '20420.4'],
      ['acc-2|US:AAPL', '4', '400.4', '13613.6'],
    ])
  })

  it('moves the whole cost when the whole holding goes', () => {
    expect(rows(computeLedger([buy, send('10')]))).toEqual([['acc-2|US:AAPL', '10', '1001', '34034']])
  })

  it('adds the units and both costs to what the other account already holds', () => {
    const already = makeTx({ accountId: 'acc-2', quantity: '2', price: '110', fxRate: '33', date: '2024-01-05' })
    expect(rows(computeLedger([already, buy, send('4')]))).toEqual([
      ['acc-1|US:AAPL', '6', '600.6', '20420.4'],
      ['acc-2|US:AAPL', '6', '620.4', '20873.6'],
    ])
  })

  it('refuses a transfer to an account that holds the asset in another currency', () => {
    const inBaht = makeTx({ accountId: 'acc-2', currency: 'THB', quantity: '2', price: '110', fxRate: '1', fxSource: 'same', date: '2024-01-05' })
    const move = { ...send('4'), fees: '2' }
    const ledger = computeLedger([inBaht, buy, move])
    expect(ledger.issues).toEqual([{ txId: move.id, message: 'สกุลเงิน USD ไม่ตรงกับที่ถืออยู่ในบัญชีปลายทาง (THB)' }])
    expect(rows(ledger)).toEqual([
      ['acc-1|US:AAPL', '10', '1001', '34034'],
      ['acc-2|US:AAPL', '2', '220', '220'],
    ])
    const without = computeLedger([inBaht, buy])
    expect(ledger.cash).toEqual(without.cash)
    expect(ledger.feesBase.toString()).toBe(without.feesBase.toString())
  })

  it('refuses a transfer larger than the holding and leaves both accounts alone', () => {
    const tooMany = send('12')
    const ledger = computeLedger([buy, tooMany])
    expect(ledger.issues).toEqual([{ txId: tooMany.id, message: 'โอน 12 หน่วย แต่ถืออยู่ 10 หน่วย' }])
    expect(rows(ledger)).toEqual([['acc-1|US:AAPL', '10', '1001', '34034']])
  })

  it('turns a transfer into an issue when the buy before it is gone', () => {
    expect(computeLedger([send('4')]).issues[0].message).toBe('โอน 4 หน่วย แต่ถืออยู่ 0 หน่วย')
  })

  it('moves cash and charges the transfer fee to the sending account', () => {
    const { cash, feesBase } = computeLedger([
      makeTx({ ...thb, type: 'deposit', amount: '50000', date: '2024-01-02' }),
      makeTx({ ...thb, type: 'transfer', toAccountId: 'acc-2', amount: '20000', fees: '25', date: '2024-01-03' }),
    ])
    expect(cash.map((c) => [c.accountId, c.currency, c.amount.toString()])).toEqual([
      ['acc-1', 'THB', '29975'],
      ['acc-2', 'THB', '20000'],
    ])
    expect(feesBase.toString()).toBe('25')
  })
})

describe('computeLedger swaps', () => {
  const crypto = { instrumentId: 'CRYPTO:BTC', currency: 'USD' }
  const buyBtc = makeTx({ ...crypto, quantity: '0.01', price: '58000', fxRate: '34', date: '2024-03-01' })
  const swap = (overrides: Partial<Transaction> = {}) =>
    makeTx({
      ...crypto,
      type: 'swap',
      quantity: '0.01',
      price: undefined,
      toInstrumentId: 'CRYPTO:ETH',
      toQuantity: '0.25',
      amount: '660',
      fxRate: '35',
      date: '2024-04-01',
      ...overrides,
    })

  it('sells the coin given up and buys the one received at the total value (spec 7.3)', () => {
    const { realized, positions } = computeLedger([buyBtc, swap()])
    expect(realized).toHaveLength(1)
    const e = realized[0]
    expect([e.instrumentId, e.proceedsQuote, e.costQuote, e.realizedQuote].map(String)).toEqual(['CRYPTO:BTC', '660', '580', '80'])
    expect([e.proceedsBase, e.costBase, e.realizedBase, e.priceEffectBase, e.fxEffectBase].map(String)).toEqual([
      '23100', '19720', '3380', '2720', '660',
    ])
    expect(positions.map((p) => [p.key, p.quantity.toString(), p.costQuote.toString(), p.costBase.toString()])).toEqual([
      ['acc-1|CRYPTO:ETH', '0.25', '660', '23100'],
    ])
  })

  it('adds a cash fee to the cost of the coin received', () => {
    const { positions, cash, realized } = computeLedger([buyBtc, swap({ fees: '1.5' })])
    expect(positions[0].costQuote.toString()).toBe('661.5')
    expect(positions[0].costBase.toString()).toBe('23152.5')
    expect(realized[0].realizedQuote.toString()).toBe('80')
    expect(cash.map((c) => c.amount.toString())).toEqual(['-581.5'])
  })

  it('takes cost in proportion when only part of the holding is swapped', () => {
    const buy = makeTx({ ...crypto, quantity: '0.02', price: '50000', fxRate: '34', date: '2024-03-01' })
    const { realized, positions } = computeLedger([buy, swap({ quantity: '0.005', toQuantity: '0.1', amount: '300', fxRate: '34' })])
    expect([realized[0].costQuote, realized[0].realizedQuote, realized[0].realizedBase].map(String)).toEqual(['250', '50', '1700'])
    expect(positions.map((p) => [p.key, p.quantity.toString(), p.costQuote.toString(), p.costBase.toString()])).toEqual([
      ['acc-1|CRYPTO:BTC', '0.015', '750', '25500'],
      ['acc-1|CRYPTO:ETH', '0.1', '300', '10200'],
    ])
  })

  it('refuses a swap larger than the holding', () => {
    const ledger = computeLedger([buyBtc, swap({ quantity: '0.02' })])
    expect(ledger.issues[0].message).toBe('แลก 0.02 หน่วย แต่ถืออยู่ 0.01 หน่วย')
    expect(ledger.positions.map((p) => p.key)).toEqual(['acc-1|CRYPTO:BTC'])
  })

  it('counts tax like a fee and reports both as fees paid', () => {
    const { positions, cash, feesBase } = computeLedger([buyBtc, swap({ fees: '1.5', tax: '0.5' })])
    expect(positions[0].costQuote.toString()).toBe('662')
    expect(positions[0].costBase.toString()).toBe('23170')
    expect(cash.map((c) => c.amount.toString())).toEqual(['-582'])
    expect(feesBase.toString()).toBe('70')
  })

  it('adds the coin received to what is already held, at the cost of this swap', () => {
    const ethBefore = makeTx({ instrumentId: 'CRYPTO:ETH', currency: 'USD', quantity: '1', price: '2000', fxRate: '33', date: '2024-02-01' })
    const { positions } = computeLedger([ethBefore, buyBtc, swap()])
    expect(positions.map((p) => [p.key, p.quantity.toString(), p.costQuote.toString(), p.costBase.toString()])).toEqual([
      ['acc-1|CRYPTO:ETH', '1.25', '2660', '89100'],
    ])
  })

  it('refuses a swap when the coin given up is held in another currency', () => {
    const inBaht = makeTx({ instrumentId: 'CRYPTO:BTC', currency: 'THB', quantity: '0.01', price: '2000000', fxRate: '1', fxSource: 'same', date: '2024-03-01' })
    const ledger = computeLedger([inBaht, swap()])
    expect(ledger.issues[0].message).toBe('BTC ถืออยู่เป็น THB · รายการนี้ใช้ USD')
  })

  it('refuses a swap that would add to a coin held in another currency and leaves everything alone', () => {
    const ethInBaht = makeTx({ instrumentId: 'CRYPTO:ETH', currency: 'THB', quantity: '1', price: '90000', fxRate: '1', fxSource: 'same', date: '2024-02-01' })
    const skipped = swap({ fees: '2' })
    const ledger = computeLedger([ethInBaht, buyBtc, skipped])
    expect(ledger.issues).toEqual([{ txId: skipped.id, message: 'ETH ถืออยู่เป็น THB · รายการนี้ใช้ USD' }])
    const without = computeLedger([ethInBaht, buyBtc])
    expect(ledger.positions.map((p) => [p.key, p.quantity.toString()])).toEqual(without.positions.map((p) => [p.key, p.quantity.toString()]))
    expect(ledger.realized).toEqual([])
    expect(ledger.cash).toEqual(without.cash)
    expect(ledger.feesBase.toString()).toBe(without.feesBase.toString())
  })

  it('turns a swap into an issue when the buy before it is gone', () => {
    expect(computeLedger([swap()]).issues[0].message).toBe('แลก 0.01 หน่วย แต่ถืออยู่ 0 หน่วย')
  })

  it('leaves cash and fees alone when the swap is refused', () => {
    const ledger = computeLedger([buyBtc, swap({ quantity: '0.02', fees: '3' })])
    expect(ledger.cash.map((c) => c.amount.toString())).toEqual(['-580'])
    expect(ledger.feesBase.toString()).toBe('0')
    expect(ledger.realized).toEqual([])
  })
})

describe('computeLedger assets received as income', () => {
  const thb = { currency: 'THB', fxRate: '1', fxSource: 'same' as const }

  it('adds staked coins at their value on the day and counts the same value as income (spec 7.3)', () => {
    const { positions, income } = computeLedger([
      makeTx({ type: 'receive_asset', receiveKind: 'staking', instrumentId: 'CRYPTO:SOL', quantity: '0.5', price: '150', fxRate: '35' }),
    ])
    expect([positions[0].quantity, positions[0].costQuote, positions[0].costBase].map(String)).toEqual(['0.5', '75', '2625'])
    expect(income[0].kind).toBe('receive_asset')
    expect([income[0].grossQuote, income[0].netQuote, income[0].netBase].map(String)).toEqual(['75', '75', '2625'])
  })

  it('takes the withholding tax of a stock dividend from cash and from the income, not from the cost', () => {
    const set = { ...thb, instrumentId: 'SET:PTT' }
    const { positions, income, cash } = computeLedger([
      makeTx({ ...set, type: 'buy', quantity: '1000', price: '35', date: '2024-01-10' }),
      makeTx({ ...set, type: 'receive_asset', receiveKind: 'stock_dividend', quantity: '100', price: '1', tax: '10', date: '2024-05-10' }),
    ])
    expect([positions[0].quantity, positions[0].costQuote].map(String)).toEqual(['1100', '35100'])
    expect([income[0].grossQuote, income[0].taxQuote, income[0].netQuote].map(String)).toEqual(['100', '10', '90'])
    expect(cash[0].amount.toString()).toBe('-35010')
  })

  it('takes a fee from the income and reports it as a fee paid, but never adds it to the cost', () => {
    const ledger = computeLedger([
      makeTx({ type: 'receive_asset', receiveKind: 'airdrop', instrumentId: 'CRYPTO:ARB', quantity: '100', price: '1.2', fees: '2', tax: '3', fxRate: '35' }),
    ])
    expect(ledger.positions[0].costQuote.toString()).toBe('120')
    expect([ledger.income[0].grossQuote, ledger.income[0].taxQuote, ledger.income[0].netQuote].map(String)).toEqual(['120', '3', '115'])
    expect(ledger.cash[0].amount.toString()).toBe('-5')
    expect(ledger.feesBase.toString()).toBe('70')
  })

  it('starts an airdrop with no value at a cost of zero', () => {
    const ledger = computeLedger([
      makeTx({ type: 'receive_asset', receiveKind: 'airdrop', instrumentId: 'CRYPTO:ARB', quantity: '100', price: '0' }),
    ])
    expect([ledger.positions[0].quantity, ledger.positions[0].costQuote, ledger.positions[0].costBase].map(String)).toEqual(['100', '0', '0'])
    expect(ledger.income[0].netBase.toString()).toBe('0')
  })

  describe('cost that came from received units', () => {
    const sol = { instrumentId: 'CRYPTO:SOL', fxRate: '35' }
    const bought = makeTx({ ...sol, quantity: '10', price: '100', date: '2024-01-10' })
    const staked = makeTx({ ...sol, type: 'receive_asset', receiveKind: 'staking', quantity: '0.5', price: '150', date: '2024-02-10' })
    const sell = (quantity: string) => makeTx({ ...sol, type: 'sell', quantity, price: '120', date: '2024-03-10' })
    const shares = (ledger: Ledger) => ledger.positions.map((p) => [p.key, p.quantity, p.costBase, p.receivedCostBase].map(String))

    it('is zero for units that were paid for and the base cost of what was received', () => {
      expect(shares(computeLedger([bought]))).toEqual([['acc-1|CRYPTO:SOL', '10', '35000', '0']])
      expect(shares(computeLedger([bought, staked]))).toEqual([['acc-1|CRYPTO:SOL', '10.5', '37625', '2625']])
    })

    it('leaves in proportion with the units that are sold, and with all of them when everything goes', () => {
      expect(shares(computeLedger([bought, staked, sell('5.25')]))).toEqual([['acc-1|CRYPTO:SOL', '5.25', '18812.5', '1312.5']])
      expect(computeLedger([bought, staked, sell('10.5')]).positions).toEqual([])
    })

    it('leaves in proportion with the units that are swapped away', () => {
      const swap = makeTx({
        ...sol,
        type: 'swap',
        quantity: '5.25',
        price: undefined,
        toInstrumentId: 'CRYPTO:ETH',
        toQuantity: '0.3',
        amount: '700',
        date: '2024-03-10',
      })
      expect(shares(computeLedger([bought, staked, swap]))).toEqual([
        ['acc-1|CRYPTO:ETH', '0.3', '24500', '0'],
        ['acc-1|CRYPTO:SOL', '5.25', '18812.5', '1312.5'],
      ])
    })

    it('moves with the units that are transferred and adds to what the other account already holds', () => {
      const send = makeTx({ ...sol, type: 'transfer', toAccountId: 'acc-2', quantity: '5.25', price: undefined, date: '2024-03-10' })
      const there = makeTx({ ...sol, accountId: 'acc-2', quantity: '1', price: '90', date: '2024-01-05' })
      expect(shares(computeLedger([bought, staked, send]))).toEqual([
        ['acc-1|CRYPTO:SOL', '5.25', '18812.5', '1312.5'],
        ['acc-2|CRYPTO:SOL', '5.25', '18812.5', '1312.5'],
      ])
      expect(shares(computeLedger([there, bought, staked, send]))[1]).toEqual(['acc-2|CRYPTO:SOL', '6.25', '21962.5', '1312.5'])
    })

    it('does not change when units are split', () => {
      const split = makeTx({ ...sol, type: 'split', quantity: undefined, price: undefined, splitRatio: '2', date: '2024-03-10' })
      expect(shares(computeLedger([bought, staked, split]))).toEqual([['acc-1|CRYPTO:SOL', '21', '37625', '2625']])
    })
  })

  it('refuses an asset received in another currency than the one held and leaves everything alone', () => {
    const buy = makeTx({ ...thb, instrumentId: 'CRYPTO:SOL', quantity: '1', price: '5000', date: '2024-01-10' })
    const received = makeTx({ type: 'receive_asset', receiveKind: 'staking', instrumentId: 'CRYPTO:SOL', quantity: '0.5', price: '150', tax: '1' })
    const ledger = computeLedger([buy, received])
    expect(ledger.issues).toEqual([{ txId: received.id, message: 'สกุลเงิน USD ไม่ตรงกับที่ถืออยู่ (THB)' }])
    expect(ledger.income).toEqual([])
    expect(ledger.cash).toEqual(computeLedger([buy]).cash)
    expect(ledger.positions[0].quantity.toString()).toBe('1')
  })
})

describe('receivedUnitCost', () => {
  const swap = (overrides: Partial<Transaction> = {}) =>
    makeTx({ type: 'swap', toInstrumentId: 'CRYPTO:ETH', toQuantity: '0.25', amount: '660', ...overrides })

  it('spreads the value, fees and tax over the units received', () => {
    expect(receivedUnitCost(swap())?.toString()).toBe('2640')
    expect(receivedUnitCost(swap({ fees: '1.5', tax: '0.5' }))?.toString()).toBe('2648')
  })

  it('spreads the cost over the units that arrive when the fee took some of them', () => {
    expect(receivedUnitCost(swap({ feePaidIn: 'received', feeQuantity: '0.05' }))?.toString()).toBe('3300')
  })

  it('has no cost per unit without units received', () => {
    expect(receivedUnitCost(swap({ toQuantity: '0' }))).toBeNull()
    expect(receivedUnitCost(swap({ toQuantity: undefined }))).toBeNull()
  })
})

describe('accountTracksCash', () => {
  const cashless = { instrumentId: undefined, quantity: undefined, price: undefined, amount: '100' }

  it('is false for an account that only records trades and income', () => {
    const txs = [makeTx({ accountId: 'a' }), makeTx({ accountId: 'a', type: 'dividend', ...cashless, instrumentId: 'US:AAPL' })]
    expect(accountTracksCash(txs, 'a')).toBe(false)
  })

  it('is true once the account has a deposit, withdrawal, exchange or opening cash', () => {
    for (const type of ['deposit', 'withdraw', 'fx_convert', 'opening'] as const) {
      expect(accountTracksCash([makeTx({ accountId: 'a' }), makeTx({ accountId: 'a', type, ...cashless })], 'a')).toBe(true)
    }
  })

  it('ignores an opening holding and other accounts', () => {
    const txs = [
      makeTx({ accountId: 'a', type: 'opening', quantity: '1', price: '100' }),
      makeTx({ accountId: 'b', type: 'deposit', ...cashless }),
    ]
    expect(accountTracksCash(txs, 'a')).toBe(false)
    expect(accountTracksCash(txs, 'b')).toBe(true)
  })
})

describe('computeLedger fees paid in an asset', () => {
  const eth = { instrumentId: 'CRYPTO:ETH', currency: 'USD', fxRate: '34' }
  const buyBnb = (quantity: string) =>
    makeTx({ instrumentId: 'CRYPTO:BNB', currency: 'USD', quantity, price: '500', fxRate: '34', date: '2024-01-10' })
  const bnbFee = { feePaidIn: 'asset' as const, feeInstrumentId: 'CRYPTO:BNB', feeQuantity: '0.001', fees: '0.6' }

  it('keeps the fee units out of a buy whose fee was taken from the coins received', () => {
    const { positions, cash, feesBase } = computeLedger([
      makeTx({ ...eth, quantity: '1', price: '2000', feePaidIn: 'received', feeQuantity: '0.001' }),
    ])
    expect([positions[0].quantity, positions[0].costQuote, positions[0].costBase].map(String)).toEqual(['0.999', '2000', '68000'])
    expect(cash[0].amount.toString()).toBe('-2000')
    expect(feesBase.toString()).toBe('68')
  })

  it('pays a buy fee with BNB: the fee joins the cost and the BNB is sold at its value (spec 7.3)', () => {
    const buyEth = makeTx({ ...eth, quantity: '1', price: '2000', date: '2024-01-11', ...bnbFee })
    const { positions, cash, realized } = computeLedger([buyBnb('1'), buyEth])
    const byKey = new Map(positions.map((p) => [p.key, [p.quantity, p.costQuote, p.costBase].map(String)]))
    expect(byKey.get('acc-1|CRYPTO:ETH')).toEqual(['1', '2000.6', '68020.4'])
    expect(byKey.get('acc-1|CRYPTO:BNB')).toEqual(['0.999', '499.5', '16983'])
    expect(cash[0].amount.toString()).toBe('-2500')
    const bnb = realized.find((e) => e.instrumentId === 'CRYPTO:BNB')!
    expect([bnb.txId, bnb.proceedsQuote, bnb.costQuote, bnb.realizedQuote].map(String)).toEqual([buyEth.id, '0.6', '0.5', '0.1'])
    expect([bnb.proceedsBase, bnb.costBase, bnb.realizedBase, bnb.priceEffectBase, bnb.fxEffectBase].map(String)).toEqual([
      '20.4', '17', '3.4', '3.4', '0',
    ])
  })

  it('refuses a fee in an asset that is not held in that amount', () => {
    const ledger = computeLedger([buyBnb('0.0005'), makeTx({ ...eth, quantity: '1', price: '2000', date: '2024-01-11', ...bnbFee })])
    expect(ledger.issues[0].message).toBe('ค่าธรรมเนียม 0.001 BNB แต่ถืออยู่ 0.0005 BNB')
    expect(ledger.positions.map((p) => p.key)).toEqual(['acc-1|CRYPTO:BNB'])
  })

  describe('a fee in the asset being traded, which validation would have refused', () => {
    const sameAsset = { feePaidIn: 'asset' as const, feeInstrumentId: 'CRYPTO:ETH', feeQuantity: '0.1', fees: '200' }
    const message = 'สินทรัพย์ที่จ่ายค่าธรรมเนียมต้องต่างจากสินทรัพย์ของรายการ'
    const heldEth = makeTx({ ...eth, quantity: '1', price: '2000', date: '2024-01-09' })

    it('skips a sell of the whole holding instead of dropping the fee units without a word', () => {
      const sell = makeTx({ ...eth, type: 'sell', quantity: '1', price: '2500', date: '2024-02-01', ...sameAsset })
      const ledger = computeLedger([heldEth, sell])
      expect(ledger.issues).toEqual([{ txId: sell.id, message }])
      expect(ledger.positions[0].quantity.toString()).toBe('1')
      expect(ledger.realized).toEqual([])
    })

    it('skips a partial sell instead of letting the fee push the holding below zero', () => {
      const sell = makeTx({ ...eth, type: 'sell', quantity: '0.95', price: '2500', date: '2024-02-01', ...sameAsset })
      const ledger = computeLedger([heldEth, sell])
      expect(ledger.issues).toEqual([{ txId: sell.id, message }])
      expect(ledger.positions[0].quantity.toString()).toBe('1')
    })

    it('skips a buy and a swap whose fee is in the coin they give or receive', () => {
      const buy = makeTx({ ...eth, quantity: '1', price: '2000', date: '2024-01-11', ...sameAsset })
      const swap = makeTx({
        instrumentId: 'CRYPTO:BTC',
        currency: 'USD',
        type: 'swap',
        quantity: '0.01',
        price: undefined,
        toInstrumentId: 'CRYPTO:ETH',
        toQuantity: '0.25',
        amount: '660',
        fxRate: '35',
        date: '2024-04-01',
        ...sameAsset,
      })
      const bought = computeLedger([buy])
      expect(bought.issues).toEqual([{ txId: buy.id, message }])
      expect(bought.positions).toEqual([])
      const swapped = computeLedger([makeTx({ instrumentId: 'CRYPTO:BTC', currency: 'USD', quantity: '0.01', price: '58000', fxRate: '34', date: '2024-03-01' }), swap])
      expect(swapped.issues).toEqual([{ txId: swap.id, message }])
    })
  })

  it('lowers the gain of a sell by a BNB fee without taking it from cash', () => {
    const { realized, cash } = computeLedger([
      makeTx({ ...eth, quantity: '1', price: '2000', date: '2024-01-09' }),
      buyBnb('1'),
      makeTx({ ...eth, type: 'sell', quantity: '1', price: '2500', fxRate: '35', date: '2024-02-01', ...bnbFee }),
    ])
    expect(realized.find((e) => e.instrumentId === 'CRYPTO:ETH')!.realizedQuote.toString()).toBe('499.4')
    expect(realized.find((e) => e.instrumentId === 'CRYPTO:BNB')!.realizedBase.toString()).toBe('4')
    expect(cash).toEqual([])
  })

  it('takes the fee units from the coins received in a swap and from the units that arrive in a transfer', () => {
    const buyBtc = makeTx({ instrumentId: 'CRYPTO:BTC', quantity: '0.01', price: '58000', fxRate: '34', date: '2024-03-01' })
    const swapped = computeLedger([
      buyBtc,
      makeTx({ instrumentId: 'CRYPTO:BTC', type: 'swap', quantity: '0.01', price: undefined, toInstrumentId: 'CRYPTO:ETH', toQuantity: '0.25', amount: '660', fxRate: '35', date: '2024-04-01', feePaidIn: 'received', feeQuantity: '0.0025' }),
    ])
    expect([swapped.positions[0].quantity, swapped.positions[0].costQuote].map(String)).toEqual(['0.2475', '660'])
    const moved = computeLedger([
      buyBtc,
      makeTx({ instrumentId: 'CRYPTO:BTC', type: 'transfer', toAccountId: 'acc-2', quantity: '0.01', price: undefined, date: '2024-04-01', feePaidIn: 'received', feeQuantity: '0.0002' }),
    ])
    expect(moved.positions.map((p) => [p.key, p.quantity.toString(), p.costQuote.toString(), p.costBase.toString()])).toEqual([
      ['acc-2|CRYPTO:BTC', '0.0098', '580', '19720'],
    ])
  })

  describe('beyond a single buy', () => {
    const buyBtc = makeTx({ instrumentId: 'CRYPTO:BTC', quantity: '0.01', price: '58000', fxRate: '34', date: '2024-03-01' })
    const swapBtc = (overrides: Partial<Transaction> = {}) =>
      makeTx({
        instrumentId: 'CRYPTO:BTC',
        type: 'swap',
        quantity: '0.01',
        price: undefined,
        toInstrumentId: 'CRYPTO:ETH',
        toQuantity: '0.25',
        amount: '660',
        fxRate: '35',
        date: '2024-04-01',
        ...overrides,
      })

    it('adds a swap fee paid in BNB to the cost of the coin received and sells the BNB after the coin given up', () => {
      const { positions, realized, cash } = computeLedger([buyBtc, buyBnb('1'), swapBtc(bnbFee)])
      const byKey = new Map(positions.map((p) => [p.key, [p.quantity, p.costQuote, p.costBase].map(String)]))
      expect(byKey.get('acc-1|CRYPTO:ETH')).toEqual(['0.25', '660.6', '23121'])
      expect(byKey.get('acc-1|CRYPTO:BNB')).toEqual(['0.999', '499.5', '16983'])
      expect(realized.map((e) => [e.instrumentId, e.realizedBase.toString()])).toEqual([
        ['CRYPTO:BTC', '3380'],
        ['CRYPTO:BNB', '4'],
      ])
      expect(cash[0].amount.toString()).toBe('-1080')
    })

    it('closes the position of the asset a fee uses up completely', () => {
      const { positions, realized } = computeLedger([buyBnb('0.001'), makeTx({ ...eth, quantity: '1', price: '2000', date: '2024-01-11', ...bnbFee })])
      expect(positions.map((p) => p.key)).toEqual(['acc-1|CRYPTO:ETH'])
      expect(realized.find((e) => e.instrumentId === 'CRYPTO:BNB')!.realizedBase.toString()).toBe('3.4')
    })

    it('reports a fee paid in an asset as a fee in the currency of the transaction', () => {
      const { feesBase } = computeLedger([buyBnb('1'), makeTx({ ...eth, quantity: '1', price: '2000', tax: '1', date: '2024-01-11', ...bnbFee })])
      expect(feesBase.toString()).toBe('54.4')
    })

    it('values the units a swap fee took at the price they were swapped at', () => {
      const { feesBase } = computeLedger([buyBtc, swapBtc({ feePaidIn: 'received', feeQuantity: '0.0025' })])
      expect(feesBase.toString()).toBe('231')
    })

    it('puts no value on the units a transfer fee took', () => {
      const { feesBase } = computeLedger([buyBtc, makeTx({ instrumentId: 'CRYPTO:BTC', type: 'transfer', toAccountId: 'acc-2', quantity: '0.01', price: undefined, date: '2024-04-01', feePaidIn: 'received', feeQuantity: '0.0002' })])
      expect(feesBase.toString()).toBe('0')
    })

    it('refuses a fee in an asset held in another currency and leaves everything alone', () => {
      const bnbInBaht = makeTx({ instrumentId: 'CRYPTO:BNB', currency: 'THB', quantity: '1', price: '17000', fxRate: '1', date: '2024-01-10' })
      const ledger = computeLedger([bnbInBaht, makeTx({ ...eth, quantity: '1', price: '2000', date: '2024-01-11', ...bnbFee })])
      expect(ledger.issues[0].message).toBe('BNB ถืออยู่เป็น THB · รายการนี้ใช้ USD')
      expect(ledger.positions.map((p) => [p.key, p.quantity.toString()])).toEqual([['acc-1|CRYPTO:BNB', '1']])
      expect(ledger.cash.map((row) => row.currency)).toEqual(['THB'])
      expect(ledger.feesBase.toString()).toBe('0')
    })

    it('refuses a fee in an asset that is not held at all', () => {
      const ledger = computeLedger([makeTx({ ...eth, quantity: '1', price: '2000', ...bnbFee })])
      expect(ledger.issues[0].message).toBe('ค่าธรรมเนียม 0.001 BNB แต่ถืออยู่ 0 BNB')
      expect(ledger.positions).toEqual([])
    })

    it('leaves a sell alone when its fee asset is missing', () => {
      const buyEth = makeTx({ ...eth, quantity: '1', price: '2000', date: '2024-01-09' })
      const ledger = computeLedger([buyEth, makeTx({ ...eth, type: 'sell', quantity: '1', price: '2500', date: '2024-02-01', ...bnbFee })])
      expect(ledger.issues).toHaveLength(1)
      expect(ledger.realized).toEqual([])
      expect(ledger.positions.map((p) => [p.key, p.quantity.toString()])).toEqual([['acc-1|CRYPTO:ETH', '1']])
      expect(ledger.cash[0].amount.toString()).toBe('-2000')
    })

    it('leaves both coins of a swap alone when its fee asset is missing', () => {
      const ledger = computeLedger([buyBtc, swapBtc(bnbFee)])
      expect(ledger.issues).toHaveLength(1)
      expect(ledger.realized).toEqual([])
      expect(ledger.positions.map((p) => [p.key, p.quantity.toString()])).toEqual([['acc-1|CRYPTO:BTC', '0.01']])
    })

    it('names the main problem first when a sell fails for both reasons', () => {
      const ledger = computeLedger([makeTx({ ...eth, type: 'sell', quantity: '1', price: '2500', ...bnbFee })])
      expect(ledger.issues[0].message).toBe('ขาย 1 หน่วย แต่ถืออยู่ 0 หน่วย')
    })
  })
})

describe('what a fee is paid in', () => {
  const sell = makeTx({ type: 'sell', quantity: '2', price: '450', fees: '1', tax: '0.5', feePaidIn: 'asset', feeInstrumentId: 'CRYPTO:BNB', feeQuantity: '0.001' })
  const cashSell = { ...sell, feePaidIn: undefined, feeInstrumentId: undefined, feeQuantity: undefined }

  it('is cash unless the transaction says otherwise', () => {
    expect([undefined, 'cash', 'received', 'asset'].map((feePaidIn) => feeFromCash(makeTx({ feePaidIn: feePaidIn as never })))).toEqual([
      true, true, false, false,
    ])
  })

  it('takes the fee out of the proceeds of a sell whatever it was paid in, but out of cash only when it was paid in cash', () => {
    expect(saleProceedsQuote(cashSell).toString()).toBe('898.5')
    expect(saleProceedsQuote(sell).toString()).toBe('898.5')
    expect(cashDeltaQuote(cashSell).toString()).toBe('898.5')
    expect(cashDeltaQuote(sell).toString()).toBe('899.5')
  })

  it('leaves a fee that is not paid in cash out of the cash of a buy, a swap and a transfer', () => {
    const buy = makeTx({ quantity: '2', price: '450', fees: '1', tax: '0.5' })
    expect(cashDeltaQuote(buy).toString()).toBe('-901.5')
    expect(cashDeltaQuote({ ...buy, feePaidIn: 'asset' }).toString()).toBe('-900.5')
    const swap = makeTx({ type: 'swap', amount: '660', fees: '1', tax: '0.5' })
    expect(cashDeltaQuote(swap).toString()).toBe('-1.5')
    expect(cashDeltaQuote({ ...swap, feePaidIn: 'asset' }).toString()).toBe('-0.5')
    const transfer = makeTx({ type: 'transfer', toAccountId: 'acc-2', price: undefined, fees: '2' })
    expect(cashDeltaQuote(transfer).toString()).toBe('-2')
    expect(cashDeltaQuote({ ...transfer, fees: '0', feePaidIn: 'received', feeQuantity: '0.1' }).toString()).toBe('0')
  })

  it('counts the units taken from a buy at its price and the value of an asset as it was given', () => {
    const buy = makeTx({ quantity: '2', price: '450', tax: '0.5' })
    expect(feesQuote({ ...buy, feePaidIn: 'received', feeQuantity: '0.1' }).toString()).toBe('45.5')
    expect(feesQuote({ ...buy, fees: '3', feePaidIn: 'asset' }).toString()).toBe('3.5')
  })

  it('counts no units taken from a swap that received nothing', () => {
    const swap = makeTx({ type: 'swap', amount: '660', toQuantity: undefined, feePaidIn: 'received', feeQuantity: '0.1' })
    expect(feesQuote(swap).toString()).toBe('0')
  })
})

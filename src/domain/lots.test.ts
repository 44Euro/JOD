import { describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { fifoByAccount } from './lots'

describe('fifoByAccount', () => {
  // The spec's sold example: 10 @100 (fee 1, rate 35) and 10 @120 (fee 1, rate 33), then sell 5 @130 (fee 1, rate 34).
  const txs = [
    makeTx({ id: 'b1', date: '2024-01-01', quantity: '10', price: '100', fees: '1', fxRate: '35' }),
    makeTx({ id: 'b2', date: '2024-02-01', quantity: '10', price: '120', fees: '1', fxRate: '33' }),
    makeTx({ id: 's1', type: 'sell', date: '2024-03-01', quantity: '5', price: '130', fees: '1', fxRate: '34' }),
  ]

  it('sells from the oldest purchase first and leaves the rest of it as a lot', () => {
    const r = fifoByAccount(txs, 'US:AAPL').get('acc-1')!
    expect(r.lots.map((l) => [l.txId, l.quantity.toString(), l.costQuote.toString(), l.costBase.toString()])).toEqual([
      ['b1', '5', '500.5', '17517.5'],
      ['b2', '10', '1201', '39633'],
    ])
    // Proceeds (650 − 1) × 34 = 22,066; cost of 5 from the first lot = 1,001 × 35 ÷ 2 = 17,517.5.
    expect([r.sales[0].proceedsBase.toString(), r.sales[0].costBase.toString(), r.realizedBase.toString()]).toEqual(['22066', '17517.5', '4548.5'])
  })

  it('crosses into the next lot when the oldest runs out, and follows a split', () => {
    const r = fifoByAccount(
      [...txs, makeTx({ id: 'sp', type: 'split', date: '2024-03-02', splitRatio: '2', quantity: undefined, price: undefined }), makeTx({ id: 's2', type: 'sell', date: '2024-03-03', quantity: '12', price: '70', fxRate: '34' })],
      'US:AAPL',
    ).get('acc-1')!
    expect(r.lots.map((l) => [l.txId, l.quantity.toString()])).toEqual([['b2', '18']])
  })

  it('carries lots with their dates to the account they are moved to', () => {
    const moved = makeTx({ id: 't', type: 'transfer', date: '2024-02-15', quantity: '15', toAccountId: 'acc-2', price: undefined })
    const all = fifoByAccount([txs[0], txs[1], moved], 'US:AAPL')
    expect(all.get('acc-1')!.lots.map((l) => [l.txId, l.quantity.toString()])).toEqual([['b2', '5']])
    expect(all.get('acc-2')!.lots.map((l) => [l.txId, l.date, l.quantity.toString()])).toEqual([
      ['b1', '2024-01-01', '10'],
      ['b2', '2024-02-01', '5'],
    ])
  })
})

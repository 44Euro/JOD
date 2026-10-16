import { describe, expect, it } from 'vitest'
import { D } from '../domain/decimal'
import { instrumentStats } from '../domain/holdings'
import { computeLedger } from '../domain/ledger'
import { valuePosition } from '../domain/valuation'
import { makeTx } from '../test/fixtures'
import { assetRoute } from './moneyRoutes'

describe('assetRoute', () => {
  it('walks from baht through both rates to the value today', () => {
    const ledger = computeLedger([
      makeTx({ instrumentId: 'US:VOO', quantity: '10', price: '400', fees: '2', fxRate: '35', date: '2024-01-10' }),
      makeTx({ instrumentId: 'US:VOO', type: 'sell', quantity: '2', price: '450', fees: '1', fxRate: '34', date: '2024-04-01' }),
    ])
    const valuations = ledger.positions.map((p) => valuePosition(p, '500', '33'))
    const stats = instrumentStats('US:VOO', valuations, ledger, '2024-10-16')!
    expect(assetRoute(stats, D(500), D(33), 'THB').map((s) => [s.value, s.label])).toEqual([
      ['฿112,056', 'บาทที่ลงไป'],
      ['35.00', 'แลกเป็น USD · เรทเฉลี่ย'],
      ['400.20', 'ซื้อ 8 หน่วย · ทุนเฉลี่ย'],
      ['500.00', 'ราคาวันนี้ · +24.9%'],
      ['33.00', 'เรทวันนี้ · บาทแข็งขึ้น'],
      ['฿132,000', 'มูลค่าวันนี้'],
    ])
  })

  it('skips the two rate stations for a baht asset and waits for a price', () => {
    const ledger = computeLedger([
      makeTx({ instrumentId: 'SET:PTT', currency: 'THB', quantity: '100', price: '33', fxRate: '1', fxSource: 'same' }),
    ])
    const stats = instrumentStats('SET:PTT', ledger.positions.map((p) => valuePosition(p, undefined, '1')), ledger, '2024-10-16')!
    expect(assetRoute(stats, null, D(1), 'THB').map((s) => [s.value, s.label])).toEqual([
      ['฿3,300', 'บาทที่ลงไป'],
      ['33.00', 'ซื้อ 100 หน่วย · ทุนเฉลี่ย'],
      ['—', 'ราคาวันนี้ · ยังไม่ได้กรอก'],
      ['—', 'มูลค่าวันนี้'],
    ])
  })
})

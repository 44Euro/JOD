import { describe, expect, it } from 'vitest'
import { D } from '../domain/decimal'
import { instrumentStats } from '../domain/holdings'
import type { InvestorSummary } from '../domain/investor'
import { computeLedger } from '../domain/ledger'
import { valuePosition } from '../domain/valuation'
import { makeTx } from '../test/fixtures'
import { assetRoute, investorRoute } from './moneyRoutes'

function summaryOf(exact: { start: string; end: string; price?: string; fx?: string; realized?: string; income?: string }): InvestorSummary {
  return {
    flows: [],
    invested: { totalBase: D(exact.start), inBase: D(exact.start), outBase: D(0) },
    worth: { holdingsBase: D(exact.end), cashBase: D(0), totalBase: D(exact.end), cash: [], unpricedCount: 0, missingRates: [] },
    gain: {
      totalBase: D(exact.end).minus(exact.start),
      unrealizedPriceBase: D(exact.price),
      unrealizedFxBase: D(exact.fx),
      realizedBase: D(exact.realized),
      incomeBase: D(exact.income),
      otherFeesBase: D(0),
      cashFxBase: D(0),
    },
  }
}

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

describe('investorRoute', () => {
  it('shows the exact remainder in the fee station and puts the rounding on the stock station', () => {
    const stations = investorRoute(summaryOf({ start: '100.4', end: '100.8', price: '0.4' }))
    expect(stations.map((s) => s.value)).toEqual(['100', '+1', '0', '0', '0', '0', '101'])
  })

  it('walks the Dime US account with the rounding on the stock station', () => {
    const stations = investorRoute(
      summaryOf({ start: '34000', end: '35788.5', price: '2019.6', fx: '-360', realized: '413.4', income: '289' }),
    )
    expect(stations.map((s) => [s.value, s.label])).toEqual([
      ['34,000', 'เงินลงทุน'],
      ['+2,021', 'หุ้นขึ้น · ยังไม่ขาย'],
      ['−360', 'ค่าเงิน · ยังไม่ขาย'],
      ['+413', 'ขายแล้ว'],
      ['+289', 'ปันผล ดอกเบี้ย'],
      ['−574', 'ค่าธรรมเนียม · ค่าเงินเงินสด'],
      ['35,789', 'วันนี้'],
    ])
  })

  it('names the stock station after the sign it ends up with once the rounding is added', () => {
    const [, flat] = investorRoute(summaryOf({ start: '100', end: '99.7', price: '-0.3' }))
    expect(flat.value).toBe('0')
    expect(flat.label).not.toContain('หุ้นลง')
    const [, down] = investorRoute(summaryOf({ start: '100', end: '99.4', price: '-0.6' }))
    expect([down.value, down.label, down.tone]).toEqual(['−1', 'หุ้นลง · ยังไม่ขาย', 'loss'])
  })
})

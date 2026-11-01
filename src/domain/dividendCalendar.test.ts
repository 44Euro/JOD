import { describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { dividendCalendar } from './dividendCalendar'
import { computeLedger } from './ledger'

const cashFree = { quantity: undefined, price: undefined }
const baht = { currency: 'THB', fxRate: '1', fxSource: 'same' as const }
const buy = (instrumentId: string, quantity: string, date: string, extra = {}) => makeTx({ instrumentId, quantity, price: '10', date, ...extra })
const dividend = (instrumentId: string, amount: string, tax: string, date: string, extra = {}) =>
  makeTx({ ...cashFree, type: 'dividend', instrumentId, amount, tax, fxRate: '34', date, ...extra })
const today = '2026-11-01'
const line = (month: { items: { instrumentId: string; amountQuote: { toString(): string }; amountBase: { toString(): string }; received: boolean }[] }) =>
  month.items.map((i) => [i.instrumentId, i.amountQuote.toString(), i.amountBase.toString(), i.received])

describe('dividendCalendar', () => {
  it('runs twelve months from this month', () => {
    const months = dividendCalendar(computeLedger([]), today)
    expect(months.map((m) => m.month)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09', '2027-10'])
  })

  it("expects last year's dividend on the units held now", () => {
    const ledger = computeLedger([
      buy('US:VOO', '10', '2025-01-10'),
      dividend('US:VOO', '20', '3', '2025-12-20'),
      buy('US:VOO', '5', '2026-02-01'),
    ])
    const december = dividendCalendar(ledger, today)[1]
    // 17 after tax on 10 units, now 15 units: 25.5; in baht 17 × 34 × 1.5.
    expect(line(december)).toEqual([['US:VOO', '25.5', '867', false]])
    expect(december.totalBase.toString()).toBe('867')
  })

  it('expects nothing from a holding sold out since', () => {
    const ledger = computeLedger([buy('US:KO', '10', '2025-01-10'), dividend('US:KO', '5', '0', '2025-12-01'), makeTx({ type: 'sell', instrumentId: 'US:KO', quantity: '10', price: '12', date: '2026-06-01' })])
    expect(dividendCalendar(ledger, today)[1].items).toEqual([])
  })

  it("puts this month's received dividend in place of last year's", () => {
    const ledger = computeLedger([
      buy('SET:PTT', '100', '2025-01-10', baht),
      dividend('SET:PTT', '100', '10', '2025-11-20', baht),
      dividend('SET:PTT', '120', '12', '2026-11-01', baht),
    ])
    expect(line(dividendCalendar(ledger, today)[0])).toEqual([['SET:PTT', '108', '108', true]])
  })

  it('adds the same stock in two accounts into one line', () => {
    const ledger = computeLedger([
      buy('US:VOO', '10', '2025-01-10'),
      buy('US:VOO', '10', '2025-01-10', { accountId: 'acc-2' }),
      dividend('US:VOO', '10', '0', '2025-12-20'),
      dividend('US:VOO', '10', '0', '2025-12-20', { accountId: 'acc-2' }),
    ])
    expect(line(dividendCalendar(ledger, today)[1])).toEqual([['US:VOO', '20', '680', false]])
  })
})

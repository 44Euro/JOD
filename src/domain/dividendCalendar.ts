import { D, sumBy, type Decimal } from './decimal'
import type { IncomeEvent, Ledger } from './ledger'

export interface DividendItem {
  instrumentId: string
  currency: string
  // After withholding tax: what reaches the account.
  amountQuote: Decimal
  amountBase: Decimal
  received: boolean
}

export interface DividendMonth {
  month: string
  items: DividendItem[]
  totalBase: Decimal
}

function addMonths(month: string, count: number): string {
  const [y, m] = month.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1 + count, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

// The next twelve months of dividends, from this month: what has already arrived this month, and for each holding the
// dividend it paid in the same month last year, scaled to the units held now. The base-currency amount is scaled the
// same way, so it carries last year's exchange rate; the screen says the figures are estimates.
export function dividendCalendar(ledger: Ledger, today: string): DividendMonth[] {
  const first = today.slice(0, 7)
  const months = Array.from({ length: 12 }, (_, i) => addMonths(first, i))
  const dividends = ledger.income.filter((e) => e.kind === 'dividend')
  const held = new Map(ledger.positions.map((p) => [`${p.accountId}|${p.instrumentId}`, p.quantity]))
  const lines = new Map<string, Map<string, DividendItem>>()

  // Moves come in date order, so the last one on or before the day is what the account held then.
  const unitsOn = (e: IncomeEvent) =>
    ledger.moves.reduce((units, m) => (m.accountId === e.accountId && m.instrumentId === e.instrumentId && m.date <= e.date ? m.after : units), D(0))

  function add(month: string, item: DividendItem) {
    const monthLines = lines.get(month) ?? new Map<string, DividendItem>()
    const key = `${item.instrumentId}|${item.received}`
    const seen = monthLines.get(key)
    monthLines.set(key, seen ? { ...seen, amountQuote: seen.amountQuote.plus(item.amountQuote), amountBase: seen.amountBase.plus(item.amountBase) } : item)
    lines.set(month, monthLines)
  }

  const paidThisMonth = new Set<string>()
  for (const e of dividends) {
    if (e.date.slice(0, 7) !== first || e.date > today) continue
    add(first, { instrumentId: e.instrumentId, currency: e.currency, amountQuote: e.netQuote, amountBase: e.netBase, received: true })
    paidThisMonth.add(e.instrumentId)
  }
  for (const e of dividends) {
    const month = addMonths(e.date.slice(0, 7), 12)
    if (!months.includes(month) || (month === first && paidThisMonth.has(e.instrumentId))) continue
    const then = unitsOn(e)
    const now = held.get(`${e.accountId}|${e.instrumentId}`) ?? D(0)
    if (then.lte(0) || now.lte(0)) continue
    const scale = now.div(then)
    add(month, { instrumentId: e.instrumentId, currency: e.currency, amountQuote: e.netQuote.times(scale), amountBase: e.netBase.times(scale), received: false })
  }

  return months.map((month) => {
    const items = [...(lines.get(month)?.values() ?? [])]
    return { month, items, totalBase: sumBy(items, (i) => i.amountBase) }
  })
}

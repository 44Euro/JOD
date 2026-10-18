import { isIsoDate, lastTwelveMonths, monthKey } from './dates'
import { D, Decimal, sumBy } from './decimal'
import type { IncomeEvent, IncomeKind } from './ledger'

export type IncomePeriod = 'year' | '12m' | 'all'

export interface DateRange {
  from: string
  to: string
}

export const INCOME_KINDS: readonly IncomeKind[] = ['dividend', 'interest', 'receive_asset']

// Feb 29 has no twin in a common year, so it lands on Feb 28.
export function shiftYear(date: string, years: number): string {
  const year = String(Number(date.slice(0, 4)) + years).padStart(4, '0')
  const shifted = `${year}${date.slice(4)}`
  return isIsoDate(shifted) ? shifted : `${year}-02-28`
}

export function periodRange(period: IncomePeriod, today: string, events: readonly IncomeEvent[] = []): DateRange {
  if (period === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today }
  if (period === '12m') return { from: `${lastTwelveMonths(today)[0]}-01`, to: today }
  const first = events.reduce((min, e) => (e.date < min ? e.date : min), today)
  return { from: first, to: today }
}

// The same stretch of days one year earlier, so a year still in progress is compared with the same part of
// last year. "All" has no earlier twin and is compared like "this year".
export function comparisonRange(period: IncomePeriod, today: string): DateRange {
  const range = periodRange(period === 'all' ? 'year' : period, today)
  return { from: shiftYear(range.from, -1), to: shiftYear(range.to, -1) }
}

function emptyByKind(): Record<IncomeKind, Decimal> {
  return Object.fromEntries(INCOME_KINDS.map((kind) => [kind, D(0)])) as Record<IncomeKind, Decimal>
}

export interface IncomeTotals {
  netBase: Decimal
  grossBase: Decimal
  taxBase: Decimal
  byKind: Record<IncomeKind, Decimal>
  count: number
}

export function inRange(events: readonly IncomeEvent[], range: DateRange): IncomeEvent[] {
  return events.filter((e) => e.date >= range.from && e.date <= range.to)
}

export function sumIncome(events: readonly IncomeEvent[], range: DateRange): IncomeTotals {
  const picked = inRange(events, range)
  const byKind = emptyByKind()
  for (const e of picked) byKind[e.kind] = byKind[e.kind].plus(e.netBase)
  return {
    netBase: sumBy(picked, (e) => e.netBase),
    grossBase: sumBy(picked, (e) => e.grossBase),
    taxBase: sumBy(picked, (e) => e.taxBase),
    byKind,
    count: picked.length,
  }
}

export function changePct(current: Decimal, previous: Decimal): Decimal | null {
  return previous.greaterThan(0) ? current.minus(previous).div(previous).times(100) : null
}

export interface IncomeBucket {
  key: string
  byKind: Record<IncomeKind, Decimal>
  netBase: Decimal
}

// Months of the calendar year or of the last twelve months; whole years for "all".
export function incomeBuckets(events: readonly IncomeEvent[], period: IncomePeriod, today: string): IncomeBucket[] {
  const year = today.slice(0, 4)
  let keys: string[]
  if (period === 'year') keys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  else if (period === '12m') keys = lastTwelveMonths(today)
  else {
    const first = Number(periodRange('all', today, events).from.slice(0, 4))
    keys = Array.from({ length: Number(year) - first + 1 }, (_, i) => String(first + i))
  }
  const keyOf = (e: IncomeEvent) => (period === 'all' ? e.date.slice(0, 4) : monthKey(e.date))
  return keys.map((key) => {
    const byKind = emptyByKind()
    for (const e of events) if (e.date <= today && keyOf(e) === key) byKind[e.kind] = byKind[e.kind].plus(e.netBase)
    return { key, byKind, netBase: sumBy(INCOME_KINDS, (kind) => byKind[kind]) }
  })
}

export interface AssetIncomeRow {
  key: string
  instrumentId: string
  accountId: string
  currency: string
  kinds: IncomeKind[]
  netBase: Decimal
  grossBase: Decimal
  taxBase: Decimal
}

// Interest on cash has no instrument, so it is grouped per account instead.
export function incomeByAsset(events: readonly IncomeEvent[], range: DateRange): AssetIncomeRow[] {
  const rows = new Map<string, AssetIncomeRow>()
  for (const e of inRange(events, range)) {
    const key = e.instrumentId || `cash:${e.accountId}`
    const row = rows.get(key) ?? {
      key,
      instrumentId: e.instrumentId,
      accountId: e.instrumentId ? '' : e.accountId,
      currency: e.currency,
      kinds: [],
      netBase: D(0),
      grossBase: D(0),
      taxBase: D(0),
    }
    if (!row.kinds.includes(e.kind)) row.kinds.push(e.kind)
    row.netBase = row.netBase.plus(e.netBase)
    row.grossBase = row.grossBase.plus(e.grossBase)
    row.taxBase = row.taxBase.plus(e.taxBase)
    rows.set(key, row)
  }
  return [...rows.values()].sort((a, b) => b.netBase.comparedTo(a.netBase) || a.key.localeCompare(b.key))
}

export function recentIncome(events: readonly IncomeEvent[], count: number): IncomeEvent[] {
  return [...events].sort((a, b) => b.date.localeCompare(a.date)).slice(0, count)
}

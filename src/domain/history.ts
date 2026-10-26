import { D, Decimal } from './decimal'
import type { RealizedEvent } from './ledger'
import type { Transaction } from './types'

export interface DailyPoint {
  date: string
  value: Decimal
  invested: Decimal
}

export interface IndexedPoint extends DailyPoint {
  // Growth of one unit of money since the first day, with money put in or taken out stripped out (time-weighted).
  index: Decimal
}

export function toDailyPoints(rows: readonly { date: string; valueBase: string; netInvestedBase: string }[]): DailyPoint[] {
  return [...rows]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({ date: r.date, value: D(r.valueBase), invested: D(r.netInvestedBase) }))
}

// Each day's change in net invested is taken as money that arrived during the day, so it is removed before the day's
// growth is measured: growth = (value − money added) ÷ yesterday's value. A day after the portfolio was empty starts
// the chain again at the same level.
export function timeWeighted(points: readonly DailyPoint[]): IndexedPoint[] {
  let index = D(1)
  return points.map((point, i) => {
    if (i > 0) {
      const before = points[i - 1]
      const added = point.invested.minus(before.invested)
      if (before.value.gt(0)) index = index.times(point.value.minus(added).div(before.value))
    }
    return { ...point, index }
  })
}

export function periodReturn(points: readonly IndexedPoint[]): Decimal | null {
  if (points.length < 2) return null
  return points[points.length - 1].index.div(points[0].index).minus(1)
}

export interface Drawdown {
  pct: Decimal
  peakDate: string
  troughDate: string
}

// The deepest fall from a high, measured on the time-weighted index so that a withdrawal is not taken for a loss.
export function maxDrawdown(points: readonly IndexedPoint[]): Drawdown | null {
  let peak = points[0]
  let worst: Drawdown | null = null
  for (const point of points) {
    if (point.index.gt(peak.index)) peak = point
    const fall = point.index.div(peak.index).minus(1)
    if (fall.lt(0) && (!worst || fall.lt(worst.pct))) worst = { pct: fall, peakDate: peak.date, troughDate: point.date }
  }
  return worst
}

export function cumulativeRealized(events: readonly RealizedEvent[]): { date: string; total: Decimal }[] {
  const byDate = new Map<string, Decimal>()
  for (const e of events) byDate.set(e.date, (byDate.get(e.date) ?? D(0)).plus(e.realizedBase))
  let total = D(0)
  return [...byDate.keys()].sort().map((date) => {
    total = total.plus(byDate.get(date)!)
    return { date, total }
  })
}

export function realizedByDay(events: readonly RealizedEvent[]): Map<string, Decimal> {
  const byDay = new Map<string, Decimal>()
  for (const e of events) byDay.set(e.date, (byDay.get(e.date) ?? D(0)).plus(e.realizedBase))
  return byDay
}

export interface CalendarDay {
  date: string
  day: number
  pl: Decimal | null
}

// Weeks start on Monday, as Thai calendars usually do; null pads the days before the 1st.
export function monthGrid(month: string, byDay: ReadonlyMap<string, Decimal>): (CalendarDay | null)[] {
  const [y, m] = month.split('-').map(Number)
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
  const cells: (CalendarDay | null)[] = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= days; d += 1) {
    const date = `${month}-${String(d).padStart(2, '0')}`
    cells.push({ date, day: d, pl: byDay.get(date) ?? null })
  }
  return cells
}

export function monthTotal(month: string, byDay: ReadonlyMap<string, Decimal>): Decimal {
  let total = D(0)
  for (const [date, pl] of byDay) if (date.startsWith(month)) total = total.plus(pl)
  return total
}

export interface PricePoint {
  date: string
  price: Decimal
  kind: 'buy' | 'sell' | 'opening' | 'last'
}

// The app keeps no price history, so the chart is drawn from the prices the user traded at, plus the latest price.
export function tradePricePoints(
  transactions: readonly Transaction[],
  instrumentId: string,
  last?: { price: string; date: string },
): PricePoint[] {
  const points: PricePoint[] = transactions
    .filter((t) => t.instrumentId === instrumentId && t.price && (t.type === 'buy' || t.type === 'sell' || t.type === 'opening'))
    .map((t) => ({ date: t.date, price: D(t.price), kind: t.type as PricePoint['kind'] }))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (last) points.push({ date: last.date, price: D(last.price), kind: 'last' })
  return points
}

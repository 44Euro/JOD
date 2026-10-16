import { daysBetween, priceAgeDays } from './dates'
import { D, Decimal } from './decimal'
import type { InvestorFlow } from './investor'
import type { Position } from './ledger'
import type { Instrument } from './types'

export interface DatedAmount {
  date: string
  amount: Decimal
}

const YEAR_DAYS = 365
const TOLERANCE = 1e-10

// Amounts are from the investor's side: money put in is negative, money received (and today's value) positive.
// The root is found with plain numbers: each Newton step evaluates (1 + r)^t for every date, and decimal.js
// takes ~150× longer for that (≈250 ms for 1,000 dates). The money itself is summed in Decimal first.
export function xirr(flows: readonly DatedAmount[]): Decimal | null {
  const byDate = new Map<string, Decimal>()
  for (const flow of flows) byDate.set(flow.date, (byDate.get(flow.date) ?? D(0)).plus(flow.amount))
  const dates = [...byDate.keys()].sort()
  if (dates.length < 2) return null
  const points = dates.map((date) => ({ t: daysBetween(dates[0], date) / YEAR_DAYS, a: byDate.get(date)!.toNumber() }))
  if (!points.some((p) => p.a < 0) || !points.some((p) => p.a > 0)) return null

  const npv = (r: number) => points.reduce((sum, p) => sum + p.a / Math.pow(1 + r, p.t), 0)
  const slope = (r: number) => points.reduce((sum, p) => sum - (p.t * p.a) / Math.pow(1 + r, p.t + 1), 0)

  let rate = 0.1
  for (let i = 0; i < 100; i += 1) {
    const step = npv(rate) / slope(rate)
    const next = rate - step
    if (!Number.isFinite(next) || next <= -1) break
    if (Math.abs(next - rate) < TOLERANCE) return D(next)
    rate = next
  }

  // Newton can jump below −100% on heavy losses; bisection is slower but always stays in range.
  let lo = -0.999999
  let hi = 100
  let atLo = npv(lo)
  if (atLo * npv(hi) > 0) return null
  for (let i = 0; i < 200 && hi - lo > TOLERANCE; i += 1) {
    const mid = (lo + hi) / 2
    const atMid = npv(mid)
    if (Math.sign(atMid) === Math.sign(atLo)) {
      lo = mid
      atLo = atMid
    } else {
      hi = mid
    }
  }
  return D((lo + hi) / 2)
}

export interface PortfolioReturn {
  startDate: string | null
  days: number
  annualized: boolean
  annualPct: Decimal | null
  sinceStartPct: Decimal | null
}

// Modified Dietz: each flow is weighted by the share of the period it was invested, so money added last
// week does not dilute the return the way a plain gain ÷ money-in would.
function sinceStartPct(flows: readonly InvestorFlow[], valueBase: Decimal, start: string, today: string): Decimal | null {
  const days = daysBetween(start, today)
  let invested = D(0)
  let weighted = D(0)
  for (const flow of flows) {
    invested = invested.plus(flow.amountBase)
    const weight = days === 0 ? D(1) : D(days - daysBetween(start, flow.date)).div(days)
    weighted = weighted.plus(flow.amountBase.times(weight))
  }
  if (!weighted.greaterThan(0)) return null
  return valueBase.minus(invested).div(weighted).times(100)
}

// Spec 7.4: under a year of history an annual figure would blow small gains up, so only the return since the
// first flow is given; from one year on the annual rate (XIRR) is given as well.
export function portfolioReturn(flows: readonly InvestorFlow[], valueBase: Decimal, today: string): PortfolioReturn {
  if (flows.length === 0) return { startDate: null, days: 0, annualized: false, annualPct: null, sinceStartPct: null }
  const startDate = flows.reduce((first, f) => (f.date < first ? f.date : first), flows[0].date)
  const days = daysBetween(startDate, today)
  const annualized = days >= YEAR_DAYS
  const rate = annualized
    ? xirr([...flows.map((f) => ({ date: f.date, amount: f.amountBase.negated() })), { date: today, amount: valueBase }])
    : null
  return {
    startDate,
    days,
    annualized,
    annualPct: rate ? rate.times(100) : null,
    sinceStartPct: sinceStartPct(flows, valueBase, startDate, today),
  }
}

export const STALE_PRICE_DAYS = 7

export function staleInstruments(positions: readonly Position[], instruments: readonly Instrument[], today: string): Instrument[] {
  const held = new Set(positions.map((p) => p.instrumentId))
  return instruments.filter((i) => {
    if (!held.has(i.id) || !i.lastPrice) return false
    const age = priceAgeDays(i.lastPriceAt, today)
    return age !== null && age > STALE_PRICE_DAYS
  })
}

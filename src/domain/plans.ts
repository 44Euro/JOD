import { addDays } from './dates'
import { D, Decimal } from './decimal'
import type { DcaPlan, Transaction } from './types'

export interface RebalanceRow {
  instrumentId: string
  valueBase: Decimal
  currentPct: Decimal
  targetPct: Decimal | null
  // Positive: buy this much; negative: sell this much, to reach the target with the new cash added.
  diffBase: Decimal | null
  // What to buy from the new cash alone, without selling anything.
  buyOnlyBase: Decimal | null
}

export interface Rebalance {
  rows: RebalanceRow[]
  totalBase: Decimal
  targetSum: Decimal
}

const pct = (part: Decimal, whole: Decimal) => (whole.gt(0) ? part.div(whole).times(100) : D(0))

// Targets are shares of the whole portfolio after the new cash; holdings without a target keep their value. With buys
// only, the new cash goes first to what is short of its target, in proportion to the shortfall, and anything left
// over is spread by target.
export function rebalance(
  holdings: readonly { instrumentId: string; valueBase: Decimal }[],
  targets: Readonly<Record<string, string>>,
  newCash: Decimal,
): Rebalance {
  const held = holdings.reduce((s, h) => s.plus(h.valueBase), D(0))
  const total = held.plus(newCash)
  const ids = [...new Set([...holdings.map((h) => h.instrumentId), ...Object.keys(targets)])]
  const valueOf = (id: string) => holdings.filter((h) => h.instrumentId === id).reduce((s, h) => s.plus(h.valueBase), D(0))
  const targetOf = (id: string) => (targets[id] ? D(targets[id]) : null)
  const shortfall = (id: string) => {
    const t = targetOf(id)
    return t ? Decimal.max(0, total.times(t).div(100).minus(valueOf(id))) : D(0)
  }
  const totalShort = ids.reduce((s, id) => s.plus(shortfall(id)), D(0))
  const targetSum = ids.reduce((s, id) => s.plus(targetOf(id) ?? 0), D(0))
  const leftover = Decimal.max(0, newCash.minus(totalShort))
  const rows = ids.map((id) => {
    const value = valueOf(id)
    const t = targetOf(id)
    let buyOnly: Decimal | null = null
    if (t) {
      const fromShort = totalShort.gt(0) ? Decimal.min(newCash, totalShort).times(shortfall(id)).div(totalShort) : D(0)
      buyOnly = fromShort.plus(targetSum.gt(0) ? leftover.times(t).div(targetSum) : 0)
    }
    return {
      instrumentId: id,
      valueBase: value,
      currentPct: pct(value, held),
      targetPct: t,
      diffBase: t ? total.times(t).div(100).minus(value) : null,
      buyOnlyBase: buyOnly,
    }
  })
  return { rows, totalBase: total, targetSum }
}

export interface PlanPeriod {
  start: string
  end: string
  spent: Decimal
  state: 'done' | 'partial' | 'missed' | 'current'
}

function periodStart(date: string, frequency: DcaPlan['frequency']): string {
  if (frequency === 'monthly') return `${date.slice(0, 7)}-01`
  const [y, m, d] = date.split('-').map(Number)
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
  return addDays(date, -weekday)
}

function nextStart(start: string, frequency: DcaPlan['frequency']): string {
  if (frequency === 'weekly') return addDays(start, 7)
  const [y, m] = start.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

// Money spent on the plan's asset in each period, counting buys in the plan's account and currency (price × units plus
// fees). A period reaching the amount, give or take 1%, counts as done, since an order rarely fills to the baht.
export function planProgress(plan: DcaPlan, transactions: readonly Transaction[], today: string): PlanPeriod[] {
  const buys = transactions.filter(
    (t) => t.type === 'buy' && t.accountId === plan.accountId && t.instrumentId === plan.instrumentId && t.currency === plan.currency,
  )
  const goal = D(plan.amount)
  const periods: PlanPeriod[] = []
  for (let start = periodStart(plan.startDate, plan.frequency); start <= today; start = nextStart(start, plan.frequency)) {
    const end = addDays(nextStart(start, plan.frequency), -1)
    const spent = buys
      .filter((t) => t.date >= start && t.date <= end && t.date >= plan.startDate)
      .reduce((s, t) => s.plus(D(t.quantity).times(D(t.price)).plus(D(t.fees))), D(0))
    const done = spent.gte(goal.times('0.99'))
    const current = today <= end
    periods.push({ start, end, spent, state: done ? 'done' : current ? 'current' : spent.gt(0) ? 'partial' : 'missed' })
  }
  return periods
}

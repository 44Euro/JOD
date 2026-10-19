import { lastTwelveMonths, monthKey } from './dates'
import { D, Decimal, sumBy } from './decimal'
import { positionValueBase, type CashValue } from './investor'
import { positionKey, type IncomeEvent, type Ledger, type RealizedEvent } from './ledger'
import type { PositionValuation } from './valuation'

export interface HoldingStats {
  key: string
  accountId: string
  instrumentId: string
  // Null for an instrument held in more than one currency: its quote-currency sums have no unit.
  currency: string | null
  quantity: Decimal
  costQuote: Decimal
  costBase: Decimal
  valueBase: Decimal | null
  unrealizedBase: Decimal | null
  priceEffectBase: Decimal | null
  fxEffectBase: Decimal | null
  realizedBase: Decimal
  incomeBase: Decimal
  income12mBase: Decimal
  totalReturnBase: Decimal | null
  totalReturnPct: Decimal | null
  yieldOnCostPct: Decimal | null
}

function pctOf(part: Decimal | null, whole: Decimal): Decimal | null {
  return part && whole.greaterThan(0) ? part.div(whole).times(100) : null
}

// Positions of one instrument may be held in different currencies, each with its own rate, so one of them can be
// missing a rate while the others are valued. Then there is no honest total.
function sumValued(valuations: readonly PositionValuation[], pick: (v: PositionValuation) => Decimal | null): Decimal | null {
  if (valuations.some((v) => pick(v) === null)) return null
  return sumBy(valuations, (v) => pick(v) ?? D(0))
}

function stats(
  key: string,
  accountId: string,
  instrumentId: string,
  currency: string | null,
  valuations: readonly PositionValuation[],
  realized: readonly RealizedEvent[],
  income: readonly IncomeEvent[],
  months: ReadonlySet<string>,
): HoldingStats {
  const costBase = sumBy(valuations, (v) => v.position.costBase)
  // Units received as income cost nothing out of pocket, so a yield measured against them would only repeat itself.
  const paidBase = costBase.minus(sumBy(valuations, (v) => v.position.receivedCostBase))
  const unrealizedBase = sumValued(valuations, (v) => v.unrealizedBase)
  const realizedBase = sumBy(realized, (e) => e.realizedBase)
  const incomeBase = sumBy(income, (e) => e.netBase)
  const income12mBase = sumBy(
    income.filter((e) => months.has(monthKey(e.date))),
    (e) => e.netBase,
  )
  const totalReturnBase = unrealizedBase ? unrealizedBase.plus(realizedBase).plus(incomeBase) : null
  return {
    key,
    accountId,
    instrumentId,
    currency,
    quantity: sumBy(valuations, (v) => v.position.quantity),
    costQuote: sumBy(valuations, (v) => v.position.costQuote),
    costBase,
    valueBase: sumValued(valuations, (v) => v.marketValueBase),
    unrealizedBase,
    priceEffectBase: sumValued(valuations, (v) => v.priceEffectBase),
    fxEffectBase: sumValued(valuations, (v) => v.fxEffectBase),
    realizedBase,
    incomeBase,
    income12mBase,
    totalReturnBase,
    totalReturnPct: pctOf(totalReturnBase, costBase),
    yieldOnCostPct: pctOf(income12mBase, paidBase),
  }
}

// Spec 5.3: total return of a holding = unrealized + realized + income of that holding in that account.
export function holdingStats(valuations: readonly PositionValuation[], ledger: Ledger, today: string): HoldingStats[] {
  const months = new Set(lastTwelveMonths(today))
  return valuations.map((v) => {
    const { key, accountId, instrumentId, currency } = v.position
    const mine = (e: { accountId: string; instrumentId: string }) => positionKey(e.accountId, e.instrumentId) === key
    return stats(key, accountId, instrumentId, currency, [v], ledger.realized.filter(mine), ledger.income.filter(mine), months)
  })
}

// One instrument across every account, including one that has been sold out (quantity 0, value 0).
export function instrumentStats(
  instrumentId: string,
  valuations: readonly PositionValuation[],
  ledger: Ledger,
  today: string,
): HoldingStats | null {
  const held = valuations.filter((v) => v.position.instrumentId === instrumentId)
  const realized = ledger.realized.filter((e) => e.instrumentId === instrumentId)
  const income = ledger.income.filter((e) => e.instrumentId === instrumentId)
  const heldCurrencies = new Set(held.map((v) => v.position.currency))
  const currency = heldCurrencies.size > 1 ? null : (held[0]?.position.currency ?? realized[0]?.currency ?? income[0]?.currency)
  if (currency === undefined) return null
  return stats(instrumentId, '', instrumentId, currency, held, realized, income, new Set(lastTwelveMonths(today)))
}

export interface AllocationItem {
  key: string
  assetsBase?: Decimal
  cashBase?: Decimal
}

export interface AllocationRow {
  key: string
  assetsBase: Decimal
  cashBase: Decimal
  totalBase: Decimal
  pct: Decimal | null
}

export function allocate(items: readonly AllocationItem[]): AllocationRow[] {
  const rows = new Map<string, AllocationRow>()
  for (const item of items) {
    const row = rows.get(item.key) ?? { key: item.key, assetsBase: D(0), cashBase: D(0), totalBase: D(0), pct: null }
    row.assetsBase = row.assetsBase.plus(item.assetsBase ?? D(0))
    row.cashBase = row.cashBase.plus(item.cashBase ?? D(0))
    row.totalBase = row.assetsBase.plus(row.cashBase)
    rows.set(item.key, row)
  }
  const list = [...rows.values()]
  const total = sumBy(list, (row) => row.totalBase)
  return list
    .map((row) => ({ ...row, pct: pctOf(row.totalBase, total) }))
    .sort((a, b) => b.totalBase.comparedTo(a.totalBase) || a.key.localeCompare(b.key))
}

// Spec 7.4: assets count in the currency they trade in, cash in its own currency.
export function currencyAllocation(valuations: readonly PositionValuation[], cash: readonly CashValue[]): AllocationRow[] {
  return allocate([
    ...valuations.map((v) => ({ key: v.position.currency, assetsBase: positionValueBase(v) })),
    ...cash.filter((row) => row.base !== null).map((row) => ({ key: row.currency, cashBase: row.base ?? D(0) })),
  ])
}

export interface HoldingGroup extends AllocationRow {
  unrealizedBase: Decimal
  totalReturnBase: Decimal
  count: number
}

// A holding without a price counts at cost and adds no unrealized gain, as in the totals, but what it
// already sold or paid out is known, so that still counts in its total return.
export function groupHoldings(stats: readonly HoldingStats[], keyOf: (s: HoldingStats) => string): HoldingGroup[] {
  return allocate(stats.map((s) => ({ key: keyOf(s), assetsBase: s.valueBase ?? s.costBase }))).map((row) => {
    const members = stats.filter((s) => keyOf(s) === row.key)
    return {
      ...row,
      unrealizedBase: sumBy(members, (s) => s.unrealizedBase ?? D(0)),
      totalReturnBase: sumBy(members, (s) => s.totalReturnBase ?? s.realizedBase.plus(s.incomeBase)),
      count: new Set(members.map((s) => s.instrumentId)).size,
    }
  })
}

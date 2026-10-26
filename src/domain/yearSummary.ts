import { D, Decimal } from './decimal'
import type { IncomeKind, Ledger } from './ledger'
import type { InvestorFlow } from './investor'
import type { Transaction } from './types'

export interface YearSummary {
  year: number
  realizedBase: Decimal
  sells: number
  income: Record<IncomeKind, { grossBase: Decimal; taxBase: Decimal }>
  feesBase: Decimal
  putInBase: Decimal
  takenOutBase: Decimal
  remittedBase: Decimal
  startValue: { date: string; valueBase: Decimal } | null
  endValue: { date: string; valueBase: Decimal } | null
}

export function yearsWithData(transactions: readonly Transaction[], today: string): number[] {
  const years = new Set(transactions.map((t) => Number(t.date.slice(0, 4))))
  years.add(Number(today.slice(0, 4)))
  return [...years].sort((a, b) => b - a)
}

// Everything that happened in one calendar year, in the base currency at the rates recorded on each transaction.
// Remittances use the tax year chosen on the withdrawal, which is what the Revenue Department asks about.
export function yearSummary(
  year: number,
  transactions: readonly Transaction[],
  ledger: Ledger,
  flows: readonly InvestorFlow[],
  dailyValues: readonly { date: string; valueBase: string }[],
): YearSummary {
  const inYear = (date: string) => date.startsWith(`${year}-`)
  const skipped = new Set(ledger.issues.map((i) => i.txId))
  const sold = ledger.realized.filter((e) => inYear(e.date))
  const income = {
    dividend: { grossBase: D(0), taxBase: D(0) },
    interest: { grossBase: D(0), taxBase: D(0) },
    receive_asset: { grossBase: D(0), taxBase: D(0) },
  } as Record<IncomeKind, { grossBase: Decimal; taxBase: Decimal }>
  for (const e of ledger.income.filter((e) => inYear(e.date))) {
    income[e.kind].grossBase = income[e.kind].grossBase.plus(e.grossBase)
    income[e.kind].taxBase = income[e.kind].taxBase.plus(e.taxBase)
  }
  const kept = transactions.filter((t) => !skipped.has(t.id))
  const feesBase = kept.filter((t) => inYear(t.date)).reduce((s, t) => s.plus(D(t.fees).times(t.fxRate)), D(0))
  const yearFlows = flows.filter((f) => inYear(f.date))
  const putInBase = yearFlows.filter((f) => f.amountBase.gt(0)).reduce((s, f) => s.plus(f.amountBase), D(0))
  const takenOutBase = yearFlows.filter((f) => f.amountBase.lt(0)).reduce((s, f) => s.plus(f.amountBase.abs()), D(0))
  const remittedBase = kept
    .filter((t) => t.type === 'withdraw' && t.remitToThailand && t.taxYear === year)
    .reduce((s, t) => s.plus(D(t.amount).times(t.fxRate)), D(0))
  const days = dailyValues.filter((d) => inYear(d.date)).sort((a, b) => a.date.localeCompare(b.date))
  const point = (d: { date: string; valueBase: string } | undefined) => (d ? { date: d.date, valueBase: D(d.valueBase) } : null)
  return {
    year,
    realizedBase: sold.reduce((s, e) => s.plus(e.realizedBase), D(0)),
    sells: new Set(sold.map((e) => e.txId)).size,
    income,
    feesBase,
    putInBase,
    takenOutBase,
    remittedBase,
    startValue: point(days[0]),
    endValue: point(days[days.length - 1]),
  }
}

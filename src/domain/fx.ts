import { D, Decimal, sumBy } from './decimal'
import { fxConvertSummary } from './fxConvert'
import type { CashValue } from './investor'
import { sortTransactions, type Ledger } from './ledger'
import type { Transaction } from './types'

export interface ConvertPairSummary {
  from: string
  to: string
  count: number
  fromTotal: Decimal
  toTotal: Decimal
  avgRate: Decimal
  avgSpreadPct: Decimal | null
  spreadLostBase: Decimal | null
}

export interface ConvertRow {
  txId: string
  date: string
  from: string
  to: string
  amount: Decimal
  toAmount: Decimal
  effectiveRate: Decimal
  marketRate: Decimal | null
  spreadPct: Decimal | null
}

export interface CashFxRow {
  accountId: string
  currency: string
  amount: Decimal
  costBase: Decimal
  valueBase: Decimal | null
  effectBase: Decimal | null
}

export interface RemittanceYear {
  taxYear: number
  totalBase: Decimal
  count: number
}

function keptTransactions(transactions: readonly Transaction[], ledger: Ledger, type: Transaction['type']): Transaction[] {
  const skipped = new Set(ledger.issues.map((issue) => issue.txId))
  return sortTransactions(transactions).filter((tx) => tx.type === type && !skipped.has(tx.id))
}

function conversions(transactions: readonly Transaction[], ledger: Ledger): Transaction[] {
  return keptTransactions(transactions, ledger, 'fx_convert').filter((tx) => tx.toCurrency && D(tx.toAmount).greaterThan(0))
}

// The spread of an exchange is what was paid above the market value of what arrived; one without a market rate has none.
function spreadAmount(tx: Transaction): { lost: Decimal; market: Decimal } | null {
  const marketRate = fxConvertSummary(tx).marketRate
  if (!marketRate || !marketRate.greaterThan(0)) return null
  const market = D(tx.toAmount).times(marketRate)
  return { lost: D(tx.amount).minus(market), market }
}

export function convertSummaries(transactions: readonly Transaction[], ledger: Ledger): ConvertPairSummary[] {
  const pairs = new Map<string, Transaction[]>()
  for (const tx of conversions(transactions, ledger)) {
    const key = `${tx.currency}|${tx.toCurrency}`
    pairs.set(key, [...(pairs.get(key) ?? []), tx])
  }
  const summaries = [...pairs.values()].map((txs): ConvertPairSummary => {
    const fromTotal = sumBy(txs, (tx) => D(tx.amount))
    const toTotal = sumBy(txs, (tx) => D(tx.toAmount))
    const spreads = txs.flatMap((tx) => {
      const spread = spreadAmount(tx)
      return spread ? [{ ...spread, rate: D(tx.fxRate) }] : []
    })
    const market = sumBy(spreads, (s) => s.market)
    return {
      from: txs[0].currency,
      to: txs[0].toCurrency ?? '',
      count: txs.length,
      fromTotal,
      toTotal,
      avgRate: fromTotal.div(toTotal),
      avgSpreadPct: spreads.length > 0 ? sumBy(spreads, (s) => s.lost).div(market).times(100) : null,
      spreadLostBase: spreads.length > 0 ? sumBy(spreads, (s) => s.lost.times(s.rate)) : null,
    }
  })
  return summaries.sort((a, b) => b.count - a.count)
}

export function convertHistory(transactions: readonly Transaction[], ledger: Ledger): ConvertRow[] {
  return conversions(transactions, ledger)
    .reverse()
    .map((tx) => {
      const { effectiveRate, marketRate, spreadPct } = fxConvertSummary(tx)
      return {
        txId: tx.id,
        date: tx.date,
        from: tx.currency,
        to: tx.toCurrency ?? '',
        amount: D(tx.amount),
        toAmount: D(tx.toAmount),
        effectiveRate,
        marketRate,
        spreadPct,
      }
    })
}

export function cashFxRows(cash: readonly CashValue[], ledger: Ledger, baseCurrency: string): CashFxRow[] {
  const costs = new Map(ledger.cash.map((row) => [`${row.accountId}|${row.currency}`, row.costBase]))
  return cash
    .filter((row) => row.currency !== baseCurrency)
    .map((row) => {
      const costBase = costs.get(`${row.accountId}|${row.currency}`) ?? D(0)
      return {
        accountId: row.accountId,
        currency: row.currency,
        amount: row.amount,
        costBase,
        valueBase: row.base,
        effectBase: row.base ? row.base.minus(costBase) : null,
      }
    })
}

export function remittancesByTaxYear(transactions: readonly Transaction[], ledger: Ledger): RemittanceYear[] {
  const years = new Map<number, RemittanceYear>()
  for (const tx of keptTransactions(transactions, ledger, 'withdraw')) {
    if (!tx.remitToThailand || tx.taxYear === undefined) continue
    const year = years.get(tx.taxYear) ?? { taxYear: tx.taxYear, totalBase: D(0), count: 0 }
    year.totalBase = year.totalBase.plus(D(tx.amount).times(D(tx.fxRate)))
    year.count += 1
    years.set(tx.taxYear, year)
  }
  return [...years.values()].sort((a, b) => b.taxYear - a.taxYear)
}

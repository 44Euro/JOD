import { D, Decimal, sumBy } from './decimal'
import {
  accountTracksCash,
  acquisitionCostQuote,
  cashDeltaQuote,
  sortTransactions,
  transferInQuote,
  type Ledger,
} from './ledger'
import type { Transaction } from './types'
import { summarizePortfolio, type PositionValuation } from './valuation'

// amountBase > 0 is money the investor put in, < 0 is money taken out.
export interface InvestorFlow {
  txId: string
  date: string
  accountId: string
  amountBase: Decimal
}

export interface NetInvested {
  totalBase: Decimal
  inBase: Decimal
  outBase: Decimal
}

export interface CashValue {
  accountId: string
  currency: string
  amount: Decimal
  base: Decimal | null
}

export interface NetWorth {
  holdingsBase: Decimal
  cashBase: Decimal
  totalBase: Decimal
  cash: CashValue[]
  unpricedCount: number
  missingRates: string[]
}

export interface GainBreakdown {
  totalBase: Decimal
  unrealizedPriceBase: Decimal
  unrealizedFxBase: Decimal
  realizedBase: Decimal
  incomeBase: Decimal
  otherFeesBase: Decimal
  cashFxBase: Decimal
}

export interface InvestorSummary {
  flows: InvestorFlow[]
  invested: NetInvested
  worth: NetWorth
  gain: GainBreakdown
}

export interface InvestorInput {
  transactions: readonly Transaction[]
  ledger: Ledger
  valuations: readonly PositionValuation[]
  rates: Readonly<Record<string, string>>
}

function cashTracking(transactions: readonly Transaction[]): (accountId: string) => boolean {
  const known = new Map<string, boolean>()
  return (accountId) => {
    let tracks = known.get(accountId)
    if (tracks === undefined) {
      tracks = accountTracksCash(transactions, accountId)
      known.set(accountId, tracks)
    }
    return tracks
  }
}

function flowQuote(tx: Transaction, tracksCash: boolean): Decimal {
  if (tx.type === 'opening') return tx.instrumentId ? acquisitionCostQuote(tx) : D(tx.amount)
  if (tracksCash) {
    if (tx.type === 'deposit') return D(tx.amount)
    if (tx.type === 'withdraw') return D(tx.amount).negated()
    return D(0)
  }
  // Spec 7.4: an account without deposits or withdrawals treats every payment as money put in and every
  // receipt as money taken out, so its unknown cash balance never enters the value.
  return cashDeltaQuote(tx).negated()
}

// A transfer touches two accounts and each side is judged on its own: an account that records cash simply
// moves its balance, while one that only records trades treats what it pays out as money in and what it
// receives as money out.
function flowParts(tx: Transaction, tracks: (accountId: string) => boolean): { accountId: string; amount: Decimal }[] {
  if (tx.type !== 'transfer') return [{ accountId: tx.accountId, amount: flowQuote(tx, tracks(tx.accountId)) }]
  const toAccountId = tx.toAccountId ?? ''
  return [
    { accountId: tx.accountId, amount: tracks(tx.accountId) ? D(0) : cashDeltaQuote(tx).negated() },
    { accountId: toAccountId, amount: tracks(toAccountId) ? D(0) : transferInQuote(tx).negated() },
  ]
}

// Transactions the ledger skipped moved nothing, so they must not move money in or out either.
export function investorFlows(transactions: readonly Transaction[], ledger: Ledger): InvestorFlow[] {
  const skipped = new Set(ledger.issues.map((issue) => issue.txId))
  const tracks = cashTracking(transactions)
  const flows: InvestorFlow[] = []
  for (const tx of sortTransactions(transactions)) {
    if (skipped.has(tx.id)) continue
    for (const { accountId, amount } of flowParts(tx, tracks)) {
      if (amount.isZero()) continue
      flows.push({ txId: tx.id, date: tx.date, accountId, amountBase: amount.times(D(tx.fxRate)) })
    }
  }
  return flows
}

export function netInvested(flows: readonly InvestorFlow[]): NetInvested {
  const inBase = sumBy(
    flows.filter((f) => f.amountBase.greaterThan(0)),
    (f) => f.amountBase,
  )
  const outBase = sumBy(
    flows.filter((f) => f.amountBase.lessThan(0)),
    (f) => f.amountBase.negated(),
  )
  return { totalBase: inBase.minus(outBase), inBase, outBase }
}

// A holding without a price (or without today's rate) is counted at cost, so a missing price reads as
// "no change" instead of losing the whole holding.
export function positionValueBase(v: PositionValuation): Decimal {
  return v.marketValueBase ?? v.position.costBase
}

export function netWorth(input: InvestorInput): NetWorth {
  const tracks = cashTracking(input.transactions)
  const cash = input.ledger.cash
    .filter((row) => tracks(row.accountId))
    .map((row) => {
      const rate = input.rates[row.currency]
      return { ...row, base: rate ? row.amount.times(D(rate)) : null }
    })
  const missing = new Set<string>()
  for (const v of input.valuations) if (!v.currentFxRate) missing.add(v.position.currency)
  for (const row of cash) if (!row.base) missing.add(row.currency)
  const holdingsBase = sumBy(input.valuations, positionValueBase)
  const cashBase = sumBy(cash, (row) => row.base ?? D(0))
  return {
    holdingsBase,
    cashBase,
    totalBase: holdingsBase.plus(cashBase),
    cash,
    unpricedCount: input.valuations.filter((v) => v.marketValueBase === null).length,
    missingRates: [...missing].sort(),
  }
}

// Costs that are not already inside a cost basis, sale proceeds or net income.
function otherCostQuote(tx: Transaction): Decimal {
  switch (tx.type) {
    case 'fee':
      return D(tx.amount).plus(D(tx.fees)).plus(D(tx.tax))
    case 'withdraw':
      return D(tx.fees).plus(D(tx.tax))
    case 'deposit':
    case 'fx_convert':
    case 'transfer':
      return D(tx.fees)
    default:
      return D(0)
  }
}

export function summarizeInvestor(input: InvestorInput): InvestorSummary {
  const flows = investorFlows(input.transactions, input.ledger)
  const invested = netInvested(flows)
  const worth = netWorth(input)
  const portfolio = summarizePortfolio(input.valuations)
  const skipped = new Set(input.ledger.issues.map((issue) => issue.txId))
  const totalBase = worth.totalBase.minus(invested.totalBase)
  const realizedBase = sumBy(input.ledger.realized, (e) => e.realizedBase)
  const incomeBase = sumBy(input.ledger.income, (e) => e.netBase)
  const otherFeesBase = sumBy(
    input.transactions.filter((tx) => !skipped.has(tx.id)),
    (tx) => otherCostQuote(tx).times(D(tx.fxRate)),
  )
  // Whatever the other parts do not explain is the currency effect on cash held, so the parts always add
  // up to the total exactly (spec 7.4).
  const cashFxBase = totalBase
    .minus(portfolio.unrealizedBase)
    .minus(realizedBase)
    .minus(incomeBase)
    .plus(otherFeesBase)
  return {
    flows,
    invested,
    worth,
    gain: {
      totalBase,
      unrealizedPriceBase: portfolio.priceEffectBase,
      unrealizedFxBase: portfolio.fxEffectBase,
      realizedBase,
      incomeBase,
      otherFeesBase,
      cashFxBase,
    },
  }
}

export interface DailySnapshot {
  valueBase: string
  netInvestedBase: string
}

// A day is only worth keeping once every currency has a rate; before that the value would be a guess.
export function dailySnapshot(summary: InvestorSummary): DailySnapshot | null {
  if (summary.flows.length === 0 || summary.worth.missingRates.length > 0) return null
  return { valueBase: summary.worth.totalBase.toFixed(2), netInvestedBase: summary.invested.totalBase.toFixed(2) }
}

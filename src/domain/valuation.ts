import { D, Decimal, sumBy } from './decimal'
import { sortTransactions, type Position } from './ledger'
import type { Transaction } from './types'

export interface PositionValuation {
  position: Position
  avgCostQuote: Decimal
  avgFxRate: Decimal | null
  lastPrice: Decimal | null
  currentFxRate: Decimal | null
  marketValueQuote: Decimal | null
  marketValueBase: Decimal | null
  unrealizedQuote: Decimal | null
  unrealizedBase: Decimal | null
  priceEffectBase: Decimal | null
  fxEffectBase: Decimal | null
}

export function valuePosition(position: Position, lastPrice?: string, currentFxRate?: string): PositionValuation {
  const result: PositionValuation = {
    position,
    avgCostQuote: position.costQuote.div(position.quantity),
    avgFxRate: position.costQuote.isZero() ? null : position.costBase.div(position.costQuote),
    lastPrice: lastPrice ? D(lastPrice) : null,
    currentFxRate: currentFxRate ? D(currentFxRate) : null,
    marketValueQuote: null,
    marketValueBase: null,
    unrealizedQuote: null,
    unrealizedBase: null,
    priceEffectBase: null,
    fxEffectBase: null,
  }
  if (!result.lastPrice) return result
  result.marketValueQuote = position.quantity.times(result.lastPrice)
  result.unrealizedQuote = result.marketValueQuote.minus(position.costQuote)
  if (!result.currentFxRate) return result
  result.marketValueBase = result.marketValueQuote.times(result.currentFxRate)
  result.unrealizedBase = result.marketValueBase.minus(position.costBase)
  result.priceEffectBase = result.unrealizedQuote.times(result.avgFxRate ?? result.currentFxRate)
  result.fxEffectBase = result.unrealizedBase.minus(result.priceEffectBase)
  return result
}

export interface PortfolioSummary {
  costBase: Decimal
  marketValueBase: Decimal
  unrealizedBase: Decimal
  priceEffectBase: Decimal
  fxEffectBase: Decimal
  unvaluedCount: number
}

export function summarizePortfolio(valuations: readonly PositionValuation[]): PortfolioSummary {
  const valued = valuations.filter((v) => v.marketValueBase !== null)
  return {
    costBase: sumBy(valued, (v) => v.position.costBase),
    marketValueBase: sumBy(valued, (v) => v.marketValueBase ?? D(0)),
    unrealizedBase: sumBy(valued, (v) => v.unrealizedBase ?? D(0)),
    priceEffectBase: sumBy(valued, (v) => v.priceEffectBase ?? D(0)),
    fxEffectBase: sumBy(valued, (v) => v.fxEffectBase ?? D(0)),
    unvaluedCount: valuations.length - valued.length,
  }
}

export interface CurrencyCost {
  currency: string
  costQuote: Decimal
  costBase: Decimal
  avgRate: Decimal
}

// The average rate at which the money now sitting in open positions was converted.
export function avgFxByCurrency(positions: readonly Position[], baseCurrency: string): CurrencyCost[] {
  const rows = new Map<string, CurrencyCost>()
  for (const p of positions) {
    if (p.currency === baseCurrency) continue
    const row = rows.get(p.currency) ?? { currency: p.currency, costQuote: D(0), costBase: D(0), avgRate: D(0) }
    row.costQuote = row.costQuote.plus(p.costQuote)
    row.costBase = row.costBase.plus(p.costBase)
    rows.set(p.currency, row)
  }
  return [...rows.values()]
    .filter((row) => !row.costQuote.isZero())
    .map((row) => ({ ...row, avgRate: row.costBase.div(row.costQuote) }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
}

// Fallback for currencies the FX provider does not cover, e.g. VND or TWD.
export function latestRecordedRate(transactions: readonly Transaction[], currency: string): string | undefined {
  const sorted = sortTransactions(transactions)
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const tx = sorted[i]
    if (tx.currency === currency && tx.fxSource !== 'same') return tx.fxRate
  }
  return undefined
}

import { D, Decimal } from './decimal'
import type { Transaction } from './types'

export function spreadPct(actual: Decimal.Value, reference: Decimal.Value | null | undefined): Decimal | null {
  if (reference === undefined || reference === null || reference === '') return null
  const ref = D(reference)
  if (ref.isZero()) return null
  return D(actual).minus(ref).div(ref).times(100)
}

export interface FxConvertSummary {
  effectiveRate: Decimal
  marketRate: Decimal | null
  spreadPct: Decimal | null
}

// Rates are "source currency per 1 unit of target currency", so a positive spread means you paid more than mid-market.
// The fee is taken out of `amount`, so amount ÷ toAmount is the rate after the fee.
export function fxConvertSummary(tx: Transaction): FxConvertSummary {
  const effectiveRate = D(tx.amount).div(D(tx.toAmount))
  return {
    effectiveRate,
    marketRate: tx.marketRate ? D(tx.marketRate) : null,
    spreadPct: spreadPct(effectiveRate, tx.marketRate),
  }
}

import { D, sumBy, type Decimal } from '../domain/decimal'
import { spreadPct } from '../domain/fxConvert'
import { avgFxByCurrency, type PositionValuation } from '../domain/valuation'
import type { RateInfo } from './hooks'

export interface RateBoardRow {
  currency: string
  heldQuote: Decimal
  mine: Decimal
  today: Decimal | null
  todayNote: string
  diffPct: Decimal | null
  effectBase: Decimal | null
}

// "mine" is the average rate of the money still sitting in open positions; the effect only counts positions
// that have a price, the same ones the portfolio summary counts. What is held counts every position in the
// currency, at its value where it has a price and at its cost where it has none.
export function buildRateBoard(
  valuations: readonly PositionValuation[],
  baseCurrency: string,
  rates: Record<string, RateInfo>,
): RateBoardRow[] {
  return avgFxByCurrency(
    valuations.map((v) => v.position),
    baseCurrency,
  ).map((row) => {
    const rate = rates[row.currency]
    const inCurrency = valuations.filter((v) => v.position.currency === row.currency)
    const valued = inCurrency.filter((v) => v.fxEffectBase !== null)
    return {
      currency: row.currency,
      heldQuote: sumBy(inCurrency, (v) => v.marketValueQuote ?? v.position.costQuote),
      mine: row.avgRate,
      today: rate ? D(rate.rate) : null,
      todayNote: rate?.note ?? '',
      diffPct: rate ? spreadPct(rate.rate, row.avgRate) : null,
      effectBase: valued.length > 0 ? sumBy(valued, (v) => v.fxEffectBase ?? D(0)) : null,
    }
  })
}

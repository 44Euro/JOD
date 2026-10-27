import { D, type Decimal } from './decimal'

// After the years the person picks, a business is assumed to grow about as fast as the economy for ever.
export const TERMINAL_GROWTH_PCT = D('2.5')

export interface DcfInput {
  freeCashFlow: Decimal
  shares: Decimal
  growthPct: Decimal
  discountPct: Decimal
  years: number
}

export interface DcfValue {
  perShare: Decimal
  // The years the person picked, each discounted to today.
  presentValue: Decimal
  // Everything after those years, discounted to today.
  terminalPresentValue: Decimal
}

// A two-stage discounted cash flow: free cash flow grows at growthPct for `years`, then at the terminal rate, all
// discounted at the return the person wants. Cash and debt are left out, which the page says. No value comes out
// where the method means nothing: no positive cash flow, no shares, or a return no higher than the terminal growth.
export function dcf({ freeCashFlow, shares, growthPct, discountPct, years }: DcfInput): DcfValue | null {
  if (freeCashFlow.lte(0) || shares.lte(0) || years < 1 || discountPct.lte(TERMINAL_GROWTH_PCT)) return null
  const growth = growthPct.div(100).plus(1)
  const discount = discountPct.div(100).plus(1)
  const terminal = TERMINAL_GROWTH_PCT.div(100)
  let presentValue = D(0)
  for (let year = 1; year <= years; year++) presentValue = presentValue.plus(freeCashFlow.times(growth.pow(year)).div(discount.pow(year)))
  const lastYear = freeCashFlow.times(growth.pow(years))
  const terminalValue = lastYear.times(terminal.plus(1)).div(discountPct.div(100).minus(terminal))
  const terminalPresentValue = terminalValue.div(discount.pow(years))
  return { perShare: presentValue.plus(terminalPresentValue).div(shares), presentValue, terminalPresentValue }
}

// The yearly rate that takes the first positive value to the last one; years with a loss in between still count as
// time passing.
export function historicalGrowthPct(values: readonly Decimal[]): Decimal | null {
  const first = values.findIndex((v) => v.gt(0))
  const last = values.findLastIndex((v) => v.gt(0))
  if (first < 0 || last <= first) return null
  return values[last].div(values[first]).pow(D(1).div(last - first)).minus(1).times(100)
}

import type { Decimal } from '../domain/decimal'
import { fmtNumber } from './format'

// A spread that rounds to nothing at the two digits shown is not "more expensive" or "cheaper" than the market.
export function spreadText(spread: Decimal): string {
  if (spread.toDecimalPlaces(2).isZero()) return 'เท่าตลาด'
  return `${spread.greaterThan(0) ? 'แพงกว่า' : 'ถูกกว่า'}ตลาด ${fmtNumber(spread.abs())}%`
}

import { D, Decimal } from './decimal'
import type { FeeTemplate } from './types'

// The minimum applies to the commission, so VAT is charged on it; the fixed fee per order is added after.
export function orderFee(template: FeeTemplate, orderValue: Decimal): Decimal {
  const commission = Decimal.max(orderValue.times(D(template.commissionPct)).div(100), D(template.minimum))
  return commission
    .times(D(template.vatPct).div(100).plus(1))
    .plus(D(template.perOrder))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
}

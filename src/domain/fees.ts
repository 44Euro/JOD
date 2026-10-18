import { D, Decimal } from './decimal'
import type { FeeTemplate } from './types'
import { fmtNumber } from '../ui/format'

// The minimum applies to the commission, so VAT is charged on it; the fixed fee per order is added after.
export function orderFee(template: FeeTemplate, orderValue: Decimal): Decimal {
  const commission = Decimal.max(orderValue.times(D(template.commissionPct)).div(100), D(template.minimum))
  return commission
    .times(D(template.vatPct).div(100).plus(1))
    .plus(D(template.perOrder))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
}

export function feeTemplateSummary(template: FeeTemplate): string {
  const pct = D(template.commissionPct)
  const perOrder = D(template.perOrder)
  const vat = D(template.vatPct)
  const minimum = D(template.minimum)
  const number = (value: Decimal) => fmtNumber(value, 4)
  const commission = pct.isZero()
    ? `ค่าคอม ${number(perOrder)}`
    : perOrder.isZero()
      ? `${number(pct)}%`
      : `${number(pct)}% + ${number(perOrder)}`
  const vatPart = vat.isZero() ? '' : ` + VAT ${number(vat)}%`
  const tail = minimum.isZero()
    ? ' ต่อคำสั่ง'
    : ` · ขั้นต่ำ ${number(minimum)} ${template.currency === 'THB' ? 'บาท' : template.currency}`
  return `${template.currency} · ${commission}${vatPart}${tail}`
}

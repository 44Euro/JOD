import { D, type Decimal } from '../domain/decimal'
import type { FeeTemplate } from '../domain/types'
import { fmtPlain } from './format'
import { t } from '../i18n'

// A plus and VAT with its rate are joined with a no-break space, so a wrapped line never ends on a plus or splits VAT
// from its rate.
const NO_BREAK = '\u00a0'

// The minimum comes apart from the rest so a screen can keep it on one line when the summary wraps.
export function feeTemplateParts(template: FeeTemplate): { body: string; minimum: string } {
  const pct = D(template.commissionPct)
  const perOrder = D(template.perOrder)
  const vat = D(template.vatPct)
  const minimum = D(template.minimum)
  const number = (value: Decimal) => fmtPlain(value, 4)
  let perOrderSaid = false
  let commission = pct.isZero() ? t('ค่าคอม {0}', number(perOrder)) : `${number(pct)}%`
  if (!perOrder.isZero() && !pct.isZero()) {
    commission += t(' +{0}{1} ต่อคำสั่ง', NO_BREAK, number(perOrder))
    perOrderSaid = true
  } else if (!perOrder.isZero() && !minimum.isZero()) {
    commission += t(' ต่อคำสั่ง')
    perOrderSaid = true
  }
  const vatPart = vat.isZero() ? '' : ` +${NO_BREAK}VAT${NO_BREAK}${number(vat)}%`
  const closing = minimum.isZero() && !perOrderSaid ? t(' ต่อคำสั่ง') : ''
  const unit = template.currency === 'THB' ? t('บาท') : template.currency
  return {
    body: `${template.currency} · ${commission}${vatPart}${closing}`,
    minimum: minimum.isZero() ? '' : t('· ขั้นต่ำ {0} {1}', number(minimum), unit),
  }
}

export function feeTemplateSummary(template: FeeTemplate): string {
  const { body, minimum } = feeTemplateParts(template)
  return minimum ? `${body} ${minimum}` : body
}

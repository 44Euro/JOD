import type { Decimal } from '../domain/decimal'
import { fmtPct } from './format'
import { t } from '../i18n'

// A spread that rounds to nothing at the two digits shown is not "more expensive" or "cheaper" than the market.
export function spreadText(spread: Decimal): string {
  if (spread.toDecimalPlaces(2).isZero()) return t('เท่าตลาด')
  return t('{0}ตลาด {1}', spread.greaterThan(0) ? t('แพงกว่า') : t('ถูกกว่า'), fmtPct(spread.abs()))
}

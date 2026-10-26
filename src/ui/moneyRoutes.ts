import type { Decimal } from '../domain/decimal'
import type { HoldingStats } from '../domain/holdings'
import type { InvestorSummary } from '../domain/investor'
import type { Instrument } from '../domain/types'
import type { Station } from './components/MoneyRoute'
import { fmtHeadline, fmtNumber, fmtPrice, fmtRate, fmtSigned, fmtSignedPct } from './format'
import { unitLabel } from './labels'
import { t } from '../i18n'

export function toneOf(value: Decimal | null): Station['tone'] {
  if (!value) return undefined
  return value.greaterThan(0) ? 'gain' : value.lessThan(0) ? 'loss' : undefined
}

// Spec S1: money invested → unrealized by price → unrealized by currency → realized → income →
// fees and the currency effect on cash → value today. Every station is rounded to whole units. The
// fees/cash station is the exact remainder rounded like the others, and whatever the rounding leaves over
// goes on the stock station, so the stations add up to the end value and an account without fees never
// shows a phantom fee.
export function investorRoute({ invested, worth, gain }: InvestorSummary): Station[] {
  const start = invested.totalBase.toDecimalPlaces(0)
  const end = worth.totalBase.toDecimalPlaces(0)
  const fx = gain.unrealizedFxBase.toDecimalPlaces(0)
  const realized = gain.realizedBase.toDecimalPlaces(0)
  const income = gain.incomeBase.toDecimalPlaces(0)
  const rest = worth.totalBase
    .minus(invested.totalBase)
    .minus(gain.unrealizedPriceBase)
    .minus(gain.unrealizedFxBase)
    .minus(gain.realizedBase)
    .minus(gain.incomeBase)
    .toDecimalPlaces(0)
  const price = end.minus(start).minus(fx).minus(realized).minus(income).minus(rest)
  return [
    { value: fmtNumber(start, 0), label: t('เงินลงทุน') },
    { value: fmtSigned(price, 0), label: price.lessThan(0) ? t('หุ้นลง · ยังไม่ขาย') : t('หุ้นขึ้น · ยังไม่ขาย'), tone: toneOf(price) },
    { value: fmtSigned(fx, 0), label: t('ค่าเงิน · ยังไม่ขาย'), tone: 'fx', fx: true },
    { value: fmtSigned(realized, 0), label: t('ขายแล้ว'), tone: toneOf(realized) },
    { value: fmtSigned(income, 0), label: t('ปันผล ดอกเบี้ย'), tone: toneOf(income), neutral: true },
    { value: fmtSigned(rest, 0), label: t('ค่าธรรมเนียม · ค่าเงินเงินสด'), tone: toneOf(rest), fx: true },
    { value: fmtNumber(end, 0), label: t('วันนี้') },
  ]
}

function home(base: string): string {
  return base === 'THB' ? t('บาท') : base
}

function rateDirection(average: Decimal | null, today: Decimal | null, base: string): string {
  if (!average || !today) return t('ยังไม่มีเรท')
  if (today.lessThan(average)) return t('{0}แข็งขึ้น', home(base))
  return today.greaterThan(average) ? t('{0}อ่อนลง', home(base)) : t('เรทเท่าเดิม')
}

// Spec S5: money in → average exchange rate → average cost → today's price → today's rate → value today.
// These stations are prices and rates, not amounts, so unlike the overview route they do not add up.
// An asset held in more than one currency has no single rate or cost, so only the two base-currency stations are left.
export function assetRoute(
  stats: HoldingStats,
  lastPrice: Decimal | null,
  todayRate: Decimal | null,
  base: string,
  instrument?: Instrument,
): Station[] {
  if (stats.quantity.isZero()) return []
  const moneyIn: Station = { value: fmtHeadline(stats.costBase, base), label: t('{0}ที่ลงไป', home(base)), neutral: true }
  const worthToday: Station = { value: fmtHeadline(stats.valueBase, base), label: t('มูลค่าวันนี้') }
  if (stats.currency === null) return [moneyIn, worthToday]
  const foreign = stats.currency !== base
  const avgCost = stats.costQuote.div(stats.quantity)
  const avgRate = stats.costQuote.isZero() ? null : stats.costBase.div(stats.costQuote)
  const change = lastPrice && !avgCost.isZero() ? lastPrice.minus(avgCost).div(avgCost).times(100) : null
  return [
    moneyIn,
    ...(foreign ? [{ value: fmtRate(avgRate), label: t('แลกเป็น {0} · เรทเฉลี่ย', stats.currency), tone: 'fx' as const, fx: true }] : []),
    { value: fmtPrice(avgCost), label: t('ซื้อ {0} {1} · ทุนเฉลี่ย', fmtNumber(stats.quantity, 8), unitLabel(instrument)) },
    {
      value: fmtPrice(lastPrice),
      label: change ? t('ราคาวันนี้ · {0}', fmtSignedPct(change)) : t('ราคาวันนี้ · ยังไม่ได้กรอก'),
      tone: toneOf(change),
    },
    ...(foreign
      ? [{ value: fmtRate(todayRate), label: t('เรทวันนี้ · {0}', rateDirection(avgRate, todayRate, base)), tone: 'fx' as const, fx: true }]
      : []),
    worthToday,
  ]
}

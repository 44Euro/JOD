import type { Decimal } from '../domain/decimal'
import type { HoldingStats } from '../domain/holdings'
import type { Station } from './components/MoneyRoute'
import { fmtHeadline, fmtNumber, fmtPrice, fmtRate, fmtSignedPct } from './format'

export function toneOf(value: Decimal | null): Station['tone'] {
  if (!value) return undefined
  return value.greaterThan(0) ? 'gain' : value.lessThan(0) ? 'loss' : undefined
}

function home(base: string): string {
  return base === 'THB' ? 'บาท' : base
}

function rateDirection(average: Decimal | null, today: Decimal | null, base: string): string {
  if (!average || !today) return 'ยังไม่มีเรท'
  if (today.lessThan(average)) return `${home(base)}แข็งขึ้น`
  return today.greaterThan(average) ? `${home(base)}อ่อนลง` : 'เรทเท่าเดิม'
}

// Spec S5: money in → average exchange rate → average cost → today's price → today's rate → value today.
// These stations are prices and rates, not amounts, so unlike the overview route they do not add up.
export function assetRoute(stats: HoldingStats, lastPrice: Decimal | null, todayRate: Decimal | null, base: string): Station[] {
  if (stats.quantity.isZero()) return []
  const foreign = stats.currency !== base
  const avgCost = stats.costQuote.div(stats.quantity)
  const avgRate = stats.costQuote.isZero() ? null : stats.costBase.div(stats.costQuote)
  const change = lastPrice && !avgCost.isZero() ? lastPrice.minus(avgCost).div(avgCost).times(100) : null
  return [
    { value: fmtHeadline(stats.costBase, base), label: `${home(base)}ที่ลงไป`, neutral: true },
    ...(foreign ? [{ value: fmtRate(avgRate), label: `แลกเป็น ${stats.currency} · เรทเฉลี่ย`, tone: 'fx' as const, fx: true }] : []),
    { value: fmtPrice(avgCost), label: `ซื้อ ${fmtNumber(stats.quantity, 8)} หน่วย · ทุนเฉลี่ย` },
    {
      value: fmtPrice(lastPrice),
      label: change ? `ราคาวันนี้ · ${fmtSignedPct(change)}` : 'ราคาวันนี้ · ยังไม่ได้กรอก',
      tone: toneOf(change),
    },
    ...(foreign
      ? [{ value: fmtRate(todayRate), label: `เรทวันนี้ · ${rateDirection(avgRate, todayRate, base)}`, tone: 'fx' as const, fx: true }]
      : []),
    { value: fmtHeadline(stats.valueBase, base), label: 'มูลค่าวันนี้' },
  ]
}

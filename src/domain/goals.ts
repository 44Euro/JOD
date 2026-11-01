import { D, isDecimalString, type Decimal } from './decimal'
import { isIsoDate } from './dates'
import { t } from '../i18n'

export interface GoalPlan {
  months: number
  // How much of the target today's value is, up to 100.
  sharePct: Decimal
  reached: boolean
  // What to put in each month with no growth at all; null once the date has come.
  flatMonthly: Decimal | null
  // The same at the given yearly return; null without a return or once the date has come.
  returnMonthly: Decimal | null
}

// Whole months from today to the target date; a target later in this month counts as none left.
function monthsUntil(today: string, date: string): number {
  const [y, m, d] = today.split('-').map(Number)
  const [ty, tm, td] = date.split('-').map(Number)
  return Math.max(0, ty * 12 + tm - (y * 12 + m) - (td < d ? 1 : 0))
}

const atMost100 = (pct: Decimal) => (pct.gt(100) ? D(100) : pct)

// A level monthly saving that, added to today's value growing at the yearly return, reaches the target on the date.
export function goalPlan({ current, target, today, targetDate, annualPct }: { current: Decimal; target: Decimal; today: string; targetDate: string; annualPct: Decimal | null }): GoalPlan {
  const months = monthsUntil(today, targetDate)
  const reached = current.gte(target)
  const sharePct = target.gt(0) ? atMost100(current.div(target).times(100)) : D(100)
  if (reached) return { months, sharePct, reached, flatMonthly: D(0), returnMonthly: annualPct ? D(0) : null }
  if (months === 0) return { months, sharePct, reached, flatMonthly: null, returnMonthly: null }
  const gap = target.minus(current)
  let returnMonthly: Decimal | null = null
  if (annualPct) {
    const monthly = annualPct.div(100).plus(1).pow(D(1).div(12)).minus(1)
    const growth = monthly.plus(1).pow(months)
    const grown = current.times(growth)
    returnMonthly = grown.gte(target) ? D(0) : monthly.isZero() ? gap.div(months) : target.minus(grown).times(monthly).div(growth.minus(1))
  }
  return { months, sharePct, reached, flatMonthly: gap.div(months), returnMonthly }
}

export function validateGoal(goal: { name: string; target: string; targetDate: string }, today: string): string[] {
  const errors: string[] = []
  if (!goal.name.trim()) errors.push(t('ตั้งชื่อเป้าหมาย'))
  if (!isDecimalString(goal.target) || D(goal.target).lte(0)) errors.push(t('จำนวนเงินต้องมากกว่า 0'))
  if (!isIsoDate(goal.targetDate) || goal.targetDate <= today) errors.push(t('วันที่ต้องอยู่หลังวันนี้'))
  return errors
}

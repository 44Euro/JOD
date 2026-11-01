import { describe, expect, it } from 'vitest'
import { D } from './decimal'
import { goalPlan, validateGoal } from './goals'

const goal = { current: D(400000), target: D(1000000), today: '2026-11-01', targetDate: '2028-11-01' }

describe('goalPlan', () => {
  it('works out the monthly saving with no return and at a yearly return', () => {
    const plan = goalPlan({ ...goal, annualPct: D(10) })
    expect(plan.months).toBe(24)
    expect(plan.sharePct.toString()).toBe('40')
    expect(plan.flatMonthly?.toFixed(0)).toBe('25000')
    expect(plan.returnMonthly?.toFixed(0)).toBe('19594')
    expect(plan.reached).toBe(false)
  })

  it('offers no return figure without a yearly return', () => {
    expect(goalPlan({ ...goal, annualPct: null }).returnMonthly).toBeNull()
  })

  it('asks for nothing once the goal is reached', () => {
    const plan = goalPlan({ ...goal, current: D(1200000), annualPct: D(10) })
    expect([plan.reached, plan.sharePct.toString(), plan.flatMonthly?.toString(), plan.returnMonthly?.toString()]).toEqual([true, '100', '0', '0'])
  })

  it('needs no saving when growth alone reaches the target', () => {
    expect(goalPlan({ ...goal, current: D(900000), annualPct: D(10) }).returnMonthly?.toString()).toBe('0')
  })

  it('has no monthly figure once the date has come', () => {
    const plan = goalPlan({ ...goal, targetDate: '2026-11-20', annualPct: D(10) })
    expect([plan.months, plan.flatMonthly, plan.returnMonthly]).toEqual([0, null, null])
  })
})

describe('validateGoal', () => {
  it('asks for a name, a positive amount and a date after today', () => {
    expect(validateGoal({ name: ' ', target: '0', targetDate: '2026-10-01' }, '2026-11-01')).toEqual(['ตั้งชื่อเป้าหมาย', 'จำนวนเงินต้องมากกว่า 0', 'วันที่ต้องอยู่หลังวันนี้'])
    expect(validateGoal({ name: 'บ้าน', target: '1000000', targetDate: '2028-11-01' }, '2026-11-01')).toEqual([])
  })
})

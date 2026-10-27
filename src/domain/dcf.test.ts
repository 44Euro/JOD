import { describe, expect, it } from 'vitest'
import { D } from './decimal'
import { dcf, historicalGrowthPct } from './dcf'

const base = { freeCashFlow: D(100), shares: D(10), growthPct: D(10), discountPct: D(10), years: 5 }

describe('dcf', () => {
  it('values 100 of cash flow growing 10 % at 10 % as 186.67 a share', () => {
    const value = dcf(base)!
    expect(value.presentValue.toFixed(2)).toBe('500.00')
    expect(value.terminalPresentValue.toFixed(2)).toBe('1366.67')
    expect(value.perShare.toFixed(2)).toBe('186.67')
  })

  it('discounts more when the required return is higher than the growth', () => {
    expect(dcf({ ...base, discountPct: D(12) })!.perShare.lessThan(dcf(base)!.perShare)).toBe(true)
  })

  it('gives no value for negative cash flow or a return at or below the terminal growth', () => {
    expect(dcf({ ...base, freeCashFlow: D(-5) })).toBeNull()
    expect(dcf({ ...base, freeCashFlow: D(0) })).toBeNull()
    expect(dcf({ ...base, discountPct: D('2.5') })).toBeNull()
    expect(dcf({ ...base, shares: D(0) })).toBeNull()
    expect(dcf({ ...base, years: 0 })).toBeNull()
  })
})

describe('historicalGrowthPct', () => {
  it('works out the yearly growth between the first and last positive years', () => {
    expect(historicalGrowthPct([D(100), D(110), D(121)])!.toFixed(2)).toBe('10.00')
    expect(historicalGrowthPct([D(-20), D(100), D(50), D(121)])!.toFixed(2)).toBe('10.00')
  })

  it('has no growth with fewer than two positive years', () => {
    expect(historicalGrowthPct([D(100)])).toBeNull()
    expect(historicalGrowthPct([D(-1), D(100), D(-3)])).toBeNull()
  })
})

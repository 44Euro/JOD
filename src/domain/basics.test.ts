import { describe, expect, it } from 'vitest'
import { CURRENCY_OPTIONS, supportsAutoFx } from './currencies'
import { daysBetween, isIsoDate, monthKey, todayLocal } from './dates'
import { D, parseDecimalInput, sumBy } from './decimal'
import { instrumentKey } from './types'

describe('parseDecimalInput', () => {
  it('accepts thousand separators and surrounding spaces', () => {
    expect(parseDecimalInput(' 1,234.50 ')).toBe('1234.5')
  })

  it('keeps tiny values out of exponential notation', () => {
    expect(parseDecimalInput('0.00000001')).toBe('0.00000001')
  })

  it('rejects text, exponents, hex and empty input', () => {
    expect(parseDecimalInput('abc')).toBeNull()
    expect(parseDecimalInput('1e5')).toBeNull()
    expect(parseDecimalInput('0x1F')).toBeNull()
    expect(parseDecimalInput('')).toBeNull()
  })
})

describe('decimal helpers', () => {
  it('avoids floating point drift', () => {
    expect(D('0.1').plus('0.2').toString()).toBe('0.3')
  })

  it('treats empty values as zero and sums', () => {
    expect(D(undefined).toString()).toBe('0')
    expect(sumBy(['1.1', '2.2'], (v) => D(v)).toString()).toBe('3.3')
  })
})

describe('dates', () => {
  it('formats today in local time', () => {
    expect(todayLocal(new Date(2024, 0, 5, 23, 59))).toBe('2024-01-05')
  })

  it('validates real calendar dates only', () => {
    expect(isIsoDate('2024-02-29')).toBe(true)
    expect(isIsoDate('2023-02-29')).toBe(false)
    expect(isIsoDate('2024-1-5')).toBe(false)
  })

  it('extracts the month key', () => {
    expect(monthKey('2024-03-15')).toBe('2024-03')
  })

  it('counts whole days between two dates, across month ends', () => {
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2)
    expect(daysBetween('2024-01-15', '2024-01-15')).toBe(0)
  })
})

describe('instruments and currencies', () => {
  it('builds a normalized instrument key', () => {
    expect(instrumentKey('US', ' aapl ')).toBe('US:AAPL')
    expect(instrumentKey('HK', '0700')).toBe('HK:0700')
  })

  it('knows which currencies have automatic FX rates', () => {
    expect(supportsAutoFx('THB')).toBe(true)
    expect(supportsAutoFx('VND')).toBe(false)
  })

  it('lists each currency once with THB first', () => {
    expect(CURRENCY_OPTIONS[0]).toBe('THB')
    expect(CURRENCY_OPTIONS.filter((c) => c === 'USD')).toHaveLength(1)
    expect(CURRENCY_OPTIONS).toContain('VND')
  })
})

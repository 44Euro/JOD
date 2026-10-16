import { describe, expect, it } from 'vitest'
import { fmtDate, fmtDay, fmtHeadline, fmtMoney, fmtNumber, fmtPct, fmtSigned, plClass } from './format'

describe('format', () => {
  it('formats money with two decimals, Thai grouping and a real minus sign', () => {
    expect(fmtMoney('1234.5', 'THB')).toBe('1,234.50 THB')
    expect(fmtMoney('-500', 'USD')).toBe('−500.00 USD')
    expect(fmtMoney(null, 'THB')).toBe('—')
  })

  it('always shows a sign on gains and losses', () => {
    expect(fmtSigned('7000')).toBe('+7,000.00')
    expect(fmtSigned('-2400')).toBe('−2,400.00')
    expect(fmtSigned('0')).toBe('0.00')
    expect(fmtSigned('-28300.4', 0)).toBe('−28,300')
  })

  it('keeps small crypto quantities readable', () => {
    expect(fmtNumber('0.00000001', 8)).toBe('0.00000001')
    expect(fmtPct('1.4925')).toBe('1.49%')
  })

  it('picks the gain or loss colour', () => {
    expect(plClass('5')).toBe('text-gain')
    expect(plClass('-1')).toBe('text-loss')
    expect(plClass('0')).toBe('')
  })

  it('writes headline numbers in whole units with the baht sign', () => {
    expect(fmtHeadline('1296100.4', 'THB')).toBe('฿1,296,100')
    expect(fmtHeadline('1200.4', 'USD')).toBe('1,200 USD')
  })

  it('shows dates in the Gregorian year with a Thai weekday', () => {
    expect(fmtDate('2026-10-16')).toBe('16 ต.ค. 2026')
    expect(fmtDay('2024-01-15')).toBe('จันทร์ 15 ม.ค. 2024')
  })
})

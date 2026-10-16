import { describe, expect, it } from 'vitest'
import { fmtDate, fmtDay, fmtHeadline, fmtMoney, fmtNumber, fmtPct, fmtPrice, fmtRate, fmtSigned, fmtValue, plClass } from './format'

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

  it('shows prices with at least two decimals and keeps tiny prices exact', () => {
    expect(fmtPrice('512.3')).toBe('512.30')
    expect(fmtPrice('457.9429')).toBe('457.9429')
    expect(fmtPrice('457.94291')).toBe('457.9429')
    expect(fmtPrice('1200')).toBe('1,200.00')
    expect(fmtPrice('0.00001234')).toBe('0.00001234')
    expect(fmtPrice('-512.3')).toBe('−512.30')
    expect(fmtPrice(null)).toBe('—')
  })

  it('shows rates with two decimals, or four to six below one', () => {
    expect(fmtRate('34.2152')).toBe('34.22')
    expect(fmtRate('33')).toBe('33.00')
    expect(fmtRate('0.0014')).toBe('0.0014')
    expect(fmtRate('0.2')).toBe('0.2000')
    expect(fmtRate('0.00012345678')).toBe('0.000123')
    expect(fmtRate('-34.2152')).toBe('−34.22')
  })

  it('shows values in whole units', () => {
    expect(fmtValue('721666.76')).toBe('721,667')
    expect(fmtValue('120947.4')).toBe('120,947')
    expect(fmtValue('-87593.2')).toBe('−87,593')
    expect(fmtValue(undefined)).toBe('—')
  })

  it('uses a real minus sign for every negative number', () => {
    expect(fmtNumber('-1234.5')).toBe('−1,234.5')
    expect(fmtHeadline('-1200.4', 'THB')).toBe('−฿1,200')
    expect(fmtHeadline('-1200.4', 'USD')).toBe('−1,200 USD')
  })

  it('takes the sign after rounding to the digits shown', () => {
    expect(fmtSigned('0.004')).toBe('0.00')
    expect(fmtSigned('-0.004')).toBe('0.00')
    expect(fmtSigned('0.005')).toBe('+0.01')
    expect(fmtSigned('-0.4', 0)).toBe('0')
    expect(fmtMoney('-0.004', 'USD')).toBe('0.00 USD')
    expect(fmtNumber('-0.004')).toBe('0')
    expect(fmtValue('-0.4')).toBe('0')
  })

  it('shows dates in the Gregorian year with a Thai weekday', () => {
    expect(fmtDate('2026-10-16')).toBe('16 ต.ค. 2026')
    expect(fmtDay('2024-01-15')).toBe('จันทร์ 15 ม.ค. 2024')
  })
})

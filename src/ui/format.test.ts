import { afterEach, describe, expect, it } from 'vitest'
import { D } from '../domain/decimal'
import {
  HIDDEN_NUMBER,
  currencyMark,
  fmtAmount,
  fmtDate,
  fmtDay,
  fmtHeadline,
  fmtMoney,
  fmtMonth,
  fmtNumber,
  fmtPct,
  fmtPlain,
  fmtPrice,
  fmtRate,
  fmtRatio,
  fmtSigned,
  fmtSignedPct,
  fmtValue,
  fmtYield,
  plClass,
  setNumbersHidden,
} from './format'
import { spreadText } from './fxText'

describe('format', () => {
  afterEach(() => setNumbersHidden(false))

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

  it('shows an amount of money exchanged whole when it is whole and with two decimals otherwise', () => {
    expect(fmtAmount('210000')).toBe('210,000')
    expect(fmtAmount('6185.4')).toBe('6,185.40')
    expect(fmtAmount('1491.2')).toBe('1,491.20')
    expect(fmtAmount('1491.204')).toBe('1,491.20')
    expect(fmtAmount('1000.001')).toBe('1,000')
    expect(fmtAmount('-34000')).toBe('−34,000')
    expect(fmtAmount('-12.5')).toBe('−12.50')
    expect(fmtAmount(null)).toBe('—')
  })

  it('marks the base currency with the baht sign or its own code', () => {
    expect(currencyMark('THB')).toBe('฿')
    expect(currencyMark('USD')).toBe('USD')
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

  it('shows months and signed percentages', () => {
    expect(fmtMonth('2025-02')).toBe('ก.พ.')
    expect(fmtMonth('2025-02', true)).toBe('ก.พ. 2025')
    expect(fmtSignedPct('11.44')).toBe('+11.4%')
    expect(fmtSignedPct('-5.71', 2)).toBe('−5.71%')
    expect(fmtSignedPct(null)).toBe('—')
    expect(fmtPct('6.6', 1)).toBe('6.6%')
    expect(fmtPct('76', 1, 1)).toBe('76.0%')
    expect(fmtPct('13.84', 1, 1)).toBe('13.8%')
    expect(fmtPct('0', 1, 1)).toBe('0.0%')
    expect(fmtPct('76', 1)).toBe('76%')
    expect(fmtYield('0.516')).toBe('0.5%')
    expect(fmtYield('3')).toBe('3.0%')
    expect(fmtYield('1.04')).toBe('1.0%')
    expect(fmtYield('0')).toBe('—')
    expect(fmtYield(null)).toBe('—')
  })

  it('hides amounts but not prices, rates or percentages', () => {
    setNumbersHidden(true)
    expect([fmtNumber('1234.5'), fmtSigned('-20'), fmtHeadline('1296100', 'THB')]).toEqual(['•••', '•••', '฿•••'])
    for (const shown of [fmtRate('33.8'), fmtPrice('512.3'), fmtSignedPct('2.5'), fmtDate('2026-10-16')]) expect(shown).not.toContain('•')
    setNumbersHidden(false)
    expect(fmtNumber('1234.5')).toBe('1,234.5')
  })

  it('hides every other money figure too and keeps the currency it was shown in', () => {
    setNumbersHidden(true)
    expect(HIDDEN_NUMBER).toBe('•••')
    expect([fmtMoney('1234.5'), fmtValue('721666.76'), fmtAmount('210000'), fmtAmount('6185.4')]).toEqual(['•••', '•••', '•••', '•••'])
    expect(fmtMoney('1234.5', 'USD')).toBe('••• USD')
    expect(fmtHeadline('1200.4', 'USD')).toBe('••• USD')
    expect(fmtHeadline('-1200.4', 'THB')).toBe('฿•••')
  })

  it('shows only the mask for a signed amount, whatever its sign', () => {
    setNumbersHidden(true)
    expect([fmtSigned('7000'), fmtSigned('-2400', 0), fmtNumber('-3')]).toEqual(['•••', '•••', '•••'])
  })

  it('keeps ratios, percentages and the dash for a missing figure while hidden', () => {
    setNumbersHidden(true)
    expect([fmtPct('6.6', 1), fmtSignedPct('11.44'), fmtSignedPct('-5.71', 2), fmtYield('3')]).toEqual(['6.6%', '+11.4%', '−5.71%', '3.0%'])
    expect([fmtNumber(null), fmtMoney(undefined, 'THB'), fmtHeadline('', 'THB'), fmtAmount(null)]).toEqual(['—', '—', '—', '—'])
  })

  it('writes a plain number the same way while hidden, for what is not an amount of money', () => {
    expect(fmtPlain('1234.567')).toBe('1,234.57')
    expect(fmtPlain('0.2515', 4)).toBe('0.2515')
    expect(fmtPlain(null)).toBe('—')
    setNumbersHidden(true)
    expect(fmtPlain('1234.567')).toBe('1,234.57')
    expect(fmtPlain('-0.5')).toBe('−0.5')
  })

  it('keeps the percentage of a spread while hidden', () => {
    setNumbersHidden(true)
    expect(spreadText(D('0.82'))).toBe('แพงกว่าตลาด 0.82%')
    expect(spreadText(D('-1.5'))).toBe('ถูกกว่าตลาด 1.5%')
    expect(spreadText(D('0.001'))).toBe('เท่าตลาด')
  })

  it('writes a ratio with two decimals', () => {
    expect(fmtRatio('2.4')).toBe('2.40')
    expect(fmtRatio('1234.5')).toBe('1,234.50')
    expect(fmtRatio(null)).toBe('—')
    setNumbersHidden(true)
    expect(fmtRatio('2.4')).toBe('2.40')
  })
})

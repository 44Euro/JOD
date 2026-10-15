import { describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { fxConvertSummary, spreadPct } from './fxConvert'

const convert = (amount: string, toAmount: string, marketRate?: string) =>
  makeTx({
    type: 'fx_convert',
    currency: 'THB',
    amount,
    toCurrency: 'USD',
    toAmount,
    marketRate,
    fxRate: '1',
    fxSource: 'same',
    instrumentId: undefined,
  })

describe('fxConvertSummary', () => {
  it('compares the rate actually paid with the market rate', () => {
    const summary = fxConvertSummary(convert('34000', '1000', '33.5'))
    expect(summary.effectiveRate.toString()).toBe('34')
    expect(summary.spreadPct?.toFixed(2)).toBe('1.49')
  })

  it('includes conversion fees in the rate actually paid', () => {
    expect(fxConvertSummary({ ...convert('33900', '1000'), fees: '100' }).effectiveRate.toString()).toBe('34')
  })

  it('leaves the spread empty when the market rate is unknown', () => {
    expect(fxConvertSummary(convert('34000', '1000')).spreadPct).toBeNull()
  })
})

describe('spreadPct', () => {
  it('measures how far a rate is from the reference', () => {
    expect(spreadPct('33.80', '33.58')?.toFixed(2)).toBe('0.66')
    expect(spreadPct('1', '0')).toBeNull()
    expect(spreadPct('1', undefined)).toBeNull()
  })
})

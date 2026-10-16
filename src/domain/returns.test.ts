import { describe, expect, it } from 'vitest'
import { priceAgeDays } from './dates'
import { D } from './decimal'
import type { InvestorFlow } from './investor'
import type { Position } from './ledger'
import { portfolioReturn, staleInstruments, xirr } from './returns'
import type { Instrument } from './types'

const at = (date: string, amount: string) => ({ date, amount: D(amount) })
const flow = (date: string, amount: string): InvestorFlow => ({ txId: date, date, accountId: 'acc-1', amountBase: D(amount) })

describe('xirr', () => {
  it('matches the worked example in the Excel documentation', () => {
    const rate = xirr([
      at('2008-01-01', '-10000'),
      at('2008-03-01', '2750'),
      at('2008-10-30', '4250'),
      at('2009-02-15', '3250'),
      at('2009-04-01', '2750'),
    ])
    expect(rate?.toFixed(4)).toBe('0.3734')
  })

  it('gives exactly 10% for 1,000 that became 1,100 after 365 days', () => {
    expect(xirr([at('2023-01-01', '-1000'), at('2024-01-01', '1100')])?.toFixed(6)).toBe('0.100000')
  })

  it('still finds the rate when almost everything was lost', () => {
    expect(xirr([at('2023-01-01', '-1000'), at('2024-01-01', '1')])?.toFixed(4)).toBe('-0.9990')
  })

  it('adds flows on the same day together and needs money both in and out', () => {
    expect(xirr([at('2023-01-01', '-500'), at('2023-01-01', '-500'), at('2024-01-01', '1100')])?.toFixed(6)).toBe('0.100000')
    expect(xirr([at('2023-01-01', '-1000'), at('2024-01-01', '-100')])).toBeNull()
  })
})

describe('portfolioReturn', () => {
  it('gives only the return since the start, weighted by how long each amount was invested, under a year', () => {
    const result = portfolioReturn([flow('2024-01-01', '100000'), flow('2024-04-01', '50000')], D(160000), '2024-07-01')
    expect(result).toMatchObject({ startDate: '2024-01-01', days: 182, annualized: false, annualPct: null })
    expect(result.sinceStartPct?.toString()).toBe('8')
  })

  it('counts a withdrawal for the part of the period the money was still invested', () => {
    const result = portfolioReturn([flow('2024-01-01', '100000'), flow('2024-04-01', '-20000')], D(90000), '2024-07-01')
    expect(result.sinceStartPct?.toFixed(2)).toBe('11.11')
  })

  it('adds the annual rate from one year of history', () => {
    const result = portfolioReturn([flow('2023-01-01', '1000')], D(1100), '2024-01-01')
    expect(result.annualized).toBe(true)
    expect(result.annualPct?.toFixed(2)).toBe('10.00')
    expect(result.sinceStartPct?.toFixed(2)).toBe('10.00')
  })

  it('reads 0% when everything happened today', () => {
    expect(portfolioReturn([flow('2024-07-01', '1000')], D(1000), '2024-07-01').sinceStartPct?.toString()).toBe('0')
  })

  it('shows nothing when more was withdrawn than invested or nothing was invested', () => {
    expect(portfolioReturn([flow('2024-01-01', '1000'), flow('2024-01-02', '-5000')], D(0), '2024-07-01').sinceStartPct).toBeNull()
    expect(portfolioReturn([], D(0), '2024-07-01')).toEqual({
      startDate: null,
      days: 0,
      annualized: false,
      annualPct: null,
      sinceStartPct: null,
    })
  })
})

describe('stale prices', () => {
  it('measures a price’s age from the local date it was typed', () => {
    const typedEarlyMorning = new Date(2024, 0, 15, 6, 0).toISOString()
    expect(priceAgeDays(typedEarlyMorning, '2024-01-15')).toBe(0)
    expect(priceAgeDays(typedEarlyMorning, '2024-01-23')).toBe(8)
    expect(priceAgeDays(undefined, '2024-01-23')).toBeNull()
  })

  it('lists held instruments whose price is more than 7 days old', () => {
    const position = (instrumentId: string) => ({ instrumentId }) as Position
    const instrument = (id: string, typed: Date): Instrument => ({
      id,
      market: 'US',
      symbol: id.split(':')[1],
      name: id,
      assetType: 'stock',
      currency: 'USD',
      lastPrice: '1',
      lastPriceAt: typed.toISOString(),
    })
    const instruments = [
      instrument('US:AAPL', new Date(2024, 0, 5, 12)),
      instrument('US:MSFT', new Date(2024, 0, 10, 12)),
      instrument('US:TSLA', new Date(2023, 11, 1, 12)),
    ]
    const stale = staleInstruments([position('US:AAPL'), position('US:MSFT')], instruments, '2024-01-15')
    expect(stale.map((i) => i.id)).toEqual(['US:AAPL'])
  })
})

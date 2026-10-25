import { describe, expect, it } from 'vitest'
import { EXTRACTION_SCHEMA, ExtractionError, normaliseDate, parseExtraction } from './extraction'

const row = {
  kind: 'buy',
  market: 'US',
  symbol: 'aapl',
  name: 'Apple',
  date: '2024-10-15',
  quantity: '10',
  price: '172.40',
  amount: null,
  fees: '1.5',
  tax: null,
  currency: 'usd',
  lastPrice: null,
  uncertain: [],
  note: '',
}

function parse(rows: unknown[], extra: object = {}) {
  return parseExtraction({ source: 'orders', rows, statedTotal: null, statedTotalCurrency: null, costIncludesFees: null, problems: [], ...extra })
}

describe('normaliseDate', () => {
  it('turns a Buddhist-era year left by the model into the Gregorian one', () => {
    expect(normaliseDate('2567-10-15')).toBe('2024-10-15')
    expect(normaliseDate('2024-10-15')).toBe('2024-10-15')
  })

  it('drops a date that is not a real day or not in the agreed shape', () => {
    expect(normaliseDate('2024-02-30')).toBeNull()
    expect(normaliseDate('15/10/2024')).toBeNull()
    expect(normaliseDate(null)).toBeNull()
  })
})

describe('parseExtraction', () => {
  it('upper-cases symbols and currencies and keeps decimals as they were read', () => {
    const [r] = parse([row]).rows
    expect([r.symbol, r.currency, r.quantity, r.price, r.fees, r.tax]).toEqual(['AAPL', 'USD', '10', '172.4', '1.5', null])
    expect(r.uncertain).toEqual([])
  })

  it('accepts thousand separators but marks a number it cannot read as uncertain instead of guessing', () => {
    const [r] = parse([{ ...row, price: '1,234.50', quantity: '1O' }]).rows
    expect(r.price).toBe('1234.5')
    expect(r.quantity).toBeNull()
    expect(r.uncertain).toEqual(['quantity'])
  })

  it('marks a date it could not use as uncertain and keeps the fields the model doubted', () => {
    const [r] = parse([{ ...row, date: '10/15/24', uncertain: ['price', 'bogus'] }]).rows
    expect(r.date).toBeNull()
    expect(r.uncertain).toEqual(['date', 'price'])
  })

  it('drops rows of a kind it does not know and an unknown market', () => {
    const rows = parse([{ ...row, kind: 'fx_convert' }, { ...row, market: 'MARS' }]).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].market).toBeNull()
  })

  it('reads the stated total and the problems, and falls back to other for an unknown source', () => {
    const result = parse([row], { source: 'tweet', statedTotal: '22,734.60', statedTotalCurrency: 'usd', problems: ['รูปถูกตัด', ''] })
    expect(result.source).toBe('other')
    expect([result.statedTotal, result.statedTotalCurrency]).toEqual(['22734.6', 'USD'])
    expect(result.problems).toEqual(['รูปถูกตัด'])
  })

  it('refuses an answer without rows', () => {
    expect(() => parseExtraction({ source: 'orders' })).toThrow(ExtractionError)
    expect(() => parseExtraction('nope')).toThrow(ExtractionError)
  })

  it('asks for every field of a row so structured output fills each one', () => {
    const item = EXTRACTION_SCHEMA.properties.rows.items
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort())
    expect([...EXTRACTION_SCHEMA.required].sort()).toEqual(Object.keys(EXTRACTION_SCHEMA.properties).sort())
  })
})

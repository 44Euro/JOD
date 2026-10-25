import { describe, expect, it } from 'vitest'
import type { Extraction, ExtractedRow } from '../ai/extraction'
import { makeTx } from '../test/fixtures'
import { buildImport, checkTotal, guessAssetType, rowProblems, toReviewRows, type BuildContext, type ReviewRow } from './importReview'

function raw(overrides: Partial<ExtractedRow> = {}): ExtractedRow {
  return {
    kind: 'opening', market: 'US', symbol: 'VOO', name: 'Vanguard S&P 500', date: null, quantity: '40', price: '455.20', amount: null,
    fees: null, tax: null, currency: 'USD', lastPrice: '512.3', uncertain: [], note: '', ...overrides,
  }
}

function extraction(rows: ExtractedRow[], extra: Partial<Extraction> = {}): Extraction {
  return { source: 'portfolio', rows, statedTotal: null, statedTotalCurrency: null, costIncludesFees: null, problems: [], ...extra }
}

const ctx = { accountId: 'acc-1', baseCurrency: 'THB', transactions: [], instruments: [] }
let seq = 0
const build = (overrides: Partial<BuildContext> = {}): BuildContext => ({
  ...ctx,
  batchId: 'b1',
  openingDate: '2026-10-16',
  openingRates: { USD: { rate: '34.12', source: 'manual' } },
  now: new Date('2026-10-25T00:00:00.000Z'),
  newId: () => `new-${++seq}`,
  ...overrides,
})

describe('toReviewRows', () => {
  it('leaves a likely repeat unticked and says which record it repeats', () => {
    const existing = makeTx({ id: 'old', instrumentId: 'US:MSFT', date: '2026-09-03' })
    const rows = toReviewRows(extraction([raw(), raw({ symbol: 'MSFT' })]), { ...ctx, transactions: [existing] })
    expect(rows.map((r) => r.include)).toEqual([true, false])
    expect(rows[1].duplicate).toBe('อาจซ้ำกับรายการซื้อ 3 ก.ย. 2026 ที่มีอยู่แล้ว')
  })

  it('does not take a record of another account or another day for a repeat', () => {
    const others = [makeTx({ accountId: 'acc-2', date: '2024-01-15', quantity: '1' }), makeTx({ date: '2024-01-16', quantity: '1' })]
    const [row] = toReviewRows(extraction([raw({ kind: 'buy', symbol: 'AAPL', date: '2024-01-15', quantity: '1', price: '100' })]), { ...ctx, transactions: others })
    expect(row.duplicate).toBe('')
    expect(toReviewRows(extraction([raw({ kind: 'buy', symbol: 'AAPL', date: '2024-01-16', quantity: '1.0' })]), { ...ctx, transactions: others })[0].duplicate).not.toBe('')
  })

  it('guesses a missing market and currency but flags both for checking', () => {
    const [row] = toReviewRows(extraction([raw({ market: null, currency: 'THB', symbol: 'PTT' }), ]), ctx)
    expect([row.market, row.currency, row.fxRate]).toEqual(['SET', 'THB', '1'])
    expect(row.uncertain).toEqual(['market'])
    const [noCurrency] = toReviewRows(extraction([raw({ currency: null })]), ctx)
    expect([noCurrency.currency, noCurrency.uncertain]).toEqual(['USD', ['currency']])
  })
})

describe('rowProblems', () => {
  const [row] = toReviewRows(extraction([raw({ kind: 'buy', date: '2026-10-01' })]), ctx)

  it('asks for a number the AI could not read and a rate for a foreign order', () => {
    expect(rowProblems({ ...row, price: '' }, 'THB')).toEqual(['ใส่ราคา', 'ใส่เรท'])
    expect(rowProblems({ ...row, fxRate: '34', date: '' }, 'THB')).toEqual(['ใส่วันที่'])
  })

  it('needs an amount for income and no symbol for interest', () => {
    const interest: ReviewRow = { ...row, kind: 'interest', symbol: '', amount: '', currency: 'THB', fxRate: '1' }
    expect(rowProblems(interest, 'THB')).toEqual(['ใส่จำนวนเงิน'])
  })
})

describe('checkTotal', () => {
  const rows = toReviewRows(extraction([raw(), raw({ symbol: 'AAPL', quantity: '15', price: '172.40' })]), ctx)

  it('matches within half a percent of the printed total and warns beyond it', () => {
    expect(checkTotal(rows, { statedTotal: '20794', statedTotalCurrency: 'USD' })).toMatchObject({ state: 'match' })
    expect(checkTotal(rows, { statedTotal: '20880', statedTotalCurrency: 'USD' })).toMatchObject({ state: 'match' })
    const off = checkTotal(rows, { statedTotal: '21000', statedTotalCurrency: 'USD' })
    expect(off.state).toBe('mismatch')
    expect(off.state !== 'none' && off.counted.toString()).toBe('20794')
    expect(checkTotal(rows, { statedTotal: null, statedTotalCurrency: null })).toEqual({ state: 'none' })
  })
})

describe('guessAssetType', () => {
  it('spots a Thai DR by the number after the symbol', () => {
    expect(guessAssetType('SET', 'AAPL80')).toBe('dr')
    expect(guessAssetType('SET', 'PTT')).toBe('stock')
    expect(guessAssetType('CRYPTO', 'BTC')).toBe('crypto')
  })
})

describe('buildImport', () => {
  it('writes holdings at the opening date and rate, with new instruments and their latest prices', () => {
    const rows = toReviewRows(extraction([raw()]), ctx)
    const built = buildImport(rows, build())
    expect(built.errors).toEqual([])
    const [tx] = built.transactions
    expect([tx.type, tx.date, tx.instrumentId, tx.quantity, tx.price, tx.fxRate, tx.fxSource, tx.importBatchId]).toEqual([
      'opening', '2026-10-16', 'US:VOO', '40', '455.2', '34.12', 'manual', 'b1',
    ])
    expect(built.instruments).toEqual([{ id: 'US:VOO', market: 'US', symbol: 'VOO', name: 'Vanguard S&P 500', assetType: 'stock', currency: 'USD' }])
    expect(built.prices).toEqual([{ id: 'US:VOO', price: '512.3' }])
  })

  it('marks an estimated opening rate as such and keeps the reference rate', () => {
    const built = buildImport(toReviewRows(extraction([raw()]), ctx), build({ openingRates: { USD: { rate: '33.58', source: 'estimated' } } }))
    expect([built.transactions[0].fxSource, built.transactions[0].referenceFxRate]).toEqual(['estimated', '33.58'])
  })

  it('skips unticked rows and refuses until every ticked row is complete', () => {
    const rows = toReviewRows(extraction([raw(), raw({ symbol: 'NVDA', price: null, uncertain: ['price'] })]), ctx)
    expect(buildImport(rows, build()).errors).toEqual(['NVDA: ใส่ทุนเฉลี่ย'])
    expect(buildImport(rows, build({ openingRates: {} })).errors).toContain('ใส่เรทเฉลี่ยตอนซื้อของ USD')
    const built = buildImport(rows.map((r) => (r.symbol === 'NVDA' ? { ...r, include: false } : r)), build())
    expect(built.transactions.map((t) => t.instrumentId)).toEqual(['US:VOO'])
  })

  it('refuses a sell the ledger would skip', () => {
    const rows = toReviewRows(extraction([raw({ kind: 'sell', symbol: 'AAPL', date: '2026-10-01', quantity: '5', price: '200' })], { source: 'orders' }), ctx)
    expect(buildImport([{ ...rows[0], fxRate: '34' }], build()).errors).toEqual(['AAPL: ขาย 5 หน่วย แต่ถืออยู่ 0 หน่วย'])
  })
})

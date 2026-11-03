import { describe, expect, it } from 'vitest'
import type { Extraction, ExtractedRow } from '../ai/extraction'
import { makeTx } from '../test/fixtures'
import { D } from '../domain/decimal'
import { buildImport, checkTotal, compareHoldings, fillFromPrices, guessAssetType, patchRow, pricedIds, priceUpdates, rowProblems, toReviewRows, type BuildContext, type ReviewRow } from './importReview'

function raw(overrides: Partial<ExtractedRow> = {}): ExtractedRow {
  return {
    kind: 'opening', market: 'US', symbol: 'VOO', name: 'Vanguard S&P 500', date: null, quantity: '40', price: '455.20', amount: null,
    fees: null, tax: null, currency: 'USD', lastPrice: '512.3', value: null, uncertain: [], note: '', ...overrides,
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

describe('toReviewRows across pictures', () => {
  const listed = (symbol: string, value: string, amount: string) => raw({ symbol, quantity: null, price: null, lastPrice: null, value, amount })

  it('keeps one holding per asset, taking the picture that shows its units', () => {
    const rows = toReviewRows(
      extraction([listed('TSM', '118.8', '119.43'), listed('AAPL', '64.74', '58.67'), raw({ symbol: 'TSM', quantity: '0.2980326', price: '400.728' }), listed('AAPL', '64.74', '58.67')]),
      ctx,
    )
    expect(rows.map((r) => [r.symbol, r.quantity, r.value])).toEqual([
      ['TSM', '0.2980326', ''],
      ['AAPL', '', '64.74'],
    ])
  })

  it('leaves an order read twice from overlapping pictures unticked', () => {
    const buy = raw({ kind: 'buy', symbol: 'AAPL', date: '2024-01-15', quantity: '1', price: '100', lastPrice: null })
    const rows = toReviewRows(extraction([buy, buy, { ...buy, quantity: '2' }]), ctx)
    expect(rows.map((r) => r.include)).toEqual([true, false, true])
    expect(rows[1].duplicate).toBe('ซ้ำกับแถวด้านบน')
  })
})

describe('fillFromPrices', () => {
  const tsm = { id: 'US:TSM', market: 'US' as const, symbol: 'TSM', name: 'TSM', assetType: 'stock' as const, currency: 'USD', lastPrice: '398.63' }
  const listed = () => toReviewRows(extraction([raw({ symbol: 'TSM', quantity: null, price: null, lastPrice: null, value: '118.8', amount: '119.43' })]), ctx)

  it('asks the market for every asset it can price', () => {
    const rows = toReviewRows(extraction([raw(), raw({ symbol: 'PTT', market: 'SET' }), raw({ symbol: 'K-INDIA', market: 'FUND' }), raw({ kind: 'interest', symbol: null })]), ctx)
    expect(pricedIds(rows)).toEqual(['US:VOO', 'SET:PTT'])
  })

  it('works out the units and average cost of a holding shown by its value, from the market price', () => {
    const [row] = fillFromPrices(listed(), [{ id: 'US:TSM', price: '398.63' }], [])
    expect([row.quantity, row.price]).toEqual(['0.29802072', '400.743948'])
    expect(row.uncertain).toEqual(expect.arrayContaining(['quantity', 'price']))
    expect(row.note).toBe('คิดจำนวนหุ้นจากมูลค่า ÷ ราคา 398.63 USD ตรวจกับแอปโบรก')
  })

  it('falls back to the price the app already has, and asks for the units when there is none', () => {
    expect(fillFromPrices(listed(), null, [tsm])[0].quantity).toBe('0.29802072')
    const [row] = fillFromPrices(listed(), null, [])
    expect([row.quantity, row.price]).toEqual(['', ''])
    expect(row.note).toBe('รูปนี้มีแต่มูลค่า 118.8 และทุนรวม 119.43 USD ใส่จำนวนหุ้นเอง หรือใส่รูปที่เปิดดูตัวนี้')
  })

  it('flags a symbol the market does not know, unless the market could not be asked', () => {
    const rows = toReviewRows(extraction([raw({ symbol: 'ARO' }), raw({ symbol: 'K-INDIA', market: 'FUND' })]), ctx)
    const [aro, fund] = fillFromPrices(rows, [], [])
    expect([aro.uncertain.includes('symbol'), aro.note]).toEqual([true, 'ไม่พบ ARO ในตลาด ตรวจสัญลักษณ์'])
    expect(fund.uncertain.includes('symbol')).toBe(false)
    expect(fillFromPrices(rows, null, [])[0].uncertain.includes('symbol')).toBe(false)
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

describe('patchRow', () => {
  const [row] = toReviewRows(extraction([raw({ kind: 'buy', date: '2026-10-01', uncertain: ['price'] })]), ctx)

  it('clears a fetched rate when the day or the currency changes, and keeps a typed one', () => {
    const fetched = { ...row, fxRate: '34', fxSource: 'auto' as const }
    expect(patchRow(fetched, { date: '2026-10-02' }, ctx)).toMatchObject({ fxRate: '', fxSource: 'auto' })
    expect(patchRow({ ...fetched, fxSource: 'manual' }, { date: '2026-10-02' }, ctx)).toMatchObject({ fxRate: '34', fxSource: 'manual' })
    expect(patchRow(fetched, { currency: 'THB' }, ctx)).toMatchObject({ fxRate: '1', fxSource: 'same' })
  })

  it('stops flagging a field once the user has edited it', () => {
    expect(patchRow(row, { price: '118.50' }, ctx).uncertain).toEqual([])
  })

  it('works out the average cost from the total when units are typed for a holding shown by its value', () => {
    const [listed] = toReviewRows(extraction([raw({ symbol: 'TSM', quantity: null, price: null, value: '118.8', amount: '119.43' })]), ctx)
    expect(patchRow(listed, { quantity: '0.2980326' }, ctx).price).toBe('400.727974')
  })
})

describe('priceUpdates', () => {
  const voo = { id: 'US:VOO', market: 'US' as const, symbol: 'VOO', name: 'VOO', assetType: 'etf' as const, currency: 'USD' }

  it('takes the latest price of known assets, matching by symbol when the market guess is off', () => {
    const rows = toReviewRows(extraction([raw({ market: 'SET' }), raw({ symbol: 'ZZZ' })]), ctx)
    const { updates, unknown } = priceUpdates(rows, [voo])
    expect(updates.map((u) => [u.instrument.id, u.price])).toEqual([['US:VOO', '512.3']])
    expect(unknown).toEqual(['ZZZ'])
  })
})

describe('compareHoldings', () => {
  const instruments = ['VOO', 'AAPL', 'TSLA'].map((s) => ({ id: `US:${s}`, market: 'US' as const, symbol: s, name: s, assetType: 'stock' as const, currency: 'USD' }))
  const positions = [
    { accountId: 'acc-1', instrumentId: 'US:VOO', quantity: D('40') },
    { accountId: 'acc-1', instrumentId: 'US:AAPL', quantity: D('10') },
    { accountId: 'acc-1', instrumentId: 'US:TSLA', quantity: D('3') },
    { accountId: 'acc-2', instrumentId: 'US:NVDA', quantity: D('5') },
  ]

  it('marks each holding as matching, differing, missing in the app or not on the screen', () => {
    const rows = toReviewRows(extraction([raw(), raw({ symbol: 'AAPL', quantity: '15' }), raw({ symbol: 'NVDA', quantity: '5' })]), ctx)
    expect(compareHoldings(rows, positions, instruments, 'acc-1').map((l) => [l.symbol, l.state])).toEqual([
      ['VOO', 'match'],
      ['AAPL', 'differ'],
      ['NVDA', 'not_in_app'],
      ['TSLA', 'not_on_screen'],
    ])
  })

  it('allows for rounding when the units were worked out from a value', () => {
    const listed = [raw({ quantity: null, price: null, value: '20480', amount: '18208' }), raw({ symbol: 'AAPL', quantity: null, price: null, value: '2775', amount: '2586' })]
    const rows = fillFromPrices(toReviewRows(extraction(listed), ctx), [{ id: 'US:VOO', price: '512.3' }, { id: 'US:AAPL', price: '185' }], instruments)
    expect(compareHoldings(rows, positions, instruments, 'acc-1').slice(0, 2).map((l) => [l.symbol, l.state, l.approx])).toEqual([
      ['VOO', 'match', true],
      ['AAPL', 'differ', true],
    ])
  })
})

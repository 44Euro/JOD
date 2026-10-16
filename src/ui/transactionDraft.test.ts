import { describe, expect, it } from 'vitest'
import type { Instrument } from '../domain/types'
import {
  applyReferenceRate,
  changeCurrency,
  changeDate,
  changeMarket,
  changeOpeningKind,
  changeType,
  draftFromTransaction,
  draftToTransaction,
  emptyDraft,
  pickSymbol,
  receivedAmount,
  syncReceived,
  totalForDisplay,
  type Draft,
} from './transactionDraft'

const ctx = { id: 'tx-1', createdAt: '2024-01-15T09:00:00.000Z', baseCurrency: 'THB', today: '2024-06-30' }

function buyDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    ...emptyDraft('acc-1', '2024-01-15'),
    symbol: 'aapl',
    quantity: '1,000',
    price: '185.5',
    fxRate: '35.1',
    fxSource: 'auto',
    fxRateDate: '2024-01-15',
    referenceFxRate: '35.1',
    ...overrides,
  }
}

describe('draftToTransaction', () => {
  it('normalizes numbers, defaults fees and builds the instrument id', () => {
    const { tx, errors } = draftToTransaction(buyDraft(), ctx)
    expect(errors).toEqual([])
    expect(tx).toMatchObject({
      instrumentId: 'US:AAPL',
      quantity: '1000',
      price: '185.5',
      fees: '0',
      tax: '0',
      fxRate: '35.1',
      fxSource: 'auto',
      fxRateDate: '2024-01-15',
    })
    expect(tx.amount).toBeUndefined()
  })

  it('uses rate 1 when the trade currency is the base currency', () => {
    const { tx } = draftToTransaction(buyDraft({ market: 'SET', symbol: 'PTT', currency: 'THB', fxRate: '' }), ctx)
    expect(tx.fxRate).toBe('1')
    expect(tx.fxSource).toBe('same')
    expect(tx.referenceFxRate).toBeUndefined()
  })

  it('reports a missing rate for a foreign currency', () => {
    const { errors } = draftToTransaction(buyDraft({ fxRate: '' }), ctx)
    expect(errors).toContain('เรทแลกเปลี่ยนต้องเป็นตัวเลขมากกว่า 0')
  })

  it('reports text typed into a number field once', () => {
    const { errors } = draftToTransaction(buyDraft({ quantity: 'สิบ' }), ctx)
    expect(errors.filter((e) => e.startsWith('จำนวนหน่วย'))).toHaveLength(1)
  })

  it('does not need a rate for a split', () => {
    const { tx, errors } = draftToTransaction(buyDraft({ type: 'split', splitRatio: '4', fxRate: '' }), ctx)
    expect(errors).toEqual([])
    expect(tx.fxRate).toBe('1')
    expect(tx.quantity).toBeUndefined()
  })

  it('records an opening holding without filling in the reference rate', () => {
    const draft = buyDraft({ type: 'opening', symbol: 'VOO', quantity: '10', price: '400', fxRate: '', referenceFxRate: '' })
    const withReference = applyReferenceRate(draft, { rate: '34.5', rateDate: '2024-01-15' })
    expect(withReference.fxRate).toBe('')
    expect(withReference.referenceFxRate).toBe('34.5')
    const { tx, errors } = draftToTransaction(withReference, ctx)
    expect(tx).toMatchObject({ type: 'opening', instrumentId: 'US:VOO', quantity: '10', price: '400' })
    expect(errors).toEqual(['เรทแลกเปลี่ยนต้องเป็นตัวเลขมากกว่า 0'])
  })

  it('records opening cash as an amount without an instrument', () => {
    const { tx, errors } = draftToTransaction(buyDraft({ type: 'opening', openingKind: 'cash', amount: '500' }), ctx)
    expect(errors).toEqual([])
    expect(tx.instrumentId).toBeUndefined()
    expect(tx.quantity).toBeUndefined()
    expect(tx.amount).toBe('500')
  })

  it('keeps the tax year only when a withdrawal is sent back to Thailand', () => {
    const remit = draftToTransaction(buyDraft({ type: 'withdraw', amount: '500', remitToThailand: true, taxYear: '2024' }), ctx)
    expect(remit.errors).toEqual([])
    expect(remit.tx).toMatchObject({ remitToThailand: true, taxYear: 2024 })
    expect(remit.tx.instrumentId).toBeUndefined()
    const plain = draftToTransaction(buyDraft({ type: 'withdraw', amount: '500', taxYear: '2024' }), ctx)
    expect(plain.tx.taxYear).toBeUndefined()
  })
})

describe('applyReferenceRate', () => {
  const quote = { rate: '35.2', rateDate: '2024-01-12' }

  it('fills an automatic rate', () => {
    expect(applyReferenceRate(buyDraft({ fxRate: '', fxSource: 'auto' }), quote)).toMatchObject({
      fxRate: '35.2',
      fxSource: 'auto',
      fxRateDate: '2024-01-12',
    })
  })

  it('keeps a rate the user typed but updates the reference', () => {
    expect(applyReferenceRate(buyDraft({ fxRate: '35.6', fxSource: 'manual' }), quote)).toMatchObject({
      fxRate: '35.6',
      fxSource: 'manual',
      referenceFxRate: '35.2',
    })
  })

  it('moves an estimated rate to the new date', () => {
    const draft = buyDraft({ type: 'opening', symbol: 'VOO', fxRate: '34', fxSource: 'estimated' })
    expect(applyReferenceRate(draft, quote)).toMatchObject({ fxRate: '35.2', fxSource: 'estimated' })
  })
})

function convertDraft(overrides: Partial<Draft> = {}): Draft {
  const converting = changeType(emptyDraft('acc-1', '2024-01-15'), 'fx_convert', 'THB')
  return { ...converting, amount: '20,000', fees: '50', marketRate: '33.5', ...overrides }
}

describe('receivedAmount', () => {
  it('takes the fee out of the amount before converting at the market rate', () => {
    expect(receivedAmount(convertDraft())).toBe('595.52')
  })

  it('counts an empty fee as zero and accepts thousands separators', () => {
    expect(receivedAmount(convertDraft({ amount: '33,500', fees: '' }))).toBe('1000')
    expect(receivedAmount(convertDraft({ amount: '20000', fees: '' }))).toBe('597.01')
  })

  it('has no value without a usable market rate, amount or fee', () => {
    expect(receivedAmount(convertDraft({ marketRate: '' }))).toBeNull()
    expect(receivedAmount(convertDraft({ marketRate: '0' }))).toBeNull()
    expect(receivedAmount(convertDraft({ amount: '' }))).toBeNull()
    expect(receivedAmount(convertDraft({ amount: '1,5' }))).toBeNull()
    expect(receivedAmount(convertDraft({ fees: 'abc' }))).toBeNull()
    expect(receivedAmount(convertDraft({ fees: '-5' }))).toBeNull()
  })

  it('has no value when the fee takes the whole amount', () => {
    expect(receivedAmount(convertDraft({ amount: '50', fees: '50' }))).toBeNull()
    expect(receivedAmount(convertDraft({ amount: '50', fees: '80' }))).toBeNull()
  })

  it('has no value for an amount too small to round to anything', () => {
    expect(receivedAmount(convertDraft({ amount: '0.1', fees: '' }))).toBeNull()
  })

  it('only applies to a conversion', () => {
    expect(receivedAmount(convertDraft({ type: 'deposit' }))).toBeNull()
  })
})

describe('syncReceived', () => {
  it('fills the received amount from the market rate', () => {
    expect(syncReceived(convertDraft())).toMatchObject({ toAmount: '595.52', toAmountSource: 'auto' })
  })

  it('recomputes when the fee changes', () => {
    const filled = syncReceived(convertDraft())
    expect(syncReceived({ ...filled, fees: '100' }).toAmount).toBe('594.03')
  })

  it('empties the field when there is no market rate or the fee is too high', () => {
    const filled = syncReceived(convertDraft())
    expect(syncReceived({ ...filled, marketRate: '' }).toAmount).toBe('')
    expect(syncReceived({ ...filled, fees: '20,000' }).toAmount).toBe('')
  })

  it('never overwrites an amount the user typed', () => {
    const typed = convertDraft({ toAmount: '590', toAmountSource: 'manual' })
    expect(syncReceived(typed)).toBe(typed)
  })

  it('leaves other types alone', () => {
    const buy = buyDraft({ toAmount: '7' })
    expect(syncReceived(buy)).toBe(buy)
  })

  it('returns the same draft when nothing changed', () => {
    const filled = syncReceived(convertDraft())
    expect(syncReceived(filled)).toBe(filled)
  })
})

describe('stale market rates', () => {
  it('drops the market rate when the date changes', () => {
    expect(changeDate(convertDraft(), '2024-01-10').marketRate).toBe('')
  })

  it('drops the market rate when the source currency changes', () => {
    expect(changeCurrency(convertDraft(), 'USD').marketRate).toBe('')
  })
})

describe('changeDate', () => {
  it('drops the automatic rate and its reference when the date moves', () => {
    const next = changeDate(buyDraft(), '2024-01-10')
    expect(next).toMatchObject({ date: '2024-01-10', fxRate: '', fxSource: 'auto', fxRateDate: '', referenceFxRate: '' })
  })

  it('keeps a rate the user typed or estimated', () => {
    expect(changeDate(buyDraft({ fxRate: '35.6', fxSource: 'manual' }), '2024-01-10')).toMatchObject({
      date: '2024-01-10',
      fxRate: '35.6',
      fxSource: 'manual',
      referenceFxRate: '',
    })
    expect(changeDate(buyDraft({ type: 'opening', fxRate: '34', fxSource: 'estimated' }), '2024-01-10')).toMatchObject({
      fxRate: '34',
      fxSource: 'estimated',
    })
  })
})

describe('draft helpers', () => {
  it('round-trips a saved transaction back into the same draft', () => {
    const draft = buyDraft({ symbol: 'AAPL', quantity: '1000', fees: '1.5', note: 'first buy' })
    const { tx } = draftToTransaction(draft, ctx)
    const instruments: Instrument[] = [
      { id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: '', assetType: 'stock', currency: 'USD' },
    ]
    expect(draftFromTransaction(tx, instruments)).toEqual({ ...draft, toAmountSource: 'manual' })
  })

  it('keeps the saved received amount when an exchange is edited', () => {
    const { tx } = draftToTransaction(convertDraft({ toAmount: '590', toAmountSource: 'manual' }), ctx)
    const edited = draftFromTransaction(tx, [])
    expect(edited).toMatchObject({ toAmount: '590', toAmountSource: 'manual' })
    expect(syncReceived(edited)).toBe(edited)
  })

  it('switches to a base-currency conversion when the type becomes fx_convert', () => {
    const next = changeType(buyDraft({ toAmount: '7', toAmountSource: 'manual' }), 'fx_convert', 'THB')
    expect(next.currency).toBe('THB')
    expect(next.toCurrency).toBe('USD')
    expect(next.fxRate).toBe('')
    expect(next).toMatchObject({ toAmount: '', toAmountSource: 'auto' })
  })

  it('leaves a conversion alone when the type is chosen again', () => {
    const converting = convertDraft({ toAmountSource: 'manual', toAmount: '590' })
    expect(changeType(converting, 'fx_convert', 'THB')).toBe(converting)
  })

  it('starts the rate over when switching to or from an opening holding', () => {
    const opening = changeType(buyDraft(), 'opening', 'THB')
    expect(opening).toMatchObject({ fxRate: '', fxSource: 'auto', referenceFxRate: '35.1' })
    expect(changeType(opening, 'buy', 'THB')).toMatchObject({ fxRate: '35.1', fxSource: 'auto' })
    expect(changeOpeningKind(opening, 'cash')).toMatchObject({ fxRate: '35.1', fxSource: 'auto' })
  })

  it('follows the market currency and clears the old rate', () => {
    const next = changeMarket(buyDraft(), 'HK')
    expect(next.currency).toBe('HKD')
    expect(next.fxRate).toBe('')
    expect(changeMarket(buyDraft(), 'CRYPTO').assetType).toBe('crypto')
  })

  it('fills currency and name from a known instrument', () => {
    const known: Instrument = { id: 'CRYPTO:BTC', market: 'CRYPTO', symbol: 'BTC', name: 'Bitcoin', assetType: 'crypto', currency: 'USDT' }
    const next = pickSymbol(buyDraft({ market: 'CRYPTO', symbol: '' }), 'btc', [known])
    expect(next.currency).toBe('USDT')
    expect(next.instrumentName).toBe('Bitcoin')
  })

  it('shows the amount a transaction moves, or the cost of an opening holding', () => {
    expect(totalForDisplay(draftToTransaction(buyDraft(), ctx).tx)?.toString()).toBe('185500')
    const opening = buyDraft({ type: 'opening', symbol: 'VOO', quantity: '10', price: '400' })
    expect(totalForDisplay(draftToTransaction(opening, ctx).tx)?.toString()).toBe('4000')
    expect(totalForDisplay(draftToTransaction(buyDraft({ type: 'split', splitRatio: '4' }), ctx).tx)).toBeNull()
  })
})

describe('looked-up names', () => {
  const ptt: Instrument = { id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'ปตท.', assetType: 'etf', currency: 'THB' }
  const voo: Instrument = { id: 'US:VOO', market: 'US', symbol: 'VOO', name: 'Vanguard S&P 500 ETF', assetType: 'etf', currency: 'USD' }
  const btc: Instrument = { id: 'CRYPTO:BTC', market: 'CRYPTO', symbol: 'BTC', name: 'Bitcoin', assetType: 'crypto', currency: 'USDT' }

  it('clears the looked-up name and asset type once the symbol stops matching', () => {
    const matched = pickSymbol(buyDraft({ market: 'SET', symbol: '', currency: 'THB', fxRate: '' }), 'PTT', [ptt])
    expect(matched).toMatchObject({ instrumentName: 'ปตท.', assetType: 'etf' })
    expect(pickSymbol(matched, 'PTTE', [ptt])).toMatchObject({ symbol: 'PTTE', instrumentName: '', assetType: 'stock' })
  })

  it('keeps a name typed for a symbol that was never looked up', () => {
    const typed = buyDraft({ market: 'SET', symbol: 'ABC', instrumentName: 'กองทุนของฉัน', assetType: 'fund' })
    expect(pickSymbol(typed, 'ABCD', [ptt])).toMatchObject({ symbol: 'ABCD', instrumentName: 'กองทุนของฉัน', assetType: 'fund' })
  })

  it('clears a name looked up in the old market when the market changes', () => {
    const looked = buyDraft({ symbol: 'VOO', instrumentName: 'Vanguard S&P 500 ETF', assetType: 'etf' })
    expect(changeMarket(looked, 'HK', [voo])).toMatchObject({ market: 'HK', currency: 'HKD', instrumentName: '', assetType: 'stock' })
  })

  it('picks up the name and currency of a symbol known in the new market', () => {
    const next = changeMarket(buyDraft({ symbol: 'btc' }), 'CRYPTO', [btc])
    expect(next).toMatchObject({ market: 'CRYPTO', instrumentName: 'Bitcoin', currency: 'USDT', assetType: 'crypto' })
  })
})

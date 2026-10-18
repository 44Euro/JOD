import { describe, expect, it } from 'vitest'
import type { Account, Instrument } from '../domain/types'
import {
  applyReferenceRate,
  changeCurrency,
  changeDate,
  changeMarket,
  changeOpeningKind,
  changeToMarket,
  changeType,
  draftFromTransaction,
  draftToTransaction,
  emptyDraft,
  feePaidInOf,
  feePaidInOptions,
  pickSymbol,
  pickToSymbol,
  receivedAfterFee,
  receivedAmount,
  syncReceived,
  totalForDisplay,
  withTransferTarget,
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
  return { ...converting, amount: '20,000', fees: '50', marketRate: '33.5', marketRateDate: '2024-01-12', ...overrides }
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
  it('drops the market rate and the day it belongs to when the date changes', () => {
    expect(changeDate(convertDraft(), '2024-01-10')).toMatchObject({ marketRate: '', marketRateDate: '' })
  })

  it('drops the market rate and the day it belongs to when the source currency changes', () => {
    expect(changeCurrency(convertDraft(), 'USD')).toMatchObject({ marketRate: '', marketRateDate: '' })
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

describe('transfers', () => {
  const account = (id: string): Account => ({ id, name: id, broker: '', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
  const transferDraft = withTransferTarget(
    changeType(emptyDraft('acc-1', '2024-06-01'), 'transfer', 'THB'),
    [account('acc-1'), account('acc-2')],
  )

  it('points a new transfer at the first other account', () => {
    const draft = changeType(emptyDraft('acc-1', '2024-06-01'), 'transfer', 'THB')
    expect(withTransferTarget(draft, [account('acc-1'), account('acc-2')]).toAccountId).toBe('acc-2')
    expect(withTransferTarget(draft, [account('acc-1')]).toAccountId).toBe('')
  })

  it('moves the target away from the sending account and keeps a valid target', () => {
    const [a1, a2, a3] = [account('acc-1'), account('acc-2'), account('acc-3')]
    expect(withTransferTarget({ ...transferDraft, accountId: 'acc-2' }, [a1, a2, a3]).toAccountId).toBe('acc-1')
    const chosen = { ...transferDraft, toAccountId: 'acc-3' }
    expect(withTransferTarget(chosen, [a1, a2, a3])).toBe(chosen)
    expect(withTransferTarget(buyDraft(), [a1, a2])).toEqual(buyDraft())
  })

  it('builds a share transfer and a cash transfer', () => {
    const shares = { ...transferDraft, symbol: 'AAPL', quantity: '4' }
    expect(draftToTransaction(shares, ctx).tx).toMatchObject({ type: 'transfer', instrumentId: 'US:AAPL', quantity: '4', toAccountId: 'acc-2' })
    const cash = { ...transferDraft, transferKind: 'cash' as const, currency: 'THB', amount: '20,000' }
    const built = draftToTransaction(cash, ctx).tx
    expect(built).toMatchObject({ instrumentId: undefined, quantity: undefined, amount: '20000', fxRate: '1', fxSource: 'same' })
  })

  it('sends no price or amount with a share transfer and no quantity with a cash transfer', () => {
    const shares = { ...transferDraft, symbol: 'AAPL', quantity: '4', price: '100', amount: '5', fxRate: '35' }
    const sent = draftToTransaction(shares, ctx)
    expect(sent.errors).toEqual([])
    expect(sent.tx.price).toBeUndefined()
    expect(sent.tx.amount).toBeUndefined()
    const cash = draftToTransaction({ ...shares, transferKind: 'cash', symbol: 'AAPL' }, ctx).tx
    expect(cash.quantity).toBeUndefined()
    expect(cash.instrumentId).toBeUndefined()
    expect(cash.amount).toBe('5')
  })

  it('asks for a receiving account when there is none', () => {
    const lonely = { ...transferDraft, toAccountId: '', symbol: 'AAPL', quantity: '4', fxRate: '35' }
    expect(draftToTransaction(lonely, ctx).errors).toEqual(['กรุณาเลือกบัญชีปลายทาง'])
  })

  it('asks for the asset, not an amount, when a share transfer has no symbol', () => {
    const noSymbol = { ...transferDraft, symbol: '', quantity: '4', fxRate: '35' }
    expect(draftToTransaction(noSymbol, ctx).errors).toEqual(['กรุณาระบุหุ้น/สินทรัพย์'])
    expect(draftToTransaction({ ...noSymbol, quantity: '' }, ctx).errors).toEqual([
      'กรุณาระบุหุ้น/สินทรัพย์',
      'จำนวนหน่วยต้องเป็นตัวเลขมากกว่า 0',
    ])
    const cash = { ...noSymbol, transferKind: 'cash' as const, currency: 'THB' }
    expect(draftToTransaction(cash, ctx).errors).toEqual(['จำนวนเงินต้องเป็นตัวเลขมากกว่า 0'])
  })

  it('reads a saved transfer back with its kind and receiving account', () => {
    const shares = draftToTransaction({ ...transferDraft, symbol: 'AAPL', quantity: '4', fxRate: '35' }, ctx).tx
    expect(draftFromTransaction(shares, [])).toMatchObject({ type: 'transfer', transferKind: 'asset', toAccountId: 'acc-2', symbol: 'AAPL' })
    const cash = draftToTransaction({ ...transferDraft, transferKind: 'cash', currency: 'THB', amount: '20,000' }, ctx).tx
    expect(draftFromTransaction(cash, [])).toMatchObject({ transferKind: 'cash', toAccountId: 'acc-2', amount: '20000' })
  })

  it('shows no total for a share transfer and the amount for a cash transfer', () => {
    const shares = draftToTransaction({ ...transferDraft, symbol: 'AAPL', quantity: '4', fees: '5', fxRate: '35' }, ctx).tx
    expect(totalForDisplay(shares)).toBeNull()
    const cash = draftToTransaction({ ...transferDraft, transferKind: 'cash', currency: 'THB', amount: '20,000', fees: '25' }, ctx).tx
    expect(totalForDisplay(cash)?.toString()).toBe('20000')
  })
})

describe('swaps', () => {
  const btc: Instrument = { id: 'CRYPTO:BTC', market: 'CRYPTO', symbol: 'BTC', name: 'Bitcoin', assetType: 'crypto', currency: 'USD' }
  const eth: Instrument = { id: 'CRYPTO:ETH', market: 'CRYPTO', symbol: 'ETH', name: 'Ethereum', assetType: 'crypto', currency: 'USDT' }
  const swapDraft = (overrides: Partial<Draft> = {}): Draft => ({
    ...changeType(buyDraft({ market: 'CRYPTO', symbol: 'btc', currency: 'USD', assetType: 'crypto' }), 'swap', 'THB'),
    quantity: '0.01',
    toSymbol: 'eth',
    toQuantity: '0.25',
    amount: '660',
    ...overrides,
  })

  it('starts the coin received in the market of the coin given up and clears what was typed for it', () => {
    const next = changeType(
      buyDraft({ market: 'CRYPTO', toMarket: 'HK', toSymbol: 'old', toQuantity: '3', toInstrumentName: 'Old', toAssetType: 'fund' }),
      'swap',
      'THB',
    )
    expect(next).toMatchObject({ type: 'swap', toMarket: 'CRYPTO', toSymbol: '', toQuantity: '', toInstrumentName: '', toAssetType: 'crypto' })
  })

  it('starts a swap on crypto in both markets, in the crypto currency, with the rate started over', () => {
    const from = buyDraft({ market: 'SET', symbol: 'ptt', instrumentName: 'ปตท.', assetType: 'etf', currency: 'THB', fxRate: '', fxSource: 'auto' })
    expect(changeType(from, 'swap', 'THB')).toMatchObject({
      market: 'CRYPTO',
      toMarket: 'CRYPTO',
      assetType: 'crypto',
      toAssetType: 'crypto',
      currency: 'USD',
      fxRate: '',
      fxSource: 'auto',
      referenceFxRate: '',
      symbol: '',
      instrumentName: '',
    })
    const priced = changeType(buyDraft({ market: 'HK', currency: 'HKD', fxRate: '4.5' }), 'swap', 'THB')
    expect(priced).toMatchObject({ currency: 'USD', fxRate: '', referenceFxRate: '' })
  })

  it('keeps the symbol, currency and rate of a draft that is already on crypto', () => {
    const onCrypto = buyDraft({ market: 'CRYPTO', symbol: 'btc', assetType: 'crypto', currency: 'USD' })
    expect(changeType(onCrypto, 'swap', 'THB')).toMatchObject({
      market: 'CRYPTO',
      toMarket: 'CRYPTO',
      symbol: 'btc',
      currency: 'USD',
      fxRate: '35.1',
    })
  })

  it('leaves a swap alone when the type is chosen again', () => {
    const swapping = swapDraft()
    expect(changeType(swapping, 'swap', 'THB')).toBe(swapping)
  })

  it('builds a swap with both instruments, both quantities and the total value but no price', () => {
    const { tx, errors } = draftToTransaction(swapDraft({ price: '5', fees: '1.5' }), ctx)
    expect(errors).toEqual([])
    expect(tx).toMatchObject({
      type: 'swap',
      instrumentId: 'CRYPTO:BTC',
      quantity: '0.01',
      toInstrumentId: 'CRYPTO:ETH',
      toQuantity: '0.25',
      amount: '660',
      currency: 'USD',
      fees: '1.5',
      fxRate: '35.1',
    })
    expect(tx.price).toBeUndefined()
  })

  it('sends the coin received only with a swap', () => {
    const { tx } = draftToTransaction({ ...swapDraft(), type: 'buy' }, ctx)
    expect(tx.toInstrumentId).toBeUndefined()
    expect(tx.toQuantity).toBeUndefined()
  })

  it('needs no exchange rate when the swap is valued in the base currency', () => {
    const { tx, errors } = draftToTransaction(swapDraft({ currency: 'THB', fxRate: '' }), ctx)
    expect(errors).toEqual([])
    expect(tx).toMatchObject({ fxRate: '1', fxSource: 'same' })
  })

  it('asks for each missing part of a swap once', () => {
    const { errors } = draftToTransaction(swapDraft({ symbol: '', toSymbol: ' ', quantity: '', toQuantity: '', amount: '' }), ctx)
    expect(errors).toEqual([
      'กรุณาระบุสินทรัพย์ที่แลกออก',
      'กรุณาระบุสินทรัพย์ที่ได้รับ',
      'จำนวนที่แลกออกต้องเป็นตัวเลขมากกว่า 0',
      'จำนวนที่ได้รับต้องเป็นตัวเลขมากกว่า 0',
      'มูลค่ารวมต้องเป็นตัวเลขมากกว่า 0',
    ])
  })

  it('refuses a swap into the same instrument', () => {
    expect(draftToTransaction(swapDraft({ toSymbol: 'BTC' }), ctx).errors).toEqual(['สินทรัพย์ที่ได้รับต้องต่างจากที่แลกออก'])
  })

  it('picks the name and type of the coin received without touching the currency of the swap', () => {
    const next = pickToSymbol(swapDraft({ toSymbol: '' }), 'eth', [btc, eth])
    expect(next).toMatchObject({ toSymbol: 'eth', toInstrumentName: 'Ethereum', toAssetType: 'crypto', currency: 'USD', symbol: 'btc' })
    expect(next.fxRate).toBe(swapDraft().fxRate)
  })

  it('clears a looked-up name once the symbol received stops matching', () => {
    const matched = pickToSymbol(swapDraft({ toSymbol: '' }), 'eth', [eth])
    expect(pickToSymbol(matched, 'ethx', [eth])).toMatchObject({ toSymbol: 'ethx', toInstrumentName: '', toAssetType: 'crypto' })
  })

  it('moves the market of the coin received without changing the currency or the coin given up', () => {
    const next = changeToMarket(swapDraft({ toMarket: 'CRYPTO', toSymbol: 'abc' }), 'HK')
    expect(next).toMatchObject({ toMarket: 'HK', toSymbol: 'abc', toAssetType: 'stock', market: 'CRYPTO', currency: 'USD', symbol: 'btc' })
    expect(next.fxRate).toBe(swapDraft().fxRate)
    expect(changeToMarket(swapDraft({ toMarket: 'US', toAssetType: 'stock' }), 'CRYPTO').toAssetType).toBe('crypto')
  })

  it('looks the coin received up again in its new market', () => {
    const next = changeToMarket(swapDraft({ toMarket: 'US', toSymbol: 'eth' }), 'CRYPTO', [eth])
    expect(next).toMatchObject({ toMarket: 'CRYPTO', toInstrumentName: 'Ethereum', currency: 'USD' })
  })

  it('reads a saved swap back with both instruments', () => {
    const { tx } = draftToTransaction(swapDraft({ fees: '1.5' }), ctx)
    const read = draftFromTransaction(tx, [btc, eth])
    expect(read).toMatchObject({
      type: 'swap',
      market: 'CRYPTO',
      symbol: 'BTC',
      instrumentName: 'Bitcoin',
      quantity: '0.01',
      toMarket: 'CRYPTO',
      toSymbol: 'ETH',
      toInstrumentName: 'Ethereum',
      toAssetType: 'crypto',
      toQuantity: '0.25',
      amount: '660',
    })
    expect(draftFromTransaction(tx, []).toSymbol).toBe('ETH')
  })

  it('shows the total value of a swap, not its fees', () => {
    const { tx } = draftToTransaction(swapDraft({ fees: '1.5' }), ctx)
    expect(totalForDisplay(tx)?.toString()).toBe('660')
  })
})

describe('assets received as income', () => {
  const sol: Instrument = { id: 'CRYPTO:SOL', market: 'CRYPTO', symbol: 'SOL', name: 'Solana', assetType: 'crypto', currency: 'USD' }
  const receiveDraft = (overrides: Partial<Draft> = {}): Draft => ({
    ...changeType(buyDraft({ market: 'CRYPTO', symbol: 'sol', currency: 'USD', assetType: 'crypto' }), 'receive_asset', 'THB'),
    quantity: '0.5',
    price: '150',
    ...overrides,
  })

  it('starts on staking for a coin and on stock dividend for anything else', () => {
    expect(receiveDraft().receiveKind).toBe('staking')
    expect(changeType(buyDraft(), 'receive_asset', 'THB').receiveKind).toBe('stock_dividend')
    expect(changeType(buyDraft({ market: 'SET' }), 'receive_asset', 'THB').receiveKind).toBe('stock_dividend')
  })

  it('keeps the kind the user picked when the type is chosen again', () => {
    expect(changeType(receiveDraft({ receiveKind: 'airdrop' }), 'receive_asset', 'THB').receiveKind).toBe('airdrop')
  })

  it('moves the kind with the market only while it is still the default of the old market', () => {
    const typeFirst = changeType(buyDraft(), 'receive_asset', 'THB')
    expect(changeMarket(typeFirst, 'CRYPTO').receiveKind).toBe('staking')
    expect(changeMarket(receiveDraft(), 'SET').receiveKind).toBe('stock_dividend')
    expect(changeMarket(receiveDraft({ receiveKind: 'airdrop' }), 'SET').receiveKind).toBe('airdrop')
    expect(changeMarket(buyDraft(), 'CRYPTO').receiveKind).toBe('stock_dividend')
  })

  it('builds the quantity, the value on the day, the tax and the kind but no amount', () => {
    const { tx, errors } = draftToTransaction(receiveDraft({ tax: '1', fees: '2', amount: '99' }), ctx)
    expect(errors).toEqual([])
    expect(tx).toMatchObject({
      type: 'receive_asset',
      receiveKind: 'staking',
      instrumentId: 'CRYPTO:SOL',
      quantity: '0.5',
      price: '150',
      tax: '1',
      fees: '0',
      currency: 'USD',
      fxRate: '35.1',
    })
    expect(tx.amount).toBeUndefined()
  })

  it('sends the kind only with an asset received', () => {
    expect(draftToTransaction({ ...receiveDraft(), type: 'buy' }, ctx).tx.receiveKind).toBeUndefined()
  })

  it('accepts a value of zero and asks for each other missing part once', () => {
    expect(draftToTransaction(receiveDraft({ price: '0' }), ctx).errors).toEqual([])
    expect(draftToTransaction(receiveDraft({ symbol: '', quantity: '', price: '' }), ctx).errors).toEqual([
      'กรุณาระบุหุ้น/สินทรัพย์',
      'จำนวนที่ได้รับต้องเป็นตัวเลขมากกว่า 0',
      'มูลค่าต่อหน่วยต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป',
    ])
  })

  it('shows quantity times the value on the day as the total, without the tax', () => {
    const { tx } = draftToTransaction(receiveDraft({ tax: '1' }), ctx)
    expect(totalForDisplay(tx)?.toString()).toBe('75')
  })

  it('reads a saved asset received back with its kind', () => {
    const { tx } = draftToTransaction(receiveDraft({ receiveKind: 'coin_interest', tax: '1' }), ctx)
    expect(draftFromTransaction(tx, [sol])).toMatchObject({
      type: 'receive_asset',
      receiveKind: 'coin_interest',
      market: 'CRYPTO',
      symbol: 'SOL',
      quantity: '0.5',
      price: '150',
      tax: '1',
    })
  })
})

describe('what a fee is paid in', () => {
  const bnb: Instrument = { id: 'CRYPTO:BNB', market: 'CRYPTO', symbol: 'BNB', name: 'BNB', assetType: 'crypto', currency: 'USD' }
  const ethDraft = (overrides: Partial<Draft> = {}): Draft =>
    buyDraft({ market: 'CRYPTO', symbol: 'eth', currency: 'USD', assetType: 'crypto', quantity: '1', price: '2000', ...overrides })
  const account = (id: string) => ({ id, name: id, broker: '', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
  const transferDraft = (overrides: Partial<Draft> = {}): Draft => ({
    ...withTransferTarget(changeType(emptyDraft('acc-1', '2024-06-01'), 'transfer', 'THB'), [account('acc-1'), account('acc-2')]),
    symbol: 'AAPL',
    quantity: '4',
    fxRate: '35',
    ...overrides,
  })

  it('starts on cash with the fee asset empty on crypto', () => {
    expect(emptyDraft('acc-1', '2024-06-01')).toMatchObject({ feePaidIn: 'cash', feeMarket: 'CRYPTO', feeSymbol: '', feeQuantity: '' })
  })

  it('offers each type only the ways that make sense for it', () => {
    const offered = (draft: Draft) => feePaidInOptions(draft)
    expect(offered(buyDraft())).toEqual(['cash', 'received', 'asset'])
    expect(offered(buyDraft({ type: 'sell' }))).toEqual(['cash', 'asset'])
    expect(offered(buyDraft({ type: 'swap' }))).toEqual(['cash', 'received', 'asset'])
    expect(offered(transferDraft())).toEqual(['cash', 'received'])
    expect(offered(transferDraft({ transferKind: 'cash' }))).toEqual(['cash'])
    for (const type of ['dividend', 'interest', 'deposit', 'withdraw', 'fx_convert', 'fee', 'opening', 'split', 'receive_asset'] as const) {
      expect(offered(buyDraft({ type }))).toEqual(['cash'])
    }
  })

  it('falls back to cash for a way that the draft no longer offers', () => {
    expect(feePaidInOf(buyDraft({ feePaidIn: 'asset' }))).toBe('asset')
    expect(feePaidInOf(buyDraft({ type: 'sell', feePaidIn: 'received' }))).toBe('cash')
    expect(feePaidInOf(transferDraft({ transferKind: 'cash', feePaidIn: 'received' }))).toBe('cash')
  })

  it('goes back to cash, and forgets the units, when the new type cannot pay that way', () => {
    const received = buyDraft({ feePaidIn: 'received', feeQuantity: '0.001' })
    expect(changeType(received, 'sell', 'THB')).toMatchObject({ type: 'sell', feePaidIn: 'cash', feeQuantity: '' })
    expect(changeType(received, 'transfer', 'THB')).toMatchObject({ feePaidIn: 'received', feeQuantity: '0.001' })
    expect(changeType(received, 'dividend', 'THB')).toMatchObject({ feePaidIn: 'cash', feeQuantity: '' })
    const asset = buyDraft({ feePaidIn: 'asset', feeSymbol: 'bnb', feeQuantity: '0.001' })
    expect(changeType(asset, 'sell', 'THB')).toMatchObject({ feePaidIn: 'asset', feeSymbol: 'bnb', feeQuantity: '0.001' })
    expect(changeType(asset, 'transfer', 'THB')).toMatchObject({ feePaidIn: 'cash', feeQuantity: '' })
  })

  it('keeps the very same draft when the type is chosen again and nothing needs to change', () => {
    const swapping = changeType(buyDraft({ feePaidIn: 'asset' }), 'swap', 'THB')
    expect(changeType(swapping, 'swap', 'THB')).toBe(swapping)
  })

  it('sends nothing about the fee when it is paid in cash, whatever was typed for the other ways', () => {
    const { tx, errors } = draftToTransaction(ethDraft({ fees: '2', feeQuantity: '0.001', feeSymbol: 'bnb' }), ctx)
    expect(errors).toEqual([])
    expect(tx).toMatchObject({ fees: '2' })
    expect(tx.feePaidIn).toBeUndefined()
    expect(tx.feeInstrumentId).toBeUndefined()
    expect(tx.feeQuantity).toBeUndefined()
  })

  it('builds a fee taken from the coins received with no money fee, whatever was typed in the fee field', () => {
    const { tx, errors } = draftToTransaction(ethDraft({ feePaidIn: 'received', feeQuantity: '0.001', fees: '5', feeSymbol: 'bnb' }), ctx)
    expect(errors).toEqual([])
    expect(tx).toMatchObject({ feePaidIn: 'received', feeQuantity: '0.001', fees: '0' })
    expect(tx.feeInstrumentId).toBeUndefined()
  })

  it('builds a fee paid in another asset with the asset, the units and what they are worth', () => {
    const { tx, errors } = draftToTransaction(
      ethDraft({ feePaidIn: 'asset', feeMarket: 'CRYPTO', feeSymbol: ' bnb ', feeQuantity: '0.001', fees: '0.6' }),
      ctx,
    )
    expect(errors).toEqual([])
    expect(tx).toMatchObject({ feePaidIn: 'asset', feeInstrumentId: 'CRYPTO:BNB', feeQuantity: '0.001', fees: '0.6' })
  })

  it('takes the fee asset from its own market, not the market of the transaction', () => {
    const { tx } = draftToTransaction(buyDraft({ feePaidIn: 'asset', feeMarket: 'SET', feeSymbol: 'ptt', feeQuantity: '1', fees: '30' }), ctx)
    expect(tx.feeInstrumentId).toBe('SET:PTT')
  })

  it('takes the fee of a sell from another asset but never from the units received, which a sell has none of', () => {
    const sell = ethDraft({ type: 'sell', feePaidIn: 'received', feeQuantity: '0.001', fees: '1' })
    const { tx, errors } = draftToTransaction(sell, ctx)
    expect(errors).toEqual([])
    expect(tx.feePaidIn).toBeUndefined()
    expect(tx.fees).toBe('1')
  })

  it('takes the fee of a transfer of units from the units that arrive, and ignores it for cash', () => {
    const units = draftToTransaction(transferDraft({ feePaidIn: 'received', feeQuantity: '0.1', fees: '3' }), ctx)
    expect(units.errors).toEqual([])
    expect(units.tx).toMatchObject({ feePaidIn: 'received', feeQuantity: '0.1', fees: '0' })
    const cash = draftToTransaction(transferDraft({ transferKind: 'cash', currency: 'THB', amount: '100', feePaidIn: 'received', feeQuantity: '0.1', fees: '3' }), ctx)
    expect(cash.errors).toEqual([])
    expect(cash.tx.feePaidIn).toBeUndefined()
    expect(cash.tx.fees).toBe('3')
  })

  it('asks for each missing part of the fee once', () => {
    expect(draftToTransaction(ethDraft({ feePaidIn: 'received', feeQuantity: '' }), ctx).errors).toEqual([
      'จำนวนที่ถูกหักต้องเป็นตัวเลขมากกว่า 0',
    ])
    expect(draftToTransaction(ethDraft({ feePaidIn: 'received', feeQuantity: '1' }), ctx).errors).toEqual([
      'ค่าธรรมเนียมต้องน้อยกว่าจำนวนที่ได้รับ',
    ])
    expect(draftToTransaction(ethDraft({ feePaidIn: 'asset' }), ctx).errors).toEqual([
      'กรุณาระบุสินทรัพย์ที่ใช้จ่ายค่าธรรมเนียม',
      'จำนวนที่จ่ายค่าธรรมเนียมต้องเป็นตัวเลขมากกว่า 0',
      'มูลค่าค่าธรรมเนียมต้องเป็นตัวเลขมากกว่า 0',
    ])
  })

  it('refuses to pay the fee with the asset that is being traded', () => {
    const draft = ethDraft({ feePaidIn: 'asset', feeSymbol: 'ETH', feeQuantity: '0.001', fees: '2' })
    expect(draftToTransaction(draft, ctx).errors).toEqual(['สินทรัพย์ที่จ่ายค่าธรรมเนียมต้องต่างจากสินทรัพย์ของรายการ'])
  })

  it('reads a saved fee back into the draft, ways of paying and all', () => {
    const received = draftToTransaction(ethDraft({ feePaidIn: 'received', feeQuantity: '0.001' }), ctx).tx
    expect(draftFromTransaction(received, [])).toMatchObject({ feePaidIn: 'received', feeQuantity: '0.001', feeSymbol: '', fees: '' })
    const paid = draftToTransaction(ethDraft({ feePaidIn: 'asset', feeSymbol: 'bnb', feeQuantity: '0.001', fees: '0.6' }), ctx).tx
    expect(draftFromTransaction(paid, [bnb])).toMatchObject({
      feePaidIn: 'asset',
      feeMarket: 'CRYPTO',
      feeSymbol: 'BNB',
      feeQuantity: '0.001',
      fees: '0.6',
    })
    const other = draftToTransaction(buyDraft({ feePaidIn: 'asset', feeMarket: 'SET', feeSymbol: 'ptt', feeQuantity: '1', fees: '30' }), ctx).tx
    expect(draftFromTransaction(other, [])).toMatchObject({ feeMarket: 'SET', feeSymbol: 'PTT' })
  })

  it('reads a transaction paid in cash back as cash with nothing typed for the fee asset', () => {
    const { tx } = draftToTransaction(buyDraft({ fees: '2' }), ctx)
    expect(draftFromTransaction(tx, [])).toMatchObject({ feePaidIn: 'cash', feeMarket: 'CRYPTO', feeSymbol: '', feeQuantity: '' })
  })

  describe('receivedAfterFee', () => {
    const received = (overrides: Partial<Draft> = {}) => ethDraft({ feePaidIn: 'received', feeQuantity: '0.001', ...overrides })

    it('takes the units from a buy, a transfer of units and the coin received by a swap', () => {
      expect(receivedAfterFee(received())).toBe('0.999')
      expect(receivedAfterFee(transferDraft({ feePaidIn: 'received', feeQuantity: '0.5' }))).toBe('3.5')
      const swap = changeType(received({ quantity: '0.01' }), 'swap', 'THB')
      expect(receivedAfterFee({ ...swap, feePaidIn: 'received', toQuantity: '0.25', feeQuantity: '0.0025' })).toBe('0.2475')
    })

    it('accepts thousands separators', () => {
      expect(receivedAfterFee(received({ quantity: '1,000', feeQuantity: '0.5' }))).toBe('999.5')
    })

    it('has nothing to show unless the fee is taken from the units received and is smaller than them', () => {
      expect(receivedAfterFee(received({ feePaidIn: 'cash' }))).toBeNull()
      expect(receivedAfterFee(received({ feePaidIn: 'asset' }))).toBeNull()
      expect(receivedAfterFee(received({ feeQuantity: '' }))).toBeNull()
      expect(receivedAfterFee(received({ feeQuantity: '0' }))).toBeNull()
      expect(receivedAfterFee(received({ feeQuantity: '1' }))).toBeNull()
      expect(receivedAfterFee(received({ quantity: '' }))).toBeNull()
      expect(receivedAfterFee(received({ feeQuantity: 'abc' }))).toBeNull()
    })
  })
})

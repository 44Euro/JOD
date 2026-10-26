import { describe, expect, it } from 'vitest'
import type { Account, FeeTemplate, Instrument, TradeJournal } from '../domain/types'
import { makeTx } from '../test/fixtures'
import {
  applyReferenceRate,
  changeAssetType,
  changeCurrency,
  changeDate,
  changeMarket,
  changeOpeningKind,
  changeToAssetType,
  changeToMarket,
  changeType,
  draftFromTransaction,
  draftToTransaction,
  duplicateDraft,
  emptyDraft,
  emptyJournalDraft,
  feePaidInOf,
  feePaidInOptions,
  journalFromDraft,
  journalToDraft,
  knownStrategies,
  movesNoMoney,
  pickSymbol,
  pickToSymbol,
  receivedAfterFee,
  receivedAmount,
  reinvestTransaction,
  showsFeePaidIn,
  syncFees,
  syncReceived,
  templateFee,
  totalForDisplay,
  withTransferTarget,
  type Draft,
} from './transactionDraft'

const ctx = { id: 'tx-1', createdAt: '2024-01-15T09:00:00.000Z', baseCurrency: 'THB', today: '2024-06-30', instruments: [] }

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

  describe('the symbol of an instrument that is new', () => {
    const symbolError = 'สัญลักษณ์ห้ามมีช่องว่างหรือเครื่องหมาย :'

    it('refuses a colon or a space, which a rename would refuse too', () => {
      expect(draftToTransaction(buyDraft({ symbol: 'A:B' }), ctx).errors).toEqual([symbolError])
      expect(draftToTransaction(buyDraft({ symbol: 'A B' }), ctx).errors).toEqual([symbolError])
    })

    it('says nothing of the symbol of an instrument that is already known, or of a symbol that is simply missing', () => {
      const odd: Instrument = { id: 'US:A B', market: 'US', symbol: 'A B', name: 'Odd', assetType: 'stock', currency: 'USD' }
      expect(draftToTransaction(buyDraft({ symbol: 'A B' }), { ...ctx, instruments: [odd] }).errors).toEqual([])
      expect(draftToTransaction(buyDraft({ symbol: '' }), ctx).errors).toEqual(['กรุณาระบุหุ้น/สินทรัพย์'])
    })

    it('checks the coin received in a swap too, and says so once when both are wrong', () => {
      const swapping = changeType(buyDraft({ market: 'CRYPTO', symbol: 'a:b', currency: 'USD', assetType: 'crypto' }), 'swap', 'THB')
      const draft = { ...swapping, quantity: '1', toSymbol: 'c d', toQuantity: '2', amount: '10' }
      expect(draftToTransaction(draft, ctx).errors).toEqual([symbolError])
      expect(draftToTransaction({ ...draft, symbol: 'btc' }, ctx).errors).toEqual([symbolError])
    })
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

  it('marks a rate borrowed from another currency as an estimate', () => {
    expect(applyReferenceRate(buyDraft({ fxRate: '', fxSource: 'auto' }), quote, true)).toMatchObject({
      fxRate: '35.2',
      fxSource: 'estimated',
      fxRateDate: '2024-01-12',
    })
  })

  it('keeps a typed rate typed when the reference is a borrowed one', () => {
    expect(applyReferenceRate(buyDraft({ fxRate: '35.6', fxSource: 'manual' }), quote, true)).toMatchObject({
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

  it('drops a rate borrowed from the dollar when the date moves', () => {
    expect(changeDate(buyDraft({ currency: 'USDT', fxRate: '33.5', fxSource: 'estimated' }), '2024-01-10')).toMatchObject({
      fxRate: '',
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
    expect(draftFromTransaction(tx, instruments)).toEqual({ ...draft, toAmountSource: 'manual', feesSource: 'manual' })
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

  it('starts gold in baht, as gold counted in baht-weight', () => {
    expect(changeMarket(buyDraft(), 'GOLD')).toMatchObject({ market: 'GOLD', currency: 'THB', assetType: 'gold', unit: 'baht_gold' })
  })

  it('starts a bond or a fund as units, in baht', () => {
    expect(changeMarket(buyDraft(), 'BOND')).toMatchObject({ currency: 'THB', assetType: 'bond', unit: 'unit' })
    expect(changeMarket(buyDraft(), 'FUND')).toMatchObject({ currency: 'THB', assetType: 'fund', unit: 'unit' })
  })

  it('goes back to a stock counted in shares when leaving a market that fixes the type', () => {
    const gold = changeMarket(buyDraft(), 'GOLD')
    expect(changeMarket(gold, 'US')).toMatchObject({ market: 'US', currency: 'USD', assetType: 'stock', unit: 'share' })
    expect(changeMarket(changeMarket(buyDraft(), 'CRYPTO'), 'SET')).toMatchObject({ assetType: 'stock', unit: 'share' })
    expect(changeMarket(changeMarket(buyDraft(), 'FUND'), 'SET')).toMatchObject({ assetType: 'stock', unit: 'share' })
  })

  it('keeps an ETF or a DR picked by hand while the market moves between stock markets', () => {
    const etf = changeAssetType(buyDraft(), 'etf')
    expect(changeMarket(etf, 'SET')).toMatchObject({ assetType: 'etf', unit: 'unit' })
    const dr = changeAssetType(buyDraft({ market: 'SET' }), 'dr')
    expect(changeMarket(dr, 'US')).toMatchObject({ assetType: 'dr', unit: 'share' })
  })

  it('keeps a crypto type picked by hand on a stock market when the market moves to another one', () => {
    const picked = changeAssetType(buyDraft(), 'crypto')
    expect(picked).toMatchObject({ market: 'US', assetType: 'crypto', unit: 'coin' })
    expect(changeMarket(picked, 'SET')).toMatchObject({ market: 'SET', assetType: 'crypto', unit: 'coin' })
  })

  it('puts the unit back to the default of a type when the type changes', () => {
    const gram = { ...changeMarket(buyDraft(), 'GOLD'), unit: 'gram' as const }
    expect(changeAssetType(gram, 'gold')).toMatchObject({ assetType: 'gold', unit: 'baht_gold' })
    expect(changeAssetType(gram, 'fund')).toMatchObject({ assetType: 'fund', unit: 'unit' })
    expect(changeAssetType(buyDraft(), 'crypto')).toMatchObject({ assetType: 'crypto', unit: 'coin' })
  })

  it('does the same for the coin received in a swap without touching the coin given up', () => {
    const next = changeToAssetType(buyDraft({ unit: 'gram' }), 'gold')
    expect(next).toMatchObject({ toAssetType: 'gold', toUnit: 'baht_gold', assetType: 'stock', unit: 'gram' })
  })

  it('fills currency and name from a known instrument', () => {
    const known: Instrument = { id: 'CRYPTO:BTC', market: 'CRYPTO', symbol: 'BTC', name: 'Bitcoin', assetType: 'crypto', currency: 'USDT' }
    const next = pickSymbol(buyDraft({ market: 'CRYPTO', symbol: '' }), 'btc', [known])
    expect(next.currency).toBe('USDT')
    expect(next.instrumentName).toBe('Bitcoin')
  })

  describe('when the account already holds the coin', () => {
    const eth: Instrument = { id: 'CRYPTO:ETH', market: 'CRYPTO', symbol: 'ETH', name: 'Ethereum', assetType: 'crypto', currency: 'THB' }
    const heldIn = (accountId: string, currency: string) => [{ accountId, instrumentId: 'CRYPTO:ETH', currency }]
    const blank = () => buyDraft({ market: 'CRYPTO', symbol: '', accountId: 'binance', currency: 'USD' })

    it('takes the currency it is held in over the one stored for the instrument', () => {
      expect(pickSymbol(blank(), 'eth', [eth], heldIn('binance', 'USD')).currency).toBe('USD')
    })

    it('still takes the stored currency when only another account, or nothing, holds it', () => {
      expect(pickSymbol(blank(), 'eth', [eth], heldIn('bitkub', 'USD')).currency).toBe('THB')
      expect(pickSymbol(blank(), 'eth', [eth]).currency).toBe('THB')
    })

    it('keeps it through a change of market that lands on the same symbol', () => {
      const typed = buyDraft({ market: 'US', symbol: 'eth', accountId: 'binance', currency: 'USD' })
      expect(changeMarket(typed, 'CRYPTO', [eth], heldIn('binance', 'USD')).currency).toBe('USD')
    })
  })

  it('round-trips the unit of the instrument and falls back to the one of its type', () => {
    const gold: Instrument = {
      id: 'GOLD:96.5',
      market: 'GOLD',
      symbol: '96.5',
      name: 'ทอง 96.5%',
      assetType: 'gold',
      currency: 'THB',
      unit: 'gram',
    }
    const { tx } = draftToTransaction(buyDraft({ market: 'GOLD', symbol: '96.5', currency: 'THB', unit: 'gram', assetType: 'gold' }), ctx)
    expect(draftFromTransaction(tx, [gold])).toMatchObject({ assetType: 'gold', unit: 'gram' })
    expect(draftFromTransaction(tx, [{ ...gold, unit: undefined }])).toMatchObject({ assetType: 'gold', unit: 'baht_gold' })
    expect(draftFromTransaction(tx, [])).toMatchObject({ assetType: 'stock', unit: 'share' })
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

describe('units of looked-up instruments', () => {
  const gold: Instrument = {
    id: 'GOLD:96.5',
    market: 'GOLD',
    symbol: '96.5',
    name: 'ทอง 96.5%',
    assetType: 'gold',
    currency: 'THB',
    unit: 'gram',
  }
  const fund: Instrument = { id: 'FUND:SCBS&P500', market: 'FUND', symbol: 'SCBS&P500', name: 'SCB S&P500', assetType: 'fund', currency: 'THB' }

  it('takes the unit of a known instrument, or the one of its type when it has none', () => {
    const onGold = changeMarket(buyDraft({ symbol: '' }), 'GOLD')
    expect(pickSymbol(onGold, '96.5', [gold])).toMatchObject({ instrumentName: 'ทอง 96.5%', assetType: 'gold', unit: 'gram' })
    const onFund = changeMarket(buyDraft({ symbol: '' }), 'FUND')
    expect(pickSymbol(onFund, 'scbs&p500', [fund])).toMatchObject({ assetType: 'fund', unit: 'unit' })
  })

  it('goes back to the default unit once the symbol stops matching', () => {
    const matched = pickSymbol(changeMarket(buyDraft({ symbol: '' }), 'GOLD'), '96.5', [gold])
    expect(pickSymbol(matched, '99.99', [gold])).toMatchObject({ instrumentName: '', assetType: 'gold', unit: 'baht_gold' })
  })

  it('keeps the unit typed for a symbol that was never looked up', () => {
    const typed = { ...changeMarket(buyDraft({ symbol: '96' }), 'GOLD'), unit: 'gram' as const }
    expect(pickSymbol(typed, '96.5', [])).toMatchObject({ symbol: '96.5', assetType: 'gold', unit: 'gram' })
  })

  it('clears a unit looked up in the old market when the market changes', () => {
    const onGold = pickSymbol(changeMarket(buyDraft({ symbol: '' }), 'GOLD'), '96.5', [gold])
    expect(changeMarket(onGold, 'HK', [gold])).toMatchObject({ market: 'HK', assetType: 'stock', unit: 'share' })
  })

  it('picks the coin received like the main one without touching the unit of the coin given up', () => {
    const swapping = changeType(buyDraft({ market: 'CRYPTO', symbol: 'btc', assetType: 'crypto', unit: 'coin', currency: 'USD' }), 'swap', 'THB')
    expect(swapping).toMatchObject({ unit: 'coin', toUnit: 'coin' })
    const toGold = changeToMarket(swapping, 'GOLD')
    expect(toGold).toMatchObject({ toMarket: 'GOLD', toAssetType: 'gold', toUnit: 'baht_gold', unit: 'coin', currency: 'USD' })
    expect(pickToSymbol(toGold, '96.5', [gold])).toMatchObject({ toAssetType: 'gold', toUnit: 'gram', unit: 'coin' })
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
    expect(next).toMatchObject({
      type: 'swap',
      toMarket: 'CRYPTO',
      toSymbol: '',
      toQuantity: '',
      toInstrumentName: '',
      toAssetType: 'crypto',
      toUnit: 'coin',
    })
  })

  it('starts a swap on crypto in both markets, in the crypto currency, with the rate started over', () => {
    const from = buyDraft({ market: 'SET', symbol: 'ptt', instrumentName: 'ปตท.', assetType: 'etf', currency: 'THB', fxRate: '', fxSource: 'auto' })
    expect(changeType(from, 'swap', 'THB')).toMatchObject({
      market: 'CRYPTO',
      toMarket: 'CRYPTO',
      assetType: 'crypto',
      toAssetType: 'crypto',
      unit: 'coin',
      toUnit: 'coin',
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

  it('reads a transfer whose fee came out of the units back with the currency of the asset, not the stored baht', () => {
    const saved = draftToTransaction(transferDraft({ symbol: 'eth', market: 'CRYPTO', quantity: '1', feePaidIn: 'received', feeQuantity: '0.01', fxRate: '' }), ctx).tx
    expect(saved).toMatchObject({ currency: 'THB', fxRate: '1', fxSource: 'same' })
    const eth: Instrument = { id: 'CRYPTO:ETH', market: 'CRYPTO', symbol: 'ETH', name: 'Ethereum', assetType: 'crypto', currency: 'USDT' }
    expect(draftFromTransaction(saved, [eth])).toMatchObject({ currency: 'USDT', fxRate: '', fxSource: 'auto' })
    expect(draftFromTransaction(saved, [])).toMatchObject({ currency: 'USD', fxRate: '', fxSource: 'auto' })
  })

  it('keeps the stored currency and rate of a transfer whose fee was paid in cash', () => {
    const saved = draftToTransaction(transferDraft({ fees: '3' }), ctx).tx
    expect(draftFromTransaction(saved, [])).toMatchObject({ currency: saved.currency, fxRate: saved.fxRate, fxSource: saved.fxSource })
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

describe('when the way a fee is paid is offered', () => {
  const crypto = (overrides: Partial<Draft> = {}) => buyDraft({ market: 'CRYPTO', symbol: 'eth', currency: 'USD', ...overrides })
  const account = (id: string) => ({ id, name: id, broker: '', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
  const transfer = (overrides: Partial<Draft> = {}): Draft => ({
    ...withTransferTarget(changeType(emptyDraft('acc-1', '2024-06-01'), 'transfer', 'THB'), [account('acc-1'), account('acc-2')]),
    ...overrides,
  })

  it('is offered for a coin and left out for a share, so a stock buy keeps its plain fee and tax row', () => {
    expect(showsFeePaidIn(crypto())).toBe(true)
    expect(showsFeePaidIn(crypto({ type: 'sell' }))).toBe(true)
    expect(showsFeePaidIn(buyDraft())).toBe(false)
    expect(showsFeePaidIn(buyDraft({ market: 'SET', currency: 'THB' }))).toBe(false)
    expect(showsFeePaidIn(buyDraft({ type: 'sell' }))).toBe(false)
  })

  it('is offered for a swap when either side is a coin', () => {
    const swap = changeType(buyDraft(), 'swap', 'THB')
    expect(showsFeePaidIn(swap)).toBe(true)
    expect(showsFeePaidIn({ ...swap, market: 'US', toMarket: 'CRYPTO' })).toBe(true)
    expect(showsFeePaidIn({ ...swap, market: 'CRYPTO', toMarket: 'US' })).toBe(true)
    expect(showsFeePaidIn({ ...swap, market: 'US', toMarket: 'SET' })).toBe(false)
  })

  it('is offered for a transfer of coins only, and never for cash', () => {
    expect(showsFeePaidIn(transfer({ market: 'CRYPTO' }))).toBe(true)
    expect(showsFeePaidIn(transfer())).toBe(false)
    expect(showsFeePaidIn(transfer({ market: 'CRYPTO', transferKind: 'cash' }))).toBe(false)
  })

  it('is never offered where only cash can pay', () => {
    for (const type of ['dividend', 'deposit', 'fx_convert', 'opening', 'split'] as const) {
      expect(showsFeePaidIn(crypto({ type }))).toBe(false)
    }
  })

  it('stays on for a share whose fee is already paid another way, as when a saved transaction is edited', () => {
    expect(showsFeePaidIn(buyDraft({ feePaidIn: 'asset' }))).toBe(true)
    expect(showsFeePaidIn(buyDraft({ feePaidIn: 'received' }))).toBe(true)
    expect(showsFeePaidIn(transfer({ feePaidIn: 'received' }))).toBe(true)
    expect(showsFeePaidIn(buyDraft({ type: 'sell', feePaidIn: 'received' }))).toBe(false)
  })
})

describe('a transfer of units whose fee is taken from the units', () => {
  const account = (id: string) => ({ id, name: id, broker: '', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
  const transfer = (overrides: Partial<Draft> = {}): Draft => ({
    ...withTransferTarget(changeType(emptyDraft('acc-1', '2024-06-01'), 'transfer', 'THB'), [account('acc-1'), account('acc-2')]),
    symbol: 'VOO',
    quantity: '4',
    fxRate: '35',
    fxSource: 'auto',
    referenceFxRate: '35',
    ...overrides,
  })

  it('moves no money, whereas a fee in cash or a transfer of cash does', () => {
    expect(movesNoMoney(transfer({ feePaidIn: 'received', feeQuantity: '0.1' }))).toBe(true)
    expect(movesNoMoney(transfer())).toBe(false)
    expect(movesNoMoney(transfer({ feePaidIn: 'received', transferKind: 'cash' }))).toBe(false)
    expect(movesNoMoney(buyDraft({ feePaidIn: 'received' }))).toBe(false)
  })

  it('is saved in the base currency with no exchange rate, whatever currency the draft still holds', () => {
    const { tx, errors } = draftToTransaction(transfer({ feePaidIn: 'received', feeQuantity: '0.1', fxRate: '' }), ctx)
    expect(errors).toEqual([])
    expect(tx).toMatchObject({ currency: 'THB', fxRate: '1', fxSource: 'same', feePaidIn: 'received', feeQuantity: '0.1', fees: '0' })
    expect(tx.fxRateDate).toBeUndefined()
    expect(tx.referenceFxRate).toBeUndefined()
  })

  it('still needs the rate of its own currency when the fee is paid in cash', () => {
    const { tx, errors } = draftToTransaction(transfer({ fxRate: '' }), ctx)
    expect(tx.currency).toBe('USD')
    expect(errors).toEqual(['เรทแลกเปลี่ยนต้องเป็นตัวเลขมากกว่า 0'])
  })

  it('keeps the currency and the rate of the draft while the fee comes from the units, so no other change inherits the base currency', () => {
    const units = transfer({ feePaidIn: 'received', feeQuantity: '0.1' })
    expect(units).toMatchObject({ currency: 'USD', fxRate: '35', fxSource: 'auto', referenceFxRate: '35' })
    const buy = changeType({ ...units, price: '400' }, 'buy', 'THB')
    expect(buy).toMatchObject({ type: 'buy', currency: 'USD', fxRate: '35', fxSource: 'auto' })
    const { tx, errors } = draftToTransaction(buy, ctx)
    expect(errors).toEqual([])
    expect(tx).toMatchObject({ type: 'buy', currency: 'USD', fxRate: '35', fxSource: 'auto' })
  })

  it('keeps them as well when the transfer turns into a transfer of cash', () => {
    const cash = { ...transfer({ feePaidIn: 'received', feeQuantity: '0.1' }), transferKind: 'cash' as const, amount: '100' }
    expect(movesNoMoney(cash)).toBe(false)
    const { tx, errors } = draftToTransaction(cash, ctx)
    expect(errors).toEqual([])
    expect(tx).toMatchObject({ type: 'transfer', currency: 'USD', fxRate: '35', fxSource: 'auto', fees: '0' })
    expect(tx.feePaidIn).toBeUndefined()
  })

  it('is back to its own currency and rate in the transaction as soon as the fee goes back to cash', () => {
    const { tx } = draftToTransaction(transfer({ feePaidIn: 'cash', fees: '2' }), ctx)
    expect(tx).toMatchObject({ currency: 'USD', fxRate: '35', fees: '2' })
  })

})

describe('fees from the account formula', () => {
  const streaming: FeeTemplate = { currency: 'THB', commissionPct: '0.157', minimum: '50', vatPct: '7', perOrder: '0' }
  const streamingAccount: Account = {
    id: 'streaming',
    name: 'Streaming SET',
    broker: '',
    note: '',
    createdAt: '2024-01-01T00:00:00.000Z',
    feeTemplate: streaming,
  }
  const plainAccount: Account = { id: 'plain', name: 'Plain', broker: '', note: '', createdAt: '2024-01-01T00:00:00.000Z' }
  const setBuy = buyDraft({ accountId: 'streaming', currency: 'THB', quantity: '100', price: '35' })

  it('starts on automatic and reads a saved transaction as typed', () => {
    expect(emptyDraft('acc-1', '2024-01-15').feesSource).toBe('auto')
    const { tx } = draftToTransaction(buyDraft({ fees: '1.5' }), ctx)
    expect(draftFromTransaction(tx, []).feesSource).toBe('manual')
  })

  it('fills the fee from the account formula until the user types one', () => {
    const draft = { ...buyDraft(), accountId: 'streaming', currency: 'THB', quantity: '100', price: '35' }
    expect(syncFees(draft, [streamingAccount]).fees).toBe('53.50')
    const typed = { ...draft, fees: '60', feesSource: 'manual' as const }
    expect(syncFees(typed, [streamingAccount]).fees).toBe('60')
  })

  it('does not fill a fee from a formula in another currency', () => {
    const draft = { ...buyDraft(), accountId: 'streaming', currency: 'USD', quantity: '10', price: '100' }
    expect(templateFee(draft, streamingAccount)).toBeNull()
    expect(syncFees(draft, [streamingAccount]).fees).toBe('')
  })

  it('follows the quantity and price, and empties the fee when the order cannot be priced', () => {
    const filled = syncFees(setBuy, [streamingAccount])
    expect(syncFees({ ...filled, quantity: '1,000' }, [streamingAccount]).fees).toBe('58.80')
    expect(syncFees({ ...filled, quantity: '' }, [streamingAccount]).fees).toBe('')
    expect(syncFees({ ...filled, price: '0' }, [streamingAccount]).fees).toBe('')
    expect(syncFees({ ...filled, quantity: 'abc' }, [streamingAccount]).fees).toBe('')
  })

  it('fills a sell as well, and nothing else', () => {
    expect(templateFee({ ...setBuy, type: 'sell' }, streamingAccount)).toBe('53.50')
    expect(templateFee({ ...setBuy, type: 'dividend' }, streamingAccount)).toBeNull()
    expect(templateFee({ ...setBuy, type: 'fx_convert' }, streamingAccount)).toBeNull()
  })

  it('leaves a fee that is not paid in cash alone', () => {
    const crypto = { ...setBuy, market: 'CRYPTO' as const }
    expect(templateFee({ ...crypto, feePaidIn: 'received' }, streamingAccount)).toBeNull()
    expect(templateFee({ ...crypto, feePaidIn: 'asset' }, streamingAccount)).toBeNull()
    expect(templateFee({ ...crypto, feePaidIn: 'cash' }, streamingAccount)).toBe('53.50')
    expect(templateFee({ ...setBuy, type: 'sell', feePaidIn: 'received' }, streamingAccount)).toBe('53.50')
  })

  it('has nothing to fill for an account without a formula or one that is not there', () => {
    expect(templateFee({ ...setBuy, accountId: 'plain' }, plainAccount)).toBeNull()
    expect(templateFee(setBuy, undefined)).toBeNull()
    expect(syncFees({ ...setBuy, accountId: 'plain' }, [streamingAccount, plainAccount]).fees).toBe('')
  })

  it('leaves the fee empty when the formula comes to nothing', () => {
    const free = { ...streamingAccount, feeTemplate: { ...streaming, commissionPct: '0', minimum: '0', vatPct: '0' } }
    expect(templateFee(setBuy, free)).toBe('0.00')
    expect(syncFees(setBuy, [free]).fees).toBe('')
  })

  it('changes nothing when the fee already matches', () => {
    const filled = syncFees(setBuy, [streamingAccount])
    expect(syncFees(filled, [streamingAccount])).toBe(filled)
    const typed = { ...setBuy, fees: '60', feesSource: 'manual' as const }
    expect(syncFees(typed, [streamingAccount])).toBe(typed)
  })
})

describe('repeating a transaction', () => {
  it('repeats a buy for today with the same asset, quantity and fee, and a fresh rate', () => {
    const buy = makeTx({ quantity: '2', price: '512.3', fees: '1', fxRate: '33.8', fxSource: 'auto', fxRateDate: '2024-03-08', date: '2024-03-10', time: '21:30' })
    const draft = duplicateDraft(buy, [], '2024-06-01')
    expect(draft).toMatchObject({ type: 'buy', symbol: 'AAPL', quantity: '2', fees: '1', price: '', date: '2024-06-01', time: '' })
    expect(draft).toMatchObject({ fxRate: '', fxSource: 'auto', fxRateDate: '', referenceFxRate: '', feesSource: 'manual' })
  })

  it('also empties the price of a sell and keeps the account, note and how the fee was paid', () => {
    const sell = makeTx({
      type: 'sell',
      accountId: 'acc-9',
      instrumentId: 'CRYPTO:SOL',
      quantity: '3',
      price: '150',
      fees: '0.2',
      feePaidIn: 'asset',
      feeInstrumentId: 'CRYPTO:BNB',
      feeQuantity: '0.01',
      note: 'monthly',
    })
    expect(duplicateDraft(sell, [], '2024-06-01')).toMatchObject({
      type: 'sell',
      accountId: 'acc-9',
      price: '',
      quantity: '3',
      fees: '0.2',
      feePaidIn: 'asset',
      feeMarket: 'CRYPTO',
      feeSymbol: 'BNB',
      feeQuantity: '0.01',
      note: 'monthly',
    })
  })

  it('keeps the other side of a swap and of a transfer', () => {
    const swap = makeTx({
      type: 'swap',
      instrumentId: 'CRYPTO:BTC',
      toInstrumentId: 'CRYPTO:ETH',
      quantity: '0.1',
      toQuantity: '2',
      price: undefined,
      amount: '6000',
      fxRate: '35',
    })
    expect(duplicateDraft(swap, [], '2024-06-01')).toMatchObject({
      type: 'swap',
      symbol: 'BTC',
      quantity: '0.1',
      toMarket: 'CRYPTO',
      toSymbol: 'ETH',
      toQuantity: '2',
      amount: '6000',
      fxRate: '',
    })
    const transfer = makeTx({ type: 'transfer', toAccountId: 'acc-2', quantity: '5', price: undefined })
    expect(duplicateDraft(transfer, [], '2024-06-01')).toMatchObject({ type: 'transfer', toAccountId: 'acc-2', transferKind: 'asset', quantity: '5' })
  })

  it('starts the received amount and the market rate of an exchange over', () => {
    const exchange = makeTx({
      type: 'fx_convert',
      instrumentId: undefined,
      quantity: undefined,
      price: undefined,
      amount: '1000',
      currency: 'USD',
      toCurrency: 'THB',
      toAmount: '34000',
      marketRate: '34.2',
      fees: '2',
    })
    expect(duplicateDraft(exchange, [], '2024-06-01')).toMatchObject({
      type: 'fx_convert',
      amount: '1000',
      toCurrency: 'THB',
      fees: '2',
      toAmount: '',
      toAmountSource: 'auto',
      marketRate: '',
      marketRateDate: '',
    })
  })

  it('moves the tax year of a remittance to the year of the copy', () => {
    const withdraw = makeTx({ type: 'withdraw', instrumentId: undefined, quantity: undefined, price: undefined, amount: '500', remitToThailand: true, taxYear: 2023, date: '2023-12-20' })
    expect(duplicateDraft(withdraw, [], '2024-06-01')).toMatchObject({ remitToThailand: true, taxYear: '2024' })
  })
})

describe('the trade journal of a draft', () => {
  it('keeps a journal only when something was filled in', () => {
    expect(journalFromDraft(emptyJournalDraft())).toBeUndefined()
    const j = { ...emptyJournalDraft(), strategy: ' Breakout ', tags: 'earnings, gap ,', emotion: 'fomo' as const, confidence: '4', stopLoss: '95' }
    expect(journalFromDraft(j)).toEqual({ strategy: 'Breakout', tags: ['earnings', 'gap'], emotion: 'fomo', confidence: 4, stopLoss: '95' })
  })

  it('leaves out what is blank, so only the fields that were filled in are saved', () => {
    const j = { ...emptyJournalDraft(), reason: '  ', tags: ' , ', mistakes: [], strategy: 'DCA' }
    expect(Object.keys(journalFromDraft(j) ?? {})).toEqual(['strategy'])
  })

  it('reads prices the way the other price fields are read', () => {
    const j = { ...emptyJournalDraft(), stopLoss: '1,095.50', target: '1 200' }
    expect(journalFromDraft(j)).toEqual({ stopLoss: '1095.5', target: '1200' })
  })

  it('goes from a saved journal to a draft and back unchanged', () => {
    const journal: TradeJournal = {
      strategy: 'Breakout',
      tags: ['earnings', 'gap'],
      reason: 'new high',
      emotion: 'calm',
      confidence: 3,
      stopLoss: '95',
      target: '130',
      review: 'sold into strength',
      mistakes: ['sold_early', 'no_stop'],
      score: 2,
      checked: ['เทรนด์ขาขึ้น'],
    }
    expect(journalToDraft(journal)).toEqual({
      strategy: 'Breakout',
      tags: 'earnings, gap',
      reason: 'new high',
      emotion: 'calm',
      confidence: '3',
      stopLoss: '95',
      target: '130',
      review: 'sold into strength',
      mistakes: ['sold_early', 'no_stop'],
      score: '2',
      checked: ['เทรนด์ขาขึ้น'],
    })
    expect(journalFromDraft(journalToDraft(journal))).toEqual(journal)
    expect(journalToDraft(undefined)).toEqual(emptyJournalDraft())
  })

  it('saves the journal of a buy and drops it when the type stops being a trade', () => {
    const draft = buyDraft({ symbol: 'AAPL', quantity: '2', price: '100', journal: { ...emptyJournalDraft(), strategy: 'Pullback' } })
    expect(draftToTransaction(draft, ctx).tx.journal).toEqual({ strategy: 'Pullback' })
    expect(draftToTransaction({ ...draft, type: 'dividend', amount: '1' }, ctx).tx.journal).toBeUndefined()
    expect(draftToTransaction({ ...draft, type: 'opening' }, ctx).tx.journal).toBeUndefined()
  })

  it('keeps the journal in the draft while the type is something else, so coming back finds it', () => {
    const draft = buyDraft({ journal: { ...emptyJournalDraft(), strategy: 'Pullback', emotion: 'fear' } })
    const away = changeType(draft, 'deposit', 'THB')
    expect(away.journal).toEqual(draft.journal)
    expect(changeType(away, 'sell', 'THB').journal).toEqual(draft.journal)
  })

  it('keeps the review, mistakes and score for a sell only', () => {
    const closing = { ...emptyJournalDraft(), strategy: 'Pullback', review: 'ok', mistakes: ['chased' as const], score: '4' }
    const sell = buyDraft({ type: 'sell', journal: closing })
    expect(draftToTransaction(sell, ctx).tx.journal).toEqual({ strategy: 'Pullback', review: 'ok', mistakes: ['chased'], score: 4 })
    expect(draftToTransaction({ ...sell, type: 'buy' }, ctx).tx.journal).toEqual({ strategy: 'Pullback' })
    expect(draftToTransaction({ ...sell, type: 'buy', journal: { ...emptyJournalDraft(), score: '4' } }, ctx).tx.journal).toBeUndefined()
  })

  it('reports a price that is not a number once, from the journal', () => {
    const draft = buyDraft({ journal: { ...emptyJournalDraft(), stopLoss: 'abc', target: '-5' } })
    expect(draftToTransaction(draft, ctx).errors).toEqual(['Stop loss ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป', 'Target ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป'])
  })

  it('starts empty, and a saved transaction brings its journal into the draft', () => {
    expect(emptyDraft('acc-1', '2024-01-15').journal).toEqual(emptyJournalDraft())
    const saved = makeTx({ journal: { strategy: 'DCA', emotion: 'bored', confidence: 2 } })
    expect(draftFromTransaction(saved, []).journal).toEqual({ ...emptyJournalDraft(), strategy: 'DCA', emotion: 'bored', confidence: '2' })
    expect(draftFromTransaction(makeTx(), []).journal).toEqual(emptyJournalDraft())
  })

  it('repeats a buy with its strategy and tags but none of its feelings or review', () => {
    const buy = makeTx({ journal: { strategy: 'DCA', tags: ['monthly'], emotion: 'calm', confidence: 3, stopLoss: '90', review: 'ok', score: 4 } })
    expect(duplicateDraft(buy, [], '2024-06-01').journal).toEqual({ ...emptyJournalDraft(), strategy: 'DCA', tags: 'monthly' })
  })
})

describe('knownStrategies', () => {
  const traded = (strategy: string | undefined) => makeTx({ journal: strategy === undefined ? undefined : { strategy } })

  it('lists each strategy once, the most used first', () => {
    const transactions = [traded('Pullback'), traded('Breakout'), traded('DCA'), traded('Breakout'), traded('Breakout'), traded('DCA')]
    expect(knownStrategies(transactions)).toEqual(['Breakout', 'DCA', 'Pullback'])
  })

  it('breaks a tie by name, and ignores blanks and trades without a journal', () => {
    const transactions = [traded('b'), traded('a'), traded(' '), traded(undefined), makeTx({ journal: { emotion: 'fomo' } })]
    expect(knownStrategies(transactions)).toEqual(['a', 'b'])
    expect(knownStrategies([])).toEqual([])
  })

  it('counts a strategy typed with spaces around it as the same one', () => {
    expect(knownStrategies([traded(' DCA'), traded('DCA ')])).toEqual(['DCA'])
  })
})

describe('reinvesting a dividend', () => {
  const paid = makeTx({
    type: 'dividend',
    instrumentId: 'US:VOO',
    quantity: undefined,
    price: undefined,
    amount: '10',
    tax: '1.5',
    fxRate: '34',
    fxSource: 'auto',
    fxRateDate: '2024-03-27',
    referenceFxRate: '34',
    date: '2024-03-28',
    time: '10:15',
  })
  const ctx = { id: 'buy-1', createdAt: '2024-03-28T10:00:00.001Z', today: '2024-06-01' }
  const reinvestDraft = (overrides: Partial<Draft> = {}): Draft => ({
    ...draftFromTransaction(paid, []),
    reinvest: true,
    reinvestQuantity: '0.016',
    reinvestPrice: '500',
    reinvestFees: '',
    ...overrides,
  })

  it('builds the buy of a reinvested dividend at the dividend’s rate and date', () => {
    const dividend = makeTx({ type: 'dividend', instrumentId: 'US:VOO', quantity: undefined, price: undefined, amount: '10', tax: '1.5', fxRate: '34', fxSource: 'auto', date: '2024-03-28' })
    const draft = { ...draftFromTransaction(dividend, []), reinvest: true, reinvestQuantity: '0.016', reinvestPrice: '500', reinvestFees: '' }
    const { tx, errors } = reinvestTransaction(draft, dividend, { id: 'buy-1', createdAt: '2024-03-28T10:00:00.001Z', today: '2024-06-01' })
    expect(errors).toEqual([])
    expect(tx).toMatchObject({ type: 'buy', instrumentId: 'US:VOO', quantity: '0.016', price: '500', fees: '0', fxRate: '34', date: '2024-03-28' })
  })

  it('takes the account, time, currency and the whole rate from the dividend, and pays no tax', () => {
    const { tx } = reinvestTransaction(reinvestDraft({ reinvestFees: '1,000.5' }), paid, ctx)
    expect(tx).toMatchObject({
      id: 'buy-1',
      accountId: 'acc-1',
      time: '10:15',
      currency: 'USD',
      fees: '1000.5',
      tax: '0',
      fxRate: '34',
      fxSource: 'auto',
      fxRateDate: '2024-03-27',
      referenceFxRate: '34',
      createdAt: '2024-03-28T10:00:00.001Z',
      updatedAt: '2024-03-28T10:00:00.001Z',
    })
  })

  it('asks for the quantity and the price of the buy', () => {
    const { errors } = reinvestTransaction(reinvestDraft({ reinvestQuantity: '', reinvestPrice: '' }), paid, ctx)
    expect(errors).toEqual(['จำนวนหน่วยต้องเป็นตัวเลขมากกว่า 0', 'ราคาต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป'])
  })

  it('refuses a fee that is not a number', () => {
    const { errors } = reinvestTransaction(reinvestDraft({ reinvestFees: 'abc' }), paid, ctx)
    expect(errors).toEqual(['ค่าธรรมเนียมต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป'])
  })
})

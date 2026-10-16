import { MARKET_CURRENCY } from '../domain/currencies'
import { D, Decimal, parseDecimalInput } from '../domain/decimal'
import { cashDeltaQuote } from '../domain/ledger'
import {
  instrumentKey,
  type AssetType,
  type FxSource,
  type Instrument,
  type Market,
  type Transaction,
  type TxType,
} from '../domain/types'
import { validateTransaction } from '../domain/validation'

export type OpeningKind = 'asset' | 'cash'

export interface Draft {
  type: TxType
  accountId: string
  date: string
  time: string
  market: Market
  symbol: string
  instrumentName: string
  assetType: AssetType
  openingKind: OpeningKind
  currency: string
  quantity: string
  price: string
  amount: string
  fees: string
  tax: string
  splitRatio: string
  toCurrency: string
  toAmount: string
  marketRate: string
  fxRate: string
  fxSource: FxSource
  fxRateDate: string
  referenceFxRate: string
  remitToThailand: boolean
  taxYear: string
  note: string
}

export interface DraftContext {
  id: string
  createdAt: string
  baseCurrency: string
  today: string
}

const INSTRUMENT_TYPES: readonly TxType[] = ['buy', 'sell', 'dividend', 'interest', 'split']

export function emptyDraft(accountId: string, today: string): Draft {
  return {
    type: 'buy',
    accountId,
    date: today,
    time: '',
    market: 'US',
    symbol: '',
    instrumentName: '',
    assetType: 'stock',
    openingKind: 'asset',
    currency: MARKET_CURRENCY.US,
    quantity: '',
    price: '',
    amount: '',
    fees: '',
    tax: '',
    splitRatio: '',
    toCurrency: '',
    toAmount: '',
    marketRate: '',
    fxRate: '',
    fxSource: 'auto',
    fxRateDate: '',
    referenceFxRate: '',
    remitToThailand: false,
    taxYear: today.slice(0, 4),
    note: '',
  }
}

export function isOpeningAsset(draft: Draft): boolean {
  return draft.type === 'opening' && draft.openingKind === 'asset'
}

export function showsInstrument(draft: Draft): boolean {
  if (draft.type === 'opening') return draft.openingKind === 'asset'
  return INSTRUMENT_TYPES.includes(draft.type)
}

export function changeCurrency(draft: Draft, currency: string): Draft {
  if (currency === draft.currency) return draft
  return { ...draft, currency, fxRate: '', fxSource: 'auto', fxRateDate: '', referenceFxRate: '' }
}

// A rate fetched for the old date must not survive as an "auto" rate for the new one.
export function changeDate(draft: Draft, date: string): Draft {
  const next = { ...draft, date, referenceFxRate: '', fxRateDate: '' }
  return draft.fxSource === 'auto' ? { ...next, fxRate: '' } : next
}

// An opening holding's rate means "my average purchase rate", not the day's rate,
// so moving into or out of that meaning starts the rate over.
function restartRate(next: Draft): Draft {
  return isOpeningAsset(next)
    ? { ...next, fxRate: '', fxSource: 'auto' }
    : { ...next, fxRate: next.referenceFxRate, fxSource: 'auto' }
}

export function changeType(draft: Draft, type: TxType, baseCurrency: string): Draft {
  if (type === 'fx_convert') {
    const converted = changeCurrency({ ...draft, type }, baseCurrency)
    return { ...converted, toCurrency: baseCurrency === 'USD' ? 'THB' : 'USD', marketRate: '' }
  }
  const next =
    draft.type === 'fx_convert' ? changeCurrency({ ...draft, type }, MARKET_CURRENCY[draft.market]) : { ...draft, type }
  return isOpeningAsset(next) !== isOpeningAsset(draft) ? restartRate(next) : next
}

export function changeOpeningKind(draft: Draft, openingKind: OpeningKind): Draft {
  const next = { ...draft, openingKind }
  return isOpeningAsset(next) !== isOpeningAsset(draft) ? restartRate(next) : next
}

function lookupInstrument(market: Market, symbol: string, instruments: readonly Instrument[]): Instrument | undefined {
  return instruments.find((i) => i.id === instrumentKey(market, symbol))
}

function defaultAssetType(market: Market): AssetType {
  return market === 'CRYPTO' ? 'crypto' : 'stock'
}

export function changeMarket(draft: Draft, market: Market, instruments: readonly Instrument[] = []): Draft {
  const lookedUp = lookupInstrument(draft.market, draft.symbol, instruments) !== undefined
  const assetType = market === 'CRYPTO' ? 'crypto' : draft.assetType === 'crypto' ? 'stock' : draft.assetType
  const switched = changeCurrency(
    lookedUp
      ? { ...draft, market, instrumentName: '', assetType: defaultAssetType(market) }
      : { ...draft, market, assetType },
    MARKET_CURRENCY[market],
  )
  return draft.symbol ? pickSymbol(switched, draft.symbol, instruments) : switched
}

export function pickSymbol(draft: Draft, symbol: string, instruments: readonly Instrument[]): Draft {
  const found = lookupInstrument(draft.market, symbol, instruments)
  if (found) return changeCurrency({ ...draft, symbol, instrumentName: found.name, assetType: found.assetType }, found.currency)
  if (lookupInstrument(draft.market, draft.symbol, instruments)) {
    return { ...draft, symbol, instrumentName: '', assetType: defaultAssetType(draft.market) }
  }
  return { ...draft, symbol }
}

// An opening holding needs the user's own average purchase rate, so the reference rate is offered but never filled in.
export function applyReferenceRate(draft: Draft, quote: { rate: string; rateDate: string }): Draft {
  const next = { ...draft, referenceFxRate: quote.rate, fxRateDate: quote.rateDate }
  if (draft.fxSource === 'manual') return next
  if (draft.fxSource === 'estimated') return { ...next, fxRate: quote.rate }
  if (isOpeningAsset(draft)) return next
  return { ...next, fxRate: quote.rate, fxSource: 'auto' }
}

export function draftFromTransaction(tx: Transaction, instruments: readonly Instrument[]): Draft {
  const instrument = instruments.find((i) => i.id === tx.instrumentId)
  const separator = tx.instrumentId?.indexOf(':') ?? -1
  const market = (instrument?.market ?? (separator > 0 ? tx.instrumentId?.slice(0, separator) : 'US')) as Market
  return {
    type: tx.type,
    accountId: tx.accountId,
    date: tx.date,
    time: tx.time ?? '',
    market,
    symbol: instrument?.symbol ?? (separator > 0 ? (tx.instrumentId?.slice(separator + 1) ?? '') : ''),
    instrumentName: instrument?.name ?? '',
    assetType: instrument?.assetType ?? 'stock',
    openingKind: tx.type === 'opening' && !tx.instrumentId ? 'cash' : 'asset',
    currency: tx.currency,
    quantity: tx.quantity ?? '',
    price: tx.price ?? '',
    amount: tx.amount ?? '',
    fees: tx.fees === '0' ? '' : tx.fees,
    tax: tx.tax === '0' ? '' : tx.tax,
    splitRatio: tx.splitRatio ?? '',
    toCurrency: tx.toCurrency ?? '',
    toAmount: tx.toAmount ?? '',
    marketRate: tx.marketRate ?? '',
    fxRate: tx.fxRate,
    fxSource: tx.fxSource,
    fxRateDate: tx.fxRateDate ?? '',
    referenceFxRate: tx.referenceFxRate ?? '',
    remitToThailand: tx.remitToThailand ?? false,
    taxYear: tx.taxYear?.toString() ?? tx.date.slice(0, 4),
    note: tx.note,
  }
}

export function draftToTransaction(draft: Draft, ctx: DraftContext): { tx: Transaction; errors: string[] } {
  // Unparseable input is passed through unchanged so validateTransaction reports it once.
  const num = (raw: string) => (raw.trim() === '' ? undefined : (parseDecimalInput(raw) ?? raw.trim()))
  const holding = draft.type === 'buy' || draft.type === 'sell' || isOpeningAsset(draft)
  const usesAmount = !holding && draft.type !== 'split'
  const isConvert = draft.type === 'fx_convert'
  const remit = draft.type === 'withdraw' && draft.remitToThailand
  // A split moves no money, so it never needs an exchange rate.
  const noFx = draft.currency === ctx.baseCurrency || draft.type === 'split'

  const tx: Transaction = {
    id: ctx.id,
    accountId: draft.accountId,
    type: draft.type,
    date: draft.date,
    time: draft.time || undefined,
    instrumentId: showsInstrument(draft) && draft.symbol.trim() ? instrumentKey(draft.market, draft.symbol) : undefined,
    quantity: holding ? num(draft.quantity) : undefined,
    price: holding ? num(draft.price) : undefined,
    amount: usesAmount ? num(draft.amount) : undefined,
    currency: draft.currency,
    fees: num(draft.fees) ?? '0',
    tax: num(draft.tax) ?? '0',
    splitRatio: draft.type === 'split' ? num(draft.splitRatio) : undefined,
    toCurrency: isConvert ? draft.toCurrency : undefined,
    toAmount: isConvert ? num(draft.toAmount) : undefined,
    marketRate: isConvert ? draft.marketRate || undefined : undefined,
    fxRate: noFx ? '1' : (num(draft.fxRate) ?? ''),
    fxSource: noFx ? 'same' : draft.fxSource,
    fxRateDate: noFx ? undefined : draft.fxRateDate || undefined,
    referenceFxRate: noFx ? undefined : draft.referenceFxRate || undefined,
    remitToThailand: remit ? true : undefined,
    taxYear: remit ? Number.parseInt(draft.taxYear, 10) : undefined,
    note: draft.note.trim(),
    createdAt: ctx.createdAt,
    updatedAt: ctx.createdAt,
  }
  return { tx, errors: validateTransaction(tx, ctx.today) }
}

export function totalForDisplay(tx: Transaction): Decimal | null {
  if (tx.type === 'split') return null
  if (tx.type === 'opening' && tx.instrumentId) {
    return D(tx.quantity).times(D(tx.price)).plus(D(tx.fees)).plus(D(tx.tax))
  }
  return cashDeltaQuote(tx).abs()
}

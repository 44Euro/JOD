import { MARKET_CURRENCY } from '../domain/currencies'
import { D, Decimal, parseDecimalInput } from '../domain/decimal'
import { cashDeltaQuote } from '../domain/ledger'
import {
  findInstrument,
  instrumentKey,
  type Account,
  type AssetType,
  type FxSource,
  type Instrument,
  type Market,
  type Transaction,
  type TxType,
} from '../domain/types'
import { validateTransaction } from '../domain/validation'

export type OpeningKind = 'asset' | 'cash'
export type ToAmountSource = 'auto' | 'manual'

export interface Draft {
  type: TxType
  accountId: string
  date: string
  time: string
  market: Market
  symbol: string
  instrumentName: string
  assetType: AssetType
  toMarket: Market
  toSymbol: string
  toInstrumentName: string
  toAssetType: AssetType
  toQuantity: string
  openingKind: OpeningKind
  toAccountId: string
  transferKind: OpeningKind
  currency: string
  quantity: string
  price: string
  amount: string
  fees: string
  tax: string
  splitRatio: string
  toCurrency: string
  toAmount: string
  toAmountSource: ToAmountSource
  marketRate: string
  marketRateDate: string
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

const INSTRUMENT_TYPES: readonly TxType[] = ['buy', 'sell', 'dividend', 'interest', 'split', 'swap']

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
    toMarket: 'US',
    toSymbol: '',
    toInstrumentName: '',
    toAssetType: 'stock',
    toQuantity: '',
    openingKind: 'asset',
    toAccountId: '',
    transferKind: 'asset',
    currency: MARKET_CURRENCY.US,
    quantity: '',
    price: '',
    amount: '',
    fees: '',
    tax: '',
    splitRatio: '',
    toCurrency: '',
    toAmount: '',
    toAmountSource: 'auto',
    marketRate: '',
    marketRateDate: '',
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
  if (draft.type === 'transfer') return draft.transferKind === 'asset'
  return INSTRUMENT_TYPES.includes(draft.type)
}

// A transfer needs a receiving account other than the sending one, so one is picked until the user chooses.
export function withTransferTarget(draft: Draft, accounts: readonly Account[]): Draft {
  if (draft.type !== 'transfer' || (draft.toAccountId !== '' && draft.toAccountId !== draft.accountId)) return draft
  const toAccountId = accounts.find((a) => a.id !== draft.accountId)?.id ?? ''
  return toAccountId === draft.toAccountId ? draft : { ...draft, toAccountId }
}

export function changeCurrency(draft: Draft, currency: string): Draft {
  if (currency === draft.currency) return draft
  return { ...draft, currency, fxRate: '', fxSource: 'auto', fxRateDate: '', referenceFxRate: '', marketRate: '', marketRateDate: '' }
}

// A rate fetched for the old date must not survive as an "auto" rate for the new one.
export function changeDate(draft: Draft, date: string): Draft {
  const next = { ...draft, date, referenceFxRate: '', fxRateDate: '', marketRate: '', marketRateDate: '' }
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
    if (draft.type === type) return draft
    const converted = changeCurrency({ ...draft, type }, baseCurrency)
    return {
      ...converted,
      toCurrency: baseCurrency === 'USD' ? 'THB' : 'USD',
      marketRate: '',
      marketRateDate: '',
      toAmount: '',
      toAmountSource: 'auto',
    }
  }
  if (type === 'swap' && draft.type === type) return draft
  const next =
    draft.type === 'fx_convert' ? changeCurrency({ ...draft, type }, MARKET_CURRENCY[draft.market]) : { ...draft, type }
  const changed = isOpeningAsset(next) !== isOpeningAsset(draft) ? restartRate(next) : next
  if (type !== 'swap') return changed
  return {
    ...changed,
    toMarket: changed.market,
    toSymbol: '',
    toInstrumentName: '',
    toAssetType: defaultAssetType(changed.market),
    toQuantity: '',
  }
}

export function changeOpeningKind(draft: Draft, openingKind: OpeningKind): Draft {
  const next = { ...draft, openingKind }
  return isOpeningAsset(next) !== isOpeningAsset(draft) ? restartRate(next) : next
}

function defaultAssetType(market: Market): AssetType {
  return market === 'CRYPTO' ? 'crypto' : 'stock'
}

export function changeMarket(draft: Draft, market: Market, instruments: readonly Instrument[] = []): Draft {
  const lookedUp = findInstrument(instruments, draft.market, draft.symbol) !== undefined
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
  const found = findInstrument(instruments, draft.market, symbol)
  if (found) return changeCurrency({ ...draft, symbol, instrumentName: found.name, assetType: found.assetType }, found.currency)
  if (findInstrument(instruments, draft.market, draft.symbol)) {
    return { ...draft, symbol, instrumentName: '', assetType: defaultAssetType(draft.market) }
  }
  return { ...draft, symbol }
}

// The coin received is picked like the main instrument, but its currency is not the currency of the swap, so only
// the instrument fields are taken back from the result.
function viaMain(draft: Draft, change: (main: Draft) => Draft): Draft {
  const changed = change({
    ...draft,
    market: draft.toMarket,
    symbol: draft.toSymbol,
    instrumentName: draft.toInstrumentName,
    assetType: draft.toAssetType,
  })
  return {
    ...draft,
    toMarket: changed.market,
    toSymbol: changed.symbol,
    toInstrumentName: changed.instrumentName,
    toAssetType: changed.assetType,
  }
}

export function changeToMarket(draft: Draft, market: Market, instruments: readonly Instrument[] = []): Draft {
  return viaMain(draft, (main) => changeMarket(main, market, instruments))
}

export function pickToSymbol(draft: Draft, symbol: string, instruments: readonly Instrument[]): Draft {
  return viaMain(draft, (main) => pickSymbol(main, symbol, instruments))
}

// An opening holding needs the user's own average purchase rate, so the reference rate is offered but never filled in.
export function applyReferenceRate(draft: Draft, quote: { rate: string; rateDate: string }): Draft {
  const next = { ...draft, referenceFxRate: quote.rate, fxRateDate: quote.rateDate }
  if (draft.fxSource === 'manual') return next
  if (draft.fxSource === 'estimated') return { ...next, fxRate: quote.rate }
  if (isOpeningAsset(draft)) return next
  return { ...next, fxRate: quote.rate, fxSource: 'auto' }
}

function parsedDecimal(raw: string): Decimal | null {
  const parsed = parseDecimalInput(raw)
  return parsed === null ? null : D(parsed)
}

// The fee is taken out of the amount exchanged, so the market rate applies to what is left after it.
export function receivedAmount(draft: Draft): string | null {
  if (draft.type !== 'fx_convert') return null
  const amount = parsedDecimal(draft.amount)
  const rate = parsedDecimal(draft.marketRate)
  const fees = draft.fees.trim() === '' ? D(0) : parsedDecimal(draft.fees)
  if (!amount || !rate || !fees || !rate.greaterThan(0) || fees.isNegative() || fees.greaterThanOrEqualTo(amount)) return null
  const received = amount.minus(fees).div(rate).toDecimalPlaces(2)
  // A trivially small amount rounds to nothing, which is not a received amount.
  return received.greaterThan(0) ? received.toString() : null
}

// Run after every draft change: an exchange whose received amount was not typed follows the amount, fee and rate.
export function syncReceived(draft: Draft): Draft {
  if (draft.type !== 'fx_convert' || draft.toAmountSource !== 'auto') return draft
  const toAmount = receivedAmount(draft) ?? ''
  return toAmount === draft.toAmount ? draft : { ...draft, toAmount }
}

function instrumentFields(
  instrumentId: string | undefined,
  instruments: readonly Instrument[],
): { market: Market; symbol: string; name: string; assetType: AssetType } {
  const instrument = instruments.find((i) => i.id === instrumentId)
  const separator = instrumentId?.indexOf(':') ?? -1
  return {
    market: (instrument?.market ?? (separator > 0 ? instrumentId?.slice(0, separator) : 'US')) as Market,
    symbol: instrument?.symbol ?? (separator > 0 ? (instrumentId?.slice(separator + 1) ?? '') : ''),
    name: instrument?.name ?? '',
    assetType: instrument?.assetType ?? 'stock',
  }
}

export function draftFromTransaction(tx: Transaction, instruments: readonly Instrument[]): Draft {
  const main = instrumentFields(tx.instrumentId, instruments)
  const received = instrumentFields(tx.toInstrumentId, instruments)
  return {
    type: tx.type,
    accountId: tx.accountId,
    date: tx.date,
    time: tx.time ?? '',
    market: main.market,
    symbol: main.symbol,
    instrumentName: main.name,
    assetType: main.assetType,
    toMarket: received.market,
    toSymbol: received.symbol,
    toInstrumentName: received.name,
    toAssetType: received.assetType,
    toQuantity: tx.toQuantity ?? '',
    openingKind: tx.type === 'opening' && !tx.instrumentId ? 'cash' : 'asset',
    toAccountId: tx.toAccountId ?? '',
    transferKind: tx.type === 'transfer' && !tx.instrumentId ? 'cash' : 'asset',
    currency: tx.currency,
    quantity: tx.quantity ?? '',
    price: tx.price ?? '',
    amount: tx.amount ?? '',
    fees: tx.fees === '0' ? '' : tx.fees,
    tax: tx.tax === '0' ? '' : tx.tax,
    splitRatio: tx.splitRatio ?? '',
    toCurrency: tx.toCurrency ?? '',
    toAmount: tx.toAmount ?? '',
    toAmountSource: 'manual',
    marketRate: tx.marketRate ?? '',
    marketRateDate: '',
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
  const isTransfer = draft.type === 'transfer'
  const isSwap = draft.type === 'swap'
  const sendsUnits = isTransfer && draft.transferKind === 'asset'
  const usesAmount = !holding && !sendsUnits && draft.type !== 'split'
  const isConvert = draft.type === 'fx_convert'
  const remit = draft.type === 'withdraw' && draft.remitToThailand
  // A split moves no money, so it never needs an exchange rate.
  const noFx = draft.currency === ctx.baseCurrency || draft.type === 'split'

  const tx: Transaction = {
    id: ctx.id,
    accountId: draft.accountId,
    toAccountId: isTransfer ? draft.toAccountId || undefined : undefined,
    type: draft.type,
    date: draft.date,
    time: draft.time || undefined,
    instrumentId: showsInstrument(draft) && draft.symbol.trim() ? instrumentKey(draft.market, draft.symbol) : undefined,
    toInstrumentId: isSwap && draft.toSymbol.trim() ? instrumentKey(draft.toMarket, draft.toSymbol) : undefined,
    quantity: holding || sendsUnits || isSwap ? num(draft.quantity) : undefined,
    toQuantity: isSwap ? num(draft.toQuantity) : undefined,
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
  // Without a symbol, validation would take a transfer of units for a transfer of cash and ask for an amount this
  // form does not show. It checks the rest as if an instrument were there, and the missing symbol is reported once.
  if (sendsUnits && !tx.instrumentId) {
    const checked = { ...tx, instrumentId: instrumentKey(draft.market, 'X') }
    return { tx, errors: ['กรุณาระบุหุ้น/สินทรัพย์', ...validateTransaction(checked, ctx.today)] }
  }
  return { tx, errors: validateTransaction(tx, ctx.today) }
}

export function totalForDisplay(tx: Transaction): Decimal | null {
  if (tx.type === 'split') return null
  if (tx.type === 'swap') return D(tx.amount)
  if (tx.type === 'transfer') return tx.instrumentId ? null : D(tx.amount)
  if (tx.type === 'opening' && tx.instrumentId) {
    return D(tx.quantity).times(D(tx.price)).plus(D(tx.fees)).plus(D(tx.tax))
  }
  return cashDeltaQuote(tx).abs()
}

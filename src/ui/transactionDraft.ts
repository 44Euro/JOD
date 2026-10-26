import { MARKET_CURRENCY } from '../domain/currencies'
import { D, Decimal, parseDecimalInput } from '../domain/decimal'
import { orderFee } from '../domain/fees'
import { cashDeltaQuote, type Position } from '../domain/ledger'
import {
  FEE_PAID_IN,
  defaultUnit,
  findInstrument,
  instrumentKey,
  unitOf,
  type Account,
  type AssetType,
  type Emotion,
  type FeePaidIn,
  type FxSource,
  type Instrument,
  type Market,
  type Mistake,
  type ReceiveKind,
  type TradeJournal,
  type Transaction,
  type TxType,
  type Unit,
} from '../domain/types'
import { validateSymbol, validateTransaction } from '../domain/validation'

export type OpeningKind = 'asset' | 'cash'
export type ToAmountSource = 'auto' | 'manual'
export type FeesSource = 'auto' | 'manual'

// Tags are typed as one line separated by commas; confidence and score hold '1' to '5' or nothing.
export interface JournalDraft {
  strategy: string
  tags: string
  reason: string
  emotion: Emotion | ''
  confidence: string
  stopLoss: string
  target: string
  review: string
  mistakes: Mistake[]
  score: string
  checked: string[]
}

export interface Draft {
  type: TxType
  accountId: string
  date: string
  time: string
  market: Market
  symbol: string
  instrumentName: string
  assetType: AssetType
  unit: Unit
  toMarket: Market
  toSymbol: string
  toInstrumentName: string
  toAssetType: AssetType
  toUnit: Unit
  toQuantity: string
  openingKind: OpeningKind
  toAccountId: string
  transferKind: OpeningKind
  // A holding moved to an account that trades it in another currency; empty keeps the currency it is held in.
  moveCurrency: string
  moveRate: string
  receiveKind: ReceiveKind
  currency: string
  quantity: string
  price: string
  amount: string
  fees: string
  feesSource: FeesSource
  tax: string
  feePaidIn: FeePaidIn
  feeMarket: Market
  feeSymbol: string
  feeQuantity: string
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
  journal: JournalDraft
  reinvest: boolean
  reinvestQuantity: string
  reinvestPrice: string
  reinvestFees: string
}

export interface DraftContext {
  id: string
  createdAt: string
  baseCurrency: string
  today: string
  // The instruments the symbols are looked up in; one that is not among them is created by saving, so its symbol is checked.
  instruments: readonly Instrument[]
}

// A fee paid in another asset is nearly always paid in a coin, such as BNB on an exchange.
const FEE_MARKET: Market = 'CRYPTO'

const INSTRUMENT_TYPES: readonly TxType[] = ['buy', 'sell', 'dividend', 'interest', 'split', 'swap', 'receive_asset']

export function emptyJournalDraft(): JournalDraft {
  return { strategy: '', tags: '', reason: '', emotion: '', confidence: '', stopLoss: '', target: '', review: '', mistakes: [], score: '', checked: [] }
}

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
    unit: 'share',
    toMarket: 'US',
    toSymbol: '',
    toInstrumentName: '',
    toAssetType: 'stock',
    toUnit: 'share',
    toQuantity: '',
    openingKind: 'asset',
    toAccountId: '',
    transferKind: 'asset',
    moveCurrency: '',
    moveRate: '',
    receiveKind: 'stock_dividend',
    currency: MARKET_CURRENCY.US,
    quantity: '',
    price: '',
    amount: '',
    fees: '',
    feesSource: 'auto',
    tax: '',
    feePaidIn: 'cash',
    feeMarket: FEE_MARKET,
    feeSymbol: '',
    feeQuantity: '',
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
    journal: emptyJournalDraft(),
    reinvest: false,
    reinvestQuantity: '',
    reinvestPrice: '',
    reinvestFees: '',
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

export function feePaidInOptions(draft: Draft): readonly FeePaidIn[] {
  switch (draft.type) {
    case 'buy':
    case 'swap':
      return FEE_PAID_IN
    case 'sell':
      return ['cash', 'asset']
    case 'transfer':
      return draft.transferKind === 'asset' ? ['cash', 'received'] : ['cash']
    default:
      return ['cash']
  }
}

// Changing the type or the kind of transfer can leave a way of paying that the draft no longer offers.
export function feePaidInOf(draft: Draft): FeePaidIn {
  return feePaidInOptions(draft).includes(draft.feePaidIn) ? draft.feePaidIn : 'cash'
}

// The select is left out where a unit fee is not plausible, so a share keeps its plain fee and tax row; a draft that
// already pays another way keeps it, so a saved transaction can be edited.
export function showsFeePaidIn(draft: Draft): boolean {
  if (feePaidInOptions(draft).length < 2) return false
  const coin = draft.market === 'CRYPTO' || (draft.type === 'swap' && draft.toMarket === 'CRYPTO')
  return coin || feePaidInOf(draft) !== 'cash'
}

// A transfer of units whose fee comes out of the units moves no money, so it is saved in the base currency without a
// rate. The draft keeps its own currency and rate meanwhile, so leaving this state in any way finds them as they were.
export function movesNoMoney(draft: Draft): boolean {
  return draft.type === 'transfer' && draft.transferKind === 'asset' && feePaidInOf(draft) === 'received'
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
  // A rate borrowed from the dollar belongs to the old day as much as an automatic one does.
  const fetched = draft.fxSource === 'auto' || (draft.fxSource === 'estimated' && !isOpeningAsset(draft))
  return fetched ? { ...next, fxRate: '' } : next
}

// An opening holding's rate means "my average purchase rate", not the day's rate,
// so moving into or out of that meaning starts the rate over.
function restartRate(next: Draft): Draft {
  return isOpeningAsset(next)
    ? { ...next, fxRate: '', fxSource: 'auto' }
    : { ...next, fxRate: next.referenceFxRate, fxSource: 'auto' }
}

// Coins are mostly received as staking rewards and shares as stock dividends.
function defaultReceiveKind(market: Market): ReceiveKind {
  return market === 'CRYPTO' ? 'staking' : 'stock_dividend'
}

function applyType(draft: Draft, type: TxType, baseCurrency: string): Draft {
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
  if (type === 'receive_asset' && draft.type !== type) return { ...changed, receiveKind: defaultReceiveKind(changed.market) }
  if (type !== 'swap') return changed
  // A swap is almost always between coins, so it starts on crypto instead of the market of the last entry.
  const onCrypto =
    changed.market === 'CRYPTO'
      ? changed
      : changeCurrency(
          { ...changed, market: 'CRYPTO', symbol: '', instrumentName: '', assetType: 'crypto', unit: defaultUnit('crypto') },
          MARKET_CURRENCY.CRYPTO,
        )
  return {
    ...onCrypto,
    toMarket: 'CRYPTO',
    toSymbol: '',
    toInstrumentName: '',
    toAssetType: 'crypto',
    toUnit: defaultUnit('crypto'),
    toQuantity: '',
  }
}

export function changeType(draft: Draft, type: TxType, baseCurrency: string): Draft {
  const next = applyType(draft, type, baseCurrency)
  return feePaidInOptions(next).includes(next.feePaidIn) ? next : { ...next, feePaidIn: 'cash', feeQuantity: '' }
}

export function changeOpeningKind(draft: Draft, openingKind: OpeningKind): Draft {
  const next = { ...draft, openingKind }
  return isOpeningAsset(next) !== isOpeningAsset(draft) ? restartRate(next) : next
}

const MARKET_ASSET_TYPE: Partial<Record<Market, AssetType>> = { FUND: 'fund', BOND: 'bond', GOLD: 'gold', CRYPTO: 'crypto' }

function defaultAssetType(market: Market): AssetType {
  return MARKET_ASSET_TYPE[market] ?? 'stock'
}

// The unit goes back to the default of the type, so a unit picked by hand does not outlive the type it was picked for.
export function changeAssetType(draft: Draft, assetType: AssetType): Draft {
  return { ...draft, assetType, unit: defaultUnit(assetType) }
}

export type HeldPosition = Pick<Position, 'accountId' | 'instrumentId' | 'currency'>

export function changeMarket(
  draft: Draft,
  market: Market,
  instruments: readonly Instrument[] = [],
  held: readonly HeldPosition[] = [],
): Draft {
  const lookedUp = findInstrument(instruments, draft.market, draft.symbol) !== undefined
  // A fund, bond, gold or crypto market fixes the type. Leaving one turns the type it gave back into stock, while a type
  // the user picked stays as the market moves between the others.
  const assetType = MARKET_ASSET_TYPE[market] ?? (draft.assetType === MARKET_ASSET_TYPE[draft.market] ? 'stock' : draft.assetType)
  // The kind only follows the market while it is still the one the old market starts with, so a kind the user
  // picked is kept.
  const receiveKind =
    draft.type === 'receive_asset' && draft.receiveKind === defaultReceiveKind(draft.market) ? defaultReceiveKind(market) : draft.receiveKind
  const moved = lookedUp
    ? changeAssetType({ ...draft, market, receiveKind, instrumentName: '' }, defaultAssetType(market))
    : changeAssetType({ ...draft, market, receiveKind }, assetType)
  const switched = changeCurrency(moved, MARKET_CURRENCY[market])
  return draft.symbol ? pickSymbol(switched, draft.symbol, instruments, held) : switched
}

// A coin can be held in a currency other than the one stored for it (a swap or a buy on a second exchange sets its own),
// and a sell or swap of that holding must be in the currency it is held in.
export function pickSymbol(draft: Draft, symbol: string, instruments: readonly Instrument[], held: readonly HeldPosition[] = []): Draft {
  const found = findInstrument(instruments, draft.market, symbol)
  if (found) {
    const holding = held.find((p) => p.accountId === draft.accountId && p.instrumentId === found.id)
    return changeCurrency(
      { ...draft, symbol, instrumentName: found.name, assetType: found.assetType, unit: unitOf(found) },
      holding?.currency ?? found.currency,
    )
  }
  if (findInstrument(instruments, draft.market, draft.symbol)) {
    return changeAssetType({ ...draft, symbol, instrumentName: '' }, defaultAssetType(draft.market))
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
    unit: draft.toUnit,
  })
  return {
    ...draft,
    toMarket: changed.market,
    toSymbol: changed.symbol,
    toInstrumentName: changed.instrumentName,
    toAssetType: changed.assetType,
    toUnit: changed.unit,
  }
}

export function changeToMarket(draft: Draft, market: Market, instruments: readonly Instrument[] = []): Draft {
  return viaMain(draft, (main) => changeMarket(main, market, instruments))
}

export function pickToSymbol(draft: Draft, symbol: string, instruments: readonly Instrument[]): Draft {
  return viaMain(draft, (main) => pickSymbol(main, symbol, instruments))
}

export function changeToAssetType(draft: Draft, assetType: AssetType): Draft {
  return viaMain(draft, (main) => changeAssetType(main, assetType))
}

// An opening holding needs the user's own average purchase rate, so the reference rate is offered but never filled in.
// A borrowed rate is another currency's, so it is an estimate and not an automatic rate of this one.
export function applyReferenceRate(draft: Draft, quote: { rate: string; rateDate: string }, borrowed = false): Draft {
  const next = { ...draft, referenceFxRate: quote.rate, fxRateDate: quote.rateDate }
  if (draft.fxSource === 'manual') return next
  if (draft.fxSource === 'estimated') return { ...next, fxRate: quote.rate }
  if (isOpeningAsset(draft)) return next
  return { ...next, fxRate: quote.rate, fxSource: borrowed ? 'estimated' : 'auto' }
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

// Only a buy or a sell whose fee is paid in cash is priced by the formula, in the currency the formula is for.
export function templateFee(draft: Draft, account: Account | undefined): string | null {
  const template = account?.feeTemplate
  if (!template || (draft.type !== 'buy' && draft.type !== 'sell') || feePaidInOf(draft) !== 'cash') return null
  if (template.currency !== draft.currency) return null
  const quantity = parsedDecimal(draft.quantity)
  const price = parsedDecimal(draft.price)
  if (!quantity || !price || !quantity.greaterThan(0) || !price.greaterThan(0)) return null
  return orderFee(template, quantity.times(price)).toFixed(2)
}

// Run after every draft change: a fee the user did not type follows the account formula.
export function syncFees(draft: Draft, accounts: readonly Account[]): Draft {
  if (draft.feesSource !== 'auto') return draft
  const computed = templateFee(draft, accounts.find((a) => a.id === draft.accountId))
  const fees = computed !== null && D(computed).greaterThan(0) ? computed : ''
  return fees === draft.fees ? draft : { ...draft, fees }
}

// What actually arrives once the fee has taken its units out of the asset received.
export function receivedAfterFee(draft: Draft): string | null {
  if (feePaidInOf(draft) !== 'received') return null
  const received = parsedDecimal(draft.type === 'swap' ? draft.toQuantity : draft.quantity)
  const taken = parsedDecimal(draft.feeQuantity)
  if (!received || !taken || !taken.greaterThan(0) || taken.greaterThanOrEqualTo(received)) return null
  return received.minus(taken).toString()
}

function instrumentFields(
  instrumentId: string | undefined,
  instruments: readonly Instrument[],
): { market: Market; symbol: string; name: string; assetType: AssetType; unit: Unit } {
  const instrument = instruments.find((i) => i.id === instrumentId)
  const separator = instrumentId?.indexOf(':') ?? -1
  const assetType = instrument?.assetType ?? 'stock'
  return {
    market: (instrument?.market ?? (separator > 0 ? instrumentId?.slice(0, separator) : 'US')) as Market,
    symbol: instrument?.symbol ?? (separator > 0 ? (instrumentId?.slice(separator + 1) ?? '') : ''),
    name: instrument?.name ?? '',
    assetType,
    unit: instrument?.unit ?? defaultUnit(assetType),
  }
}

export function draftFromTransaction(tx: Transaction, instruments: readonly Instrument[]): Draft {
  const main = instrumentFields(tx.instrumentId, instruments)
  const received = instrumentFields(tx.toInstrumentId, instruments)
  const fee = instrumentFields(tx.feeInstrumentId, instruments)
  const draft: Draft = {
    type: tx.type,
    accountId: tx.accountId,
    date: tx.date,
    time: tx.time ?? '',
    market: main.market,
    symbol: main.symbol,
    instrumentName: main.name,
    assetType: main.assetType,
    unit: main.unit,
    toMarket: received.market,
    toSymbol: received.symbol,
    toInstrumentName: received.name,
    toAssetType: received.assetType,
    toUnit: received.unit,
    toQuantity: tx.toQuantity ?? '',
    openingKind: tx.type === 'opening' && !tx.instrumentId ? 'cash' : 'asset',
    toAccountId: tx.toAccountId ?? '',
    transferKind: tx.type === 'transfer' && !tx.instrumentId ? 'cash' : 'asset',
    moveCurrency: tx.type === 'transfer' ? (tx.toCurrency ?? '') : '',
    moveRate: tx.type === 'transfer' ? (tx.toFxRate ?? '') : '',
    receiveKind: tx.receiveKind ?? 'stock_dividend',
    currency: tx.currency,
    quantity: tx.quantity ?? '',
    price: tx.price ?? '',
    amount: tx.amount ?? '',
    fees: tx.fees === '0' ? '' : tx.fees,
    feesSource: 'manual',
    tax: tx.tax === '0' ? '' : tx.tax,
    feePaidIn: tx.feePaidIn ?? 'cash',
    feeMarket: tx.feeInstrumentId ? fee.market : FEE_MARKET,
    feeSymbol: fee.symbol,
    feeQuantity: tx.feeQuantity ?? '',
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
    journal: journalToDraft(tx.journal),
    reinvest: false,
    reinvestQuantity: '',
    reinvestPrice: '',
    reinvestFees: '',
  }
  if (tx.type !== 'transfer' || tx.feePaidIn !== 'received') return draft
  // No money moves when the fee comes out of the units, so the transfer is saved in the base currency at rate 1. The
  // asset's own currency is what the form needs back if the fee is switched to cash.
  const currency = instruments.find((i) => i.id === tx.instrumentId)?.currency ?? MARKET_CURRENCY[main.market]
  return { ...draft, currency, fxRate: '', fxSource: 'auto' }
}

// A repeat is for today, so what belonged to the day of the original is dropped: the rate is fetched again, and the
// price and the amount received are what the market gives today. The fee stays as it was (feesSource is manual),
// because the account formula would have no price to work it out from. A repeated trade is the same plan, so its
// strategy and tags stay, while how the first one felt and went does not.
export function duplicateDraft(tx: Transaction, instruments: readonly Instrument[], today: string): Draft {
  const original = draftFromTransaction(tx, instruments)
  const repeated: Draft = {
    ...original,
    journal: { ...emptyJournalDraft(), strategy: original.journal.strategy, tags: original.journal.tags },
    date: today,
    time: '',
    taxYear: today.slice(0, 4),
    fxRate: '',
    fxSource: 'auto',
    fxRateDate: '',
    referenceFxRate: '',
  }
  if (tx.type === 'buy' || tx.type === 'sell') return { ...repeated, price: '' }
  if (tx.type === 'fx_convert') {
    return { ...repeated, toAmount: '', toAmountSource: 'auto', marketRate: '', marketRateDate: '' }
  }
  return repeated
}

// Unparseable input is passed through unchanged so validateTransaction reports it once.
function num(raw: string): string | undefined {
  return raw.trim() === '' ? undefined : (parseDecimalInput(raw) ?? raw.trim())
}

export function journalFromDraft(j: JournalDraft): TradeJournal | undefined {
  const journal: TradeJournal = {}
  const strategy = j.strategy.trim()
  const tags = j.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
  const reason = j.reason.trim()
  const stopLoss = num(j.stopLoss)
  const target = num(j.target)
  const review = j.review.trim()
  if (strategy) journal.strategy = strategy
  if (tags.length > 0) journal.tags = tags
  if (reason) journal.reason = reason
  if (j.emotion) journal.emotion = j.emotion
  if (j.confidence) journal.confidence = Number(j.confidence)
  if (stopLoss !== undefined) journal.stopLoss = stopLoss
  if (target !== undefined) journal.target = target
  if (review) journal.review = review
  if (j.mistakes.length > 0) journal.mistakes = [...j.mistakes]
  if (j.score) journal.score = Number(j.score)
  if (j.checked.length > 0) journal.checked = [...j.checked]
  return Object.keys(journal).length > 0 ? journal : undefined
}

export function journalToDraft(journal?: TradeJournal): JournalDraft {
  return {
    strategy: journal?.strategy ?? '',
    tags: journal?.tags?.join(', ') ?? '',
    reason: journal?.reason ?? '',
    emotion: journal?.emotion ?? '',
    confidence: journal?.confidence?.toString() ?? '',
    stopLoss: journal?.stopLoss ?? '',
    target: journal?.target ?? '',
    review: journal?.review ?? '',
    mistakes: journal?.mistakes ?? [],
    score: journal?.score?.toString() ?? '',
    checked: journal?.checked ?? [],
  }
}

// The review, mistakes and score are written about a trade that is closed, so a buy never carries them. The draft keeps
// the whole journal meanwhile, so a type changed back and forth loses nothing.
function tradeJournal(draft: Draft): TradeJournal | undefined {
  if (draft.type === 'sell') return journalFromDraft(draft.journal)
  if (draft.type === 'buy') return journalFromDraft({ ...draft.journal, review: '', mistakes: [], score: '', checked: [] })
  return undefined
}

// The strategies already used, the ones used most often first, to offer them while a new one is typed.
export function knownStrategies(transactions: readonly Transaction[]): string[] {
  const counts = new Map<string, number>()
  for (const tx of transactions) {
    const strategy = tx.journal?.strategy?.trim()
    if (strategy) counts.set(strategy, (counts.get(strategy) ?? 0) + 1)
  }
  return [...counts].sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b)).map(([name]) => name)
}

export function draftToTransaction(draft: Draft, ctx: DraftContext): { tx: Transaction; errors: string[] } {
  const holding = draft.type === 'buy' || draft.type === 'sell' || isOpeningAsset(draft)
  const isTransfer = draft.type === 'transfer'
  const isSwap = draft.type === 'swap'
  const isReceive = draft.type === 'receive_asset'
  const sendsUnits = isTransfer && draft.transferKind === 'asset'
  const usesAmount = !holding && !sendsUnits && !isReceive && draft.type !== 'split'
  const isConvert = draft.type === 'fx_convert'
  const remit = draft.type === 'withdraw' && draft.remitToThailand
  const feePaidIn = feePaidInOf(draft)
  const unitsOnly = movesNoMoney(draft)
  // A split and a transfer that moves only units move no money, so they never need an exchange rate.
  const noFx = draft.currency === ctx.baseCurrency || draft.type === 'split' || unitsOnly

  const tx: Transaction = {
    id: ctx.id,
    accountId: draft.accountId,
    toAccountId: isTransfer ? draft.toAccountId || undefined : undefined,
    type: draft.type,
    date: draft.date,
    time: draft.time || undefined,
    instrumentId: showsInstrument(draft) && draft.symbol.trim() ? instrumentKey(draft.market, draft.symbol) : undefined,
    toInstrumentId: isSwap && draft.toSymbol.trim() ? instrumentKey(draft.toMarket, draft.toSymbol) : undefined,
    quantity: holding || sendsUnits || isSwap || isReceive ? num(draft.quantity) : undefined,
    toQuantity: isSwap ? num(draft.toQuantity) : undefined,
    price: holding || isReceive ? num(draft.price) : undefined,
    amount: usesAmount ? num(draft.amount) : undefined,
    currency: unitsOnly ? ctx.baseCurrency : draft.currency,
    // An asset received has no fee field, and a fee taken from the units received is counted in units, so a fee
    // typed before the type or the way of paying changed must not come along.
    fees: isReceive || feePaidIn === 'received' ? '0' : (num(draft.fees) ?? '0'),
    tax: num(draft.tax) ?? '0',
    splitRatio: draft.type === 'split' ? num(draft.splitRatio) : undefined,
    receiveKind: isReceive ? draft.receiveKind : undefined,
    feePaidIn: feePaidIn === 'cash' ? undefined : feePaidIn,
    feeInstrumentId: feePaidIn === 'asset' && draft.feeSymbol.trim() ? instrumentKey(draft.feeMarket, draft.feeSymbol) : undefined,
    feeQuantity: feePaidIn === 'cash' ? undefined : num(draft.feeQuantity),
    toCurrency: isConvert ? draft.toCurrency : sendsUnits && draft.moveCurrency ? draft.moveCurrency : undefined,
    toFxRate: sendsUnits && draft.moveCurrency ? num(draft.moveRate) : undefined,
    toAmount: isConvert ? num(draft.toAmount) : undefined,
    marketRate: isConvert ? draft.marketRate || undefined : undefined,
    fxRate: noFx ? '1' : (num(draft.fxRate) ?? ''),
    fxSource: noFx ? 'same' : draft.fxSource,
    fxRateDate: noFx ? undefined : draft.fxRateDate || undefined,
    referenceFxRate: noFx ? undefined : draft.referenceFxRate || undefined,
    remitToThailand: remit ? true : undefined,
    taxYear: remit ? Number.parseInt(draft.taxYear, 10) : undefined,
    journal: tradeJournal(draft),
    note: draft.note.trim(),
    createdAt: ctx.createdAt,
    updatedAt: ctx.createdAt,
  }
  const symbolErrors = [
    ...(tx.instrumentId ? newSymbolErrors(draft.market, draft.symbol, ctx) : []),
    ...(tx.toInstrumentId ? newSymbolErrors(draft.toMarket, draft.toSymbol, ctx) : []),
  ]
  // Without a symbol, validation would take a transfer of units for a transfer of cash and ask for an amount this
  // form does not show. It checks the rest as if an instrument were there, and the missing symbol is reported once.
  if (sendsUnits && !tx.instrumentId) {
    const checked = { ...tx, instrumentId: instrumentKey(draft.market, 'X') }
    return { tx, errors: ['กรุณาระบุหุ้น/สินทรัพย์', ...validateTransaction(checked, ctx.today)] }
  }
  return { tx, errors: [...new Set([...symbolErrors, ...validateTransaction(tx, ctx.today)])] }
}

function newSymbolErrors(market: Market, symbol: string, ctx: DraftContext): string[] {
  return findInstrument(ctx.instruments, market, symbol) ? [] : validateSymbol(symbol)
}

// The buy shares the dividend's account, time, instrument and rate, so the two read as one event. The caller gives it a
// createdAt after the dividend's, so the ledger replays the dividend first.
export function reinvestTransaction(
  draft: Draft,
  dividend: Transaction,
  ctx: { id: string; createdAt: string; today: string },
): { tx: Transaction; errors: string[] } {
  const tx: Transaction = {
    id: ctx.id,
    accountId: dividend.accountId,
    type: 'buy',
    date: dividend.date,
    time: dividend.time,
    instrumentId: dividend.instrumentId,
    quantity: num(draft.reinvestQuantity),
    price: num(draft.reinvestPrice),
    currency: dividend.currency,
    fees: num(draft.reinvestFees) ?? '0',
    tax: '0',
    fxRate: dividend.fxRate,
    fxSource: dividend.fxSource,
    fxRateDate: dividend.fxRateDate,
    referenceFxRate: dividend.referenceFxRate,
    note: '',
    createdAt: ctx.createdAt,
    updatedAt: ctx.createdAt,
  }
  return { tx, errors: validateTransaction(tx, ctx.today) }
}

export function totalForDisplay(tx: Transaction): Decimal | null {
  if (tx.type === 'split') return null
  if (tx.type === 'swap') return D(tx.amount)
  if (tx.type === 'receive_asset') return D(tx.quantity).times(D(tx.price))
  if (tx.type === 'transfer') return tx.instrumentId ? null : D(tx.amount)
  if (tx.type === 'opening' && tx.instrumentId) {
    return D(tx.quantity).times(D(tx.price)).plus(D(tx.fees)).plus(D(tx.tax))
  }
  return cashDeltaQuote(tx).abs()
}

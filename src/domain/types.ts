export const TX_TYPES = [
  'buy',
  'sell',
  'dividend',
  'interest',
  'split',
  'deposit',
  'withdraw',
  'fx_convert',
  'transfer',
  'swap',
  'receive_asset',
  'fee',
  'opening',
] as const
export type TxType = (typeof TX_TYPES)[number]

export const RECEIVE_KINDS = ['stock_dividend', 'staking', 'airdrop', 'coin_interest', 'other'] as const
export type ReceiveKind = (typeof RECEIVE_KINDS)[number]

export const FEE_PAID_IN = ['cash', 'received', 'asset'] as const
export type FeePaidIn = (typeof FEE_PAID_IN)[number]

export const MARKETS = ['US', 'SET', 'FUND', 'BOND', 'GOLD', 'HK', 'JP', 'SG', 'CN', 'EU', 'UK', 'CRYPTO', 'OTHER'] as const
export type Market = (typeof MARKETS)[number]

export const ASSET_TYPES = ['stock', 'etf', 'dr', 'warrant', 'fund', 'bond', 'gold', 'crypto', 'other'] as const
export type AssetType = (typeof ASSET_TYPES)[number]

export const UNITS = ['share', 'unit', 'coin', 'baht_gold', 'gram'] as const
export type Unit = (typeof UNITS)[number]

export const EMOTIONS = ['calm', 'confident', 'fomo', 'fear', 'greed', 'revenge', 'bored'] as const
export type Emotion = (typeof EMOTIONS)[number]

export const MISTAKES = ['chased', 'no_stop', 'oversized', 'sold_early', 'moved_stop'] as const
export type Mistake = (typeof MISTAKES)[number]

// An ETF is counted in units like a fund, although it trades like a share.
export function defaultUnit(assetType: AssetType): Unit {
  switch (assetType) {
    case 'stock':
    case 'dr':
      return 'share'
    case 'crypto':
      return 'coin'
    case 'gold':
      return 'baht_gold'
    default:
      return 'unit'
  }
}

// same = currency equals the base currency, auto = fetched reference rate,
// manual = typed by the user, estimated = reference rate used in place of an unknown purchase rate
export type FxSource = 'same' | 'auto' | 'manual' | 'estimated'

// Decimal strings, empty = 0. minimum and perOrder are in `currency`; a formula only fills the fee of a transaction in
// that currency.
export interface FeeTemplate {
  currency: string
  commissionPct: string
  minimum: string
  vatPct: string
  perOrder: string
}

export interface Account {
  id: string
  name: string
  broker: string
  note: string
  feeTemplate?: FeeTemplate
  createdAt: string
}

export interface Instrument {
  id: string
  market: Market
  symbol: string
  name: string
  assetType: AssetType
  currency: string
  unit?: Unit
  previousSymbols?: string[]
  lastPrice?: string
  lastPriceAt?: string
  holdReason?: string
  targetPrice?: string
  reviewDate?: string
  // The share of the portfolio's value this asset should be, in percent.
  targetPct?: string
  // A Thai tax-saving fund, which has to be held for a set time.
  taxFund?: TaxFund
}

export const TAX_FUNDS = ['SSF', 'RMF', 'THAIESG'] as const
export type TaxFund = (typeof TAX_FUNDS)[number]

export function unitOf(instrument: Pick<Instrument, 'assetType' | 'unit'>): Unit {
  return instrument.unit ?? defaultUnit(instrument.assetType)
}

export interface Thesis {
  holdReason: string
  targetPrice: string
  reviewDate: string
}

// The optional notes of a buy or a sell. stopLoss and target are prices per unit in the currency of the transaction;
// confidence and score are whole numbers from 1 to 5. review, mistakes and score are written about a trade once it is
// closed, so they belong to the sell.
export interface TradeJournal {
  strategy?: string
  tags?: string[]
  reason?: string
  emotion?: Emotion
  confidence?: number
  stopLoss?: string
  target?: string
  review?: string
  mistakes?: Mistake[]
  score?: number
  // The items of the pre-trade checklist that were ticked when the trade was entered.
  checked?: string[]
}

// Amounts are decimal strings in `currency`; fxRate is the value of 1 `currency` in the base currency.
// opening with instrumentId = a holding carried in at average cost (price) and average purchase rate (fxRate);
// opening without instrumentId = a cash balance carried in (amount).
// marketRate (fx_convert only) = market price of 1 toCurrency in `currency` on that date.
// fx_convert: amount is everything that leaves `currency`, fees included; toAmount is what arrives in toCurrency.
// transfer moves a holding (instrumentId, quantity) or cash (amount) from accountId to toAccountId; fees are paid
// from the cash of accountId in `currency`.
// swap gives up quantity of instrumentId for toQuantity of toInstrumentId in the same account; amount is the total
// value of the swap in `currency`, and fees and tax are paid in cash and added to the cost of what is received.
// receive_asset adds quantity of instrumentId that was received as income; price is the value of one unit on that day,
// which is both the cost and the income, and tax is withheld in cash.
// feePaidIn (buy, sell, swap, transfer of units; missing = cash): 'received' takes feeQuantity units out of the asset
// received, so fees stays 0; 'asset' pays feeQuantity of feeInstrumentId, held in the same account and currency, and
// fees is what that is worth in `currency`.
export interface Transaction {
  id: string
  accountId: string
  toAccountId?: string
  type: TxType
  date: string
  time?: string
  instrumentId?: string
  toInstrumentId?: string
  quantity?: string
  toQuantity?: string
  price?: string
  amount?: string
  currency: string
  fees: string
  tax: string
  splitRatio?: string
  receiveKind?: ReceiveKind
  feePaidIn?: FeePaidIn
  feeInstrumentId?: string
  feeQuantity?: string
  toCurrency?: string
  // A transferred holding re-counted in the destination's currency: base currency per 1 unit of toCurrency on the day.
  toFxRate?: string
  toAmount?: string
  marketRate?: string
  fxRate: string
  fxSource: FxSource
  fxRateDate?: string
  referenceFxRate?: string
  remitToThailand?: boolean
  taxYear?: number
  journal?: TradeJournal
  // A buy of new shares through a rights offering (XR), at the subscription price.
  rightsOffer?: boolean
  // A swap that exercises a warrant or right: what is given up passes its cost on to what is received, nothing is
  // realized, and paid is the cash paid to exercise (exercise price × shares), in `currency`.
  exercise?: boolean
  paid?: string
  // Set on every record written by one AI import, so the whole import can be taken back together.
  importBatchId?: string
  note: string
  createdAt: string
  updatedAt: string
}

export const IMPORT_SOURCES = ['portfolio', 'orders', 'income', 'statement', 'other'] as const
export type ImportSource = (typeof IMPORT_SOURCES)[number]

// createdInstrumentIds are the instruments this import added, removed again on undo once nothing else uses them.
export interface ImportBatch {
  id: string
  accountId: string
  source: ImportSource
  fileCount: number
  count: number
  createdInstrumentIds: string[]
  createdAt: string
}

export const PLAN_FREQUENCIES = ['weekly', 'monthly'] as const
export type PlanFrequency = (typeof PLAN_FREQUENCIES)[number]

// A plan to buy amount (in currency) of an asset every week or month from startDate on.
export interface DcaPlan {
  id: string
  accountId: string
  instrumentId: string
  amount: string
  currency: string
  frequency: PlanFrequency
  startDate: string
  createdAt: string
}

export const THEME_CHOICES = ['light', 'dark', 'system'] as const
export type ThemeChoice = (typeof THEME_CHOICES)[number]

export interface Settings {
  baseCurrency: string
  lastBackupAt?: string
  hideNumbersOnLaunch?: boolean
  theme?: ThemeChoice
  // A US symbol (an index fund such as SPY) the portfolio's growth is compared with.
  benchmarkSymbol?: string
  // The user's own pre-trade checklist, offered when a buy is recorded.
  checklist?: string[]
}

export interface WatchItem {
  id: string
  market: Market
  symbol: string
  note: string
  // The price the user would like to buy at, in the asset's currency.
  buyBelow?: string
  createdAt: string
}

// A picture attached to a trade's journal, such as the chart at entry. Pictures stay on the device: they are not in
// the JSON backup.
export interface TradePicture {
  id: string
  txId: string
  name: string
  blob: Blob
  createdAt: string
}

export const DEFAULT_SETTINGS: Settings = { baseCurrency: 'THB' }

export function instrumentKey(market: Market, symbol: string): string {
  return `${market}:${symbol.trim().toUpperCase()}`
}

export function symbolOf(instrumentId: string | undefined): string {
  return instrumentId?.split(':')[1] ?? ''
}

export function findInstrument(instruments: readonly Instrument[], market: Market, symbol: string): Instrument | undefined {
  const id = instrumentKey(market, symbol)
  return instruments.find((i) => i.id === id)
}

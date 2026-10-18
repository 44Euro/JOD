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

export const MARKETS = ['US', 'SET', 'HK', 'JP', 'SG', 'CN', 'EU', 'UK', 'CRYPTO', 'OTHER'] as const
export type Market = (typeof MARKETS)[number]

export const ASSET_TYPES = ['stock', 'etf', 'fund', 'crypto', 'other'] as const
export type AssetType = (typeof ASSET_TYPES)[number]

// same = currency equals the base currency, auto = fetched reference rate,
// manual = typed by the user, estimated = reference rate used in place of an unknown purchase rate
export type FxSource = 'same' | 'auto' | 'manual' | 'estimated'

export interface Account {
  id: string
  name: string
  broker: string
  note: string
  createdAt: string
}

export interface Instrument {
  id: string
  market: Market
  symbol: string
  name: string
  assetType: AssetType
  currency: string
  lastPrice?: string
  lastPriceAt?: string
  holdReason?: string
  targetPrice?: string
  reviewDate?: string
}

export interface Thesis {
  holdReason: string
  targetPrice: string
  reviewDate: string
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
  toAmount?: string
  marketRate?: string
  fxRate: string
  fxSource: FxSource
  fxRateDate?: string
  referenceFxRate?: string
  remitToThailand?: boolean
  taxYear?: number
  note: string
  createdAt: string
  updatedAt: string
}

export interface Settings {
  baseCurrency: string
  lastBackupAt?: string
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

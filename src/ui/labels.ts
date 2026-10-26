import type { ReaderMode } from '../ai/reader'
import type { IncomeKind } from '../domain/ledger'
import type { TradePeriod } from '../domain/tradeStats'
import {
  MARKETS,
  unitOf,
  type AssetType,
  type Emotion,
  type FeePaidIn,
  type FxSource,
  type ImportSource,
  type Instrument,
  type Market,
  type Mistake,
  type ReceiveKind,
  type TxType,
  type Unit,
} from '../domain/types'

export const TX_TYPE_LABELS: Record<TxType, string> = {
  buy: 'ซื้อ',
  sell: 'ขาย',
  dividend: 'ปันผล',
  interest: 'ดอกเบี้ย/คูปอง',
  split: 'แตกพาร์/รวมหุ้น',
  deposit: 'ฝากเงิน',
  withdraw: 'ถอนเงิน',
  fx_convert: 'แลกเงิน',
  transfer: 'โอนระหว่างบัญชี',
  swap: 'แลกเหรียญ',
  receive_asset: 'รับเป็นสินทรัพย์',
  fee: 'ค่าธรรมเนียม',
  opening: 'ยอดยกมา',
}

// The phone row has one line for the asset, the account and the type, so the longest names are shortened there.
export const TX_TYPE_SHORT_LABELS: Partial<Record<TxType, string>> = {
  transfer: 'โอน',
  receive_asset: 'รับสินทรัพย์',
  split: 'แตกพาร์',
  interest: 'ดอกเบี้ย',
  opening: 'ยกมา',
}

// On the page of the asset that only paid the fee of a trade, the row is that payment.
export const FEE_PAID_ROW_LABEL = 'จ่ายค่าธรรมเนียม'

export const PRIMARY_TX_TYPES: readonly TxType[] = ['buy', 'sell', 'dividend', 'interest', 'fx_convert', 'deposit', 'withdraw']
export const MORE_TX_TYPES: readonly TxType[] = ['transfer', 'swap', 'receive_asset', 'split', 'fee', 'opening']

export const RECEIVE_KIND_LABELS: Record<ReceiveKind, string> = {
  stock_dividend: 'ปันผลเป็นหุ้น',
  staking: 'Staking',
  airdrop: 'Airdrop',
  coin_interest: 'ดอกเบี้ยเป็นเหรียญ',
  other: 'อื่นๆ',
}

export const EMOTION_LABELS: Record<Emotion, string> = {
  calm: 'นิ่ง มีแผน',
  confident: 'มั่นใจ',
  fomo: 'FOMO',
  fear: 'กลัว',
  greed: 'โลภ',
  revenge: 'อยากเอาคืน',
  bored: 'เบื่อ',
}

export const MISTAKE_LABELS: Record<Mistake, string> = {
  chased: 'ไล่ราคา',
  no_stop: 'ไม่ตั้ง Stop loss',
  oversized: 'ซื้อเกินแผน',
  sold_early: 'ขายเร็วเกิน',
  moved_stop: 'เลื่อน Stop loss',
}

export const TRADE_PERIOD_LABELS: Record<TradePeriod, string> = { month: 'เดือนนี้', year: 'ปีนี้', all: 'ทั้งหมด' }

export const FEE_PAID_IN_LABELS: Record<FeePaidIn, string> = {
  cash: 'เงินสด',
  received: 'หักจากที่ได้รับ',
  asset: 'สินทรัพย์อื่น',
}

export const MARKET_LABELS: Record<Market, string> = {
  US: 'สหรัฐ (US)',
  SET: 'ไทย (SET)',
  FUND: 'กองทุนรวม (FUND)',
  BOND: 'หุ้นกู้/พันธบัตร (BOND)',
  GOLD: 'ทองคำ (GOLD)',
  HK: 'ฮ่องกง (HK)',
  JP: 'ญี่ปุ่น (JP)',
  SG: 'สิงคโปร์ (SG)',
  CN: 'จีน (CN)',
  EU: 'ยุโรป (EU)',
  UK: 'อังกฤษ (UK)',
  CRYPTO: 'คริปโต',
  OTHER: 'อื่นๆ',
}

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  stock: 'หุ้น',
  etf: 'ETF',
  dr: 'DR',
  warrant: 'วอร์แรนต์/สิทธิ',
  fund: 'กองทุนรวม',
  bond: 'หุ้นกู้/พันธบัตร',
  gold: 'ทองคำ',
  crypto: 'คริปโต',
  other: 'อื่นๆ',
}

export const UNIT_LABELS: Record<Unit, string> = {
  share: 'หุ้น',
  unit: 'หน่วย',
  coin: 'เหรียญ',
  baht_gold: 'บาททองคำ',
  gram: 'กรัม',
}

export function unitLabel(instrument: Instrument | undefined): string {
  return UNIT_LABELS[instrument ? unitOf(instrument) : 'unit']
}

export const FX_SOURCE_LABELS: Record<FxSource, string> = {
  same: '',
  auto: 'อัตโนมัติ',
  manual: 'กรอกเอง',
  estimated: 'ประมาณ',
}

export function marketOf(instrumentId: string): Market {
  const prefix = instrumentId.slice(0, instrumentId.indexOf(':'))
  return (MARKETS as readonly string[]).includes(prefix) ? (prefix as Market) : 'OTHER'
}

export const INCOME_SERIES: Record<IncomeKind, { label: string; className: string }> = {
  dividend: { label: 'ปันผล', className: 'bg-primary' },
  interest: { label: 'ดอกเบี้ย/คูปอง', className: 'bg-income-interest' },
  receive_asset: { label: 'รับเป็นสินทรัพย์', className: 'bg-income-asset' },
}

export const READER_MODE_LABELS: Record<ReaderMode, string> = { local: 'อ่านในเครื่อง (ฟรี)', claude: 'Claude' }

export const IMPORT_SOURCE_LABELS: Record<ImportSource, string> = {
  portfolio: 'รูปหน้าพอร์ต',
  orders: 'ประวัติคำสั่ง',
  income: 'ปันผลและดอกเบี้ย',
  statement: 'statement',
  other: 'ไฟล์',
}

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
import { t } from '../i18n'

export const TX_TYPE_LABELS: Record<TxType, string> = {
  buy: t('ซื้อ'),
  sell: t('ขาย'),
  dividend: t('ปันผล'),
  interest: t('ดอกเบี้ย/คูปอง'),
  split: t('แตกพาร์/รวมหุ้น'),
  deposit: t('ฝากเงิน'),
  withdraw: t('ถอนเงิน'),
  fx_convert: t('แลกเงิน'),
  transfer: t('โอนระหว่างบัญชี'),
  swap: t('แลกเหรียญ'),
  receive_asset: t('รับเป็นสินทรัพย์'),
  fee: t('ค่าธรรมเนียม'),
  opening: t('ยอดยกมา'),
}

// The phone row has one line for the asset, the account and the type, so the longest names are shortened there.
export const TX_TYPE_SHORT_LABELS: Partial<Record<TxType, string>> = {
  transfer: t('โอน'),
  receive_asset: t('รับสินทรัพย์'),
  split: t('แตกพาร์'),
  interest: t('ดอกเบี้ย'),
  opening: t('ยกมา'),
}

// On the page of the asset that only paid the fee of a trade, the row is that payment.
export const FEE_PAID_ROW_LABEL = t('จ่ายค่าธรรมเนียม')

export const PRIMARY_TX_TYPES: readonly TxType[] = ['buy', 'sell', 'dividend', 'interest', 'fx_convert', 'deposit', 'withdraw']
export const MORE_TX_TYPES: readonly TxType[] = ['transfer', 'swap', 'receive_asset', 'split', 'fee', 'opening']

export const RECEIVE_KIND_LABELS: Record<ReceiveKind, string> = {
  stock_dividend: t('ปันผลเป็นหุ้น'),
  staking: 'Staking',
  airdrop: 'Airdrop',
  coin_interest: t('ดอกเบี้ยเป็นเหรียญ'),
  other: t('อื่นๆ'),
}

export const EMOTION_LABELS: Record<Emotion, string> = {
  calm: t('นิ่ง มีแผน'),
  confident: t('มั่นใจ'),
  fomo: 'FOMO',
  fear: t('กลัว'),
  greed: t('โลภ'),
  revenge: t('อยากเอาคืน'),
  bored: t('เบื่อ'),
}

export const MISTAKE_LABELS: Record<Mistake, string> = {
  chased: t('ไล่ราคา'),
  no_stop: t('ไม่ตั้ง Stop loss'),
  oversized: t('ซื้อเกินแผน'),
  sold_early: t('ขายเร็วเกิน'),
  moved_stop: t('เลื่อน Stop loss'),
}

export const TRADE_PERIOD_LABELS: Record<TradePeriod, string> = { month: t('เดือนนี้'), year: t('ปีนี้'), all: t('ทั้งหมด') }

export const FEE_PAID_IN_LABELS: Record<FeePaidIn, string> = {
  cash: t('เงินสด'),
  received: t('หักจากที่ได้รับ'),
  asset: t('สินทรัพย์อื่น'),
}

export const MARKET_LABELS: Record<Market, string> = {
  US: t('สหรัฐ (US)'),
  SET: t('ไทย (SET)'),
  FUND: t('กองทุนรวม (FUND)'),
  BOND: t('หุ้นกู้/พันธบัตร (BOND)'),
  GOLD: t('ทองคำ (GOLD)'),
  HK: t('ฮ่องกง (HK)'),
  JP: t('ญี่ปุ่น (JP)'),
  SG: t('สิงคโปร์ (SG)'),
  CN: t('จีน (CN)'),
  EU: t('ยุโรป (EU)'),
  UK: t('อังกฤษ (UK)'),
  CRYPTO: t('คริปโต'),
  OTHER: t('อื่นๆ'),
}

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  stock: t('หุ้น'),
  etf: 'ETF',
  dr: 'DR',
  warrant: t('วอร์แรนต์/สิทธิ'),
  fund: t('กองทุนรวม'),
  bond: t('หุ้นกู้/พันธบัตร'),
  gold: t('ทองคำ'),
  crypto: t('คริปโต'),
  other: t('อื่นๆ'),
}

export const UNIT_LABELS: Record<Unit, string> = {
  share: t('หุ้น'),
  unit: t('หน่วย'),
  coin: t('เหรียญ'),
  baht_gold: t('บาททองคำ'),
  gram: t('กรัม'),
}

export function unitLabel(instrument: Instrument | undefined): string {
  return UNIT_LABELS[instrument ? unitOf(instrument) : 'unit']
}

export const FX_SOURCE_LABELS: Record<FxSource, string> = {
  same: '',
  auto: t('อัตโนมัติ'),
  manual: t('กรอกเอง'),
  estimated: t('ประมาณ'),
}

export function marketOf(instrumentId: string): Market {
  const prefix = instrumentId.slice(0, instrumentId.indexOf(':'))
  return (MARKETS as readonly string[]).includes(prefix) ? (prefix as Market) : 'OTHER'
}

export const INCOME_SERIES: Record<IncomeKind, { label: string; className: string }> = {
  dividend: { label: t('ปันผล'), className: 'bg-primary' },
  interest: { label: t('ดอกเบี้ย/คูปอง'), className: 'bg-income-interest' },
  receive_asset: { label: t('รับเป็นสินทรัพย์'), className: 'bg-income-asset' },
}

export const READER_MODE_LABELS: Record<ReaderMode, string> = { local: t('อ่านในเครื่อง (ฟรี)'), claude: 'Claude' }

export const IMPORT_SOURCE_LABELS: Record<ImportSource, string> = {
  portfolio: t('รูปหน้าพอร์ต'),
  orders: t('ประวัติคำสั่ง'),
  income: t('ปันผลและดอกเบี้ย'),
  statement: 'statement',
  other: t('ไฟล์'),
}

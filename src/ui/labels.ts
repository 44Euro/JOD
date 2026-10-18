import type { IncomeKind } from '../domain/ledger'
import { MARKETS, type AssetType, type FxSource, type Market, type TxType } from '../domain/types'

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
  fee: 'ค่าธรรมเนียม',
  opening: 'ยอดยกมา',
}

export const PRIMARY_TX_TYPES: readonly TxType[] = ['buy', 'sell', 'dividend', 'interest', 'fx_convert', 'deposit', 'withdraw']
export const MORE_TX_TYPES: readonly TxType[] = ['transfer', 'swap', 'split', 'fee', 'opening']

export const MARKET_LABELS: Record<Market, string> = {
  US: 'สหรัฐ (US)',
  SET: 'ไทย (SET)',
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
  fund: 'กองทุน',
  crypto: 'คริปโต',
  other: 'อื่นๆ',
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

export function symbolOf(instrumentId: string | undefined): string {
  return instrumentId?.split(':')[1] ?? ''
}

export const INCOME_SERIES: Record<IncomeKind, { label: string; className: string }> = {
  dividend: { label: 'ปันผล', className: 'bg-primary' },
  interest: { label: 'ดอกเบี้ย/คูปอง', className: 'bg-income-interest' },
}

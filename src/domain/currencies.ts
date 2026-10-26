import type { Market } from './types'
import { t } from '../i18n'

// Currencies published by the ECB and served by api.frankfurter.dev.
export const AUTO_FX_CURRENCIES = [
  'AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD',
  'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK',
  'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
] as const

export const COMMON_CURRENCIES = ['THB', 'USD', 'HKD', 'JPY', 'SGD', 'CNY', 'EUR', 'GBP', 'VND', 'TWD', 'USDT']

// Stablecoins that follow the US dollar, so the dollar rate stands in for them when they have none of their own.
export const USD_PEGGED = ['USDT', 'USDC']

export const CURRENCY_NAMES: Record<string, string> = {
  THB: t('บาท'),
  USD: t('ดอลลาร์สหรัฐ'),
  HKD: t('ดอลลาร์ฮ่องกง'),
  JPY: t('เยน'),
  SGD: t('ดอลลาร์สิงคโปร์'),
  CNY: t('หยวน'),
  EUR: t('ยูโร'),
  GBP: t('ปอนด์'),
  USDT: t('เทเธอร์'),
  USDC: 'USD Coin',
  VND: t('ดอง'),
  TWD: t('ดอลลาร์ไต้หวัน'),
}

export const CURRENCY_OPTIONS: string[] = [...new Set<string>([...COMMON_CURRENCIES, ...AUTO_FX_CURRENCIES])]

export const MARKET_CURRENCY: Record<Market, string> = {
  US: 'USD',
  SET: 'THB',
  FUND: 'THB',
  BOND: 'THB',
  GOLD: 'THB',
  HK: 'HKD',
  JP: 'JPY',
  SG: 'SGD',
  CN: 'CNY',
  EU: 'EUR',
  UK: 'GBP',
  CRYPTO: 'USD',
  OTHER: 'USD',
}

export function supportsAutoFx(currency: string): boolean {
  return (AUTO_FX_CURRENCIES as readonly string[]).includes(currency)
}

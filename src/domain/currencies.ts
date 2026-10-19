import type { Market } from './types'

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
  THB: 'บาท',
  USD: 'ดอลลาร์สหรัฐ',
  HKD: 'ดอลลาร์ฮ่องกง',
  JPY: 'เยน',
  SGD: 'ดอลลาร์สิงคโปร์',
  CNY: 'หยวน',
  EUR: 'ยูโร',
  GBP: 'ปอนด์',
  USDT: 'เทเธอร์',
  USDC: 'USD Coin',
  VND: 'ดอง',
  TWD: 'ดอลลาร์ไต้หวัน',
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

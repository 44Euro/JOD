import { isDecimalString } from '../domain/decimal'
import type { Instrument } from '../domain/types'
import { timeLimited } from '../fx/frankfurter'

export interface PriceQuote {
  price: string
  // The currency the price is in; it can differ from the instrument's (CoinGecko quotes coins in USD or THB).
  currency: string
}

export interface PriceSource {
  name: string
  covers(instrument: Instrument): boolean
  quote(instrument: Instrument, signal?: AbortSignal): Promise<PriceQuote | null>
}

const TIMEOUT_MS = 8000

async function getJson(fetchFn: typeof fetch, url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const limit = timeLimited(signal, TIMEOUT_MS)
  try {
    const response = await fetchFn(url, { ...init, signal: limit.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    limit.done()
  }
}

// Coin symbols are not unique on CoinGecko, so the common ones are pinned to their ids and the rest go through search,
// which ranks by market size.
const COIN_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', USDT: 'tether', USDC: 'usd-coin', BNB: 'binancecoin', SOL: 'solana', XRP: 'ripple',
  ADA: 'cardano', DOGE: 'dogecoin', TRX: 'tron', DOT: 'polkadot', MATIC: 'matic-network', POL: 'polygon-ecosystem-token',
  LINK: 'chainlink', AVAX: 'avalanche-2', TON: 'the-open-network', KUB: 'bitkub-coin', SHIB: 'shiba-inu', LTC: 'litecoin',
}

export function createCoinGecko(fetchFn: typeof fetch = (i, o) => fetch(i, o), apiKey = ''): PriceSource {
  const headers: Record<string, string> = apiKey ? { 'x-cg-demo-api-key': apiKey } : {}
  const base = 'https://api.coingecko.com/api/v3'
  async function idOf(symbol: string, signal?: AbortSignal): Promise<string | null> {
    if (COIN_IDS[symbol]) return COIN_IDS[symbol]
    const found = (await getJson(fetchFn, `${base}/search?query=${encodeURIComponent(symbol)}`, { headers }, signal)) as {
      coins?: { id: string; symbol: string }[]
    }
    return found.coins?.find((c) => c.symbol.toUpperCase() === symbol)?.id ?? null
  }
  return {
    name: 'CoinGecko',
    covers: (i) => i.market === 'CRYPTO',
    async quote(instrument, signal) {
      const id = await idOf(instrument.symbol, signal)
      if (!id) return null
      const currency = instrument.currency === 'THB' ? 'thb' : 'usd'
      const data = (await getJson(fetchFn, `${base}/simple/price?ids=${id}&vs_currencies=${currency}`, { headers }, signal)) as Record<
        string,
        Record<string, number>
      >
      const price = data[id]?.[currency]
      return typeof price === 'number' && price > 0 ? { price: toPlain(price), currency: currency.toUpperCase() } : null
    },
  }
}

// Finnhub's free plan quotes US shares and ETFs; the key is the user's own.
export function createFinnhub(apiKey: string, fetchFn: typeof fetch = (i, o) => fetch(i, o)): PriceSource {
  return {
    name: 'Finnhub',
    covers: (i) => Boolean(apiKey) && i.market === 'US',
    async quote(instrument, signal) {
      const data = (await getJson(
        fetchFn,
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(instrument.symbol)}&token=${encodeURIComponent(apiKey)}`,
        {},
        signal,
      )) as { c?: number }
      return typeof data.c === 'number' && data.c > 0 ? { price: toPlain(data.c), currency: 'USD' } : null
    },
  }
}

// JSON numbers like 1e-7 would not pass as decimal strings.
export function toPlain(n: number): string {
  const text = n.toFixed(10).replace(/\.?0+$/, '')
  return isDecimalString(text) ? text : '0'
}

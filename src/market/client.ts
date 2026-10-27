import type { AssetType, Market } from '../domain/types'
import { readSync } from '../sync/state'

export interface FoundAsset {
  market: Market
  symbol: string
  name: string
  assetType: AssetType
}

export interface MarketQuote {
  id: string
  price: string
  currency: string
  at: string
  previousClose: string | null
  previousCloseAt: string | null
  source: string
}

export interface NewsItem {
  id: string
  headline: string
  source: string
  url: string
  publishedAt: string
  symbols: string[]
}

export interface EarningsEvent {
  symbol: string
  date: string
  time: 'before' | 'after' | 'during' | null
  epsEstimate: string | null
  epsActual: string | null
}

export interface ChartData {
  id: string
  name: string
  exchange: string
  assetType: 'stock' | 'etf'
  currency: string
  points: { date: string; close: string }[]
}

export interface FinancialPeriod {
  period: string
  end: string
  revenue: string | null
  netIncome: string | null
  freeCashFlow: string | null
}

export interface Financials {
  symbol: string
  name: string
  currency: 'USD'
  shares: string | null
  annual: FinancialPeriod[]
  quarterly: FinancialPeriod[]
}

export interface MarketClient {
  ready(): boolean
  search(query: string, signal?: AbortSignal): Promise<FoundAsset[]>
  quotes(ids: string[], signal?: AbortSignal): Promise<MarketQuote[]>
  news(symbols: string[]): Promise<NewsItem[]>
  earnings(from: string, to: string): Promise<EarningsEvent[]>
  chart(id: string): Promise<ChartData>
  financials(symbol: string): Promise<Financials>
}

// 503 means the server has no news source set up yet, which screens tell apart from a failure.
export class MarketError extends Error {
  name = 'MarketError'
  status: number
  constructor(status: number) {
    super(`market server answered ${status}`)
    this.status = status
  }
}

const NEWS_MEMO = 10 * 60_000
const EARNINGS_MEMO = 60 * 60_000
const CHART_MEMO = 60 * 60_000
const FILINGS_MEMO = 24 * 60 * 60_000

type Where = () => { server: string; token: string } | null

const session: Where = () => {
  const state = readSync()
  return state ? { server: state.server, token: state.token } : null
}

// Market data comes from the JOD sync server, which fetches it for every device; the session token only proves the
// asker is signed in.
export function createMarketClient(where: Where = session, fetchFn: typeof fetch = (i, o) => fetch(i, o), now: () => number = Date.now): MarketClient {
  const searches = new Map<string, Promise<FoundAsset[]>>()
  const memo = new Map<string, { expires: number; value: Promise<Record<string, unknown>> }>()

  async function get(path: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const at = where()
    if (!at) throw new Error('not signed in')
    const res = await fetchFn(at.server.replace(/\/+$/, '') + path, { headers: { authorization: `Bearer ${at.token}` }, signal })
    if (!res.ok) throw new MarketError(res.status)
    return (await res.json()) as Record<string, unknown>
  }

  // Moving between เช้านี้ and ตลาด should not ask again each time; a failure is forgotten so the next visit retries.
  function remembered(path: string, ttl: number): Promise<Record<string, unknown>> {
    const hit = memo.get(path)
    if (hit && hit.expires > now()) return hit.value
    const value = get(path)
    value.catch(() => memo.delete(path))
    memo.set(path, { expires: now() + ttl, value })
    return value
  }

  return {
    ready: () => where() !== null,
    search(query, signal) {
      const key = query.trim().toLowerCase()
      const hit = searches.get(key)
      if (hit) return hit
      const found = get(`/api/market/search?q=${encodeURIComponent(key)}`, signal).then((body) => body.results as FoundAsset[])
      // A failed or cancelled search is asked again next time.
      found.catch(() => searches.delete(key))
      searches.set(key, found)
      return found
    },
    async quotes(ids, signal) {
      return (await get(`/api/market/quotes?ids=${encodeURIComponent(ids.join(','))}`, signal)).quotes as MarketQuote[]
    },
    async news(symbols) {
      const query = symbols.length > 0 ? `?symbols=${encodeURIComponent(symbols.join(','))}` : ''
      return (await remembered(`/api/market/news${query}`, NEWS_MEMO)).news as NewsItem[]
    },
    async earnings(from, to) {
      return (await remembered(`/api/market/earnings?from=${from}&to=${to}`, EARNINGS_MEMO)).earnings as EarningsEvent[]
    },
    async chart(id) {
      return (await remembered(`/api/market/chart?id=${encodeURIComponent(id)}`, CHART_MEMO)).chart as ChartData
    },
    async financials(symbol) {
      return (await remembered(`/api/market/financials?symbol=${encodeURIComponent(symbol)}`, FILINGS_MEMO)).financials as Financials
    },
  }
}

export const marketClient = createMarketClient()

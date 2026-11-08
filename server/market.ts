import { createBigMoney, type BigMoney, type BigMoneyFor } from './bigMoney.ts'
import { nameIndex, type SecCompany } from './edgar.ts'
import { pdfText } from './house.ts'

// Public market data for every device: share prices, charts and asset search from Yahoo, coin search from CoinGecko,
// news and the earnings calendar from Finnhub with the server's own free key, and US filings from SEC under the
// operator's own User-Agent, as SEC's fair-access rules ask. Nothing here knows who asked.

export interface FoundAsset {
  market: 'US' | 'SET' | 'CRYPTO'
  symbol: string
  name: string
  assetType: 'stock' | 'etf' | 'crypto'
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

export interface Market {
  search(query: string): Promise<FoundAsset[]>
  quotes(ids: string[]): Promise<MarketQuote[]>
  // News and the calendar need FINNHUB_API_KEY on the server; without it they are off.
  newsReady: boolean
  news(symbols: string[]): Promise<NewsItem[]>
  earnings(from: string, to: string): Promise<EarningsEvent[]>
  chart(id: string): Promise<ChartData | null>
  // SEC wants the requester named in the User-Agent; without SEC_USER_AGENT the filings are off.
  financialsReady: boolean
  financials(symbol: string): Promise<Financials | null>
  // 13F moves of well-known funds and House members' trades; insiders (Form 4) for one symbol.
  bigMoney(): Promise<BigMoney>
  bigMoneyFor(symbol: string): Promise<BigMoneyFor>
  // Reads the slow sources (House report PDFs, 13F tables) ahead of the first request.
  warmUp(): Promise<void>
}

const QUOTE_TTL = 5 * 60_000
const SEARCH_TTL = 6 * 3_600_000
const NEWS_TTL = 15 * 60_000
const EARNINGS_TTL = 6 * 3_600_000
const NEWS_MAX = 50
// Covers a weekend, so Monday morning still has Friday's company news.
const NEWS_DAYS = 3
const EARNINGS_TIMES: Record<string, EarningsEvent['time']> = { bmo: 'before', amc: 'after', dmh: 'during' }
const CHART_TTL = 3_600_000
const FILINGS_TTL = 24 * 3_600_000
const PERIODS_SHOWN = 5
// Companies have moved between these tags over the years; for a period, the first tag that has it wins.
const REVENUE_TAGS = ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax']
const CACHE_SIZE = 2000
const TIMEOUT_MS = 8000
const US_EXCHANGES = new Set(['NMS', 'NGM', 'NCM', 'NYQ', 'ASE', 'PCX', 'BTS', 'NAS', 'NYS', 'PNK'])
const ASSET_TYPES: Record<string, FoundAsset['assetType']> = { EQUITY: 'stock', ETF: 'etf' }

// Yahoo's daily closes carry float noise (343.9100036621); shares never trade finer than four decimals.
const plain = (n: number) => n.toFixed(4).replace(/\.?0+$/, '')

// Yahoo writes class shares with a dash (BRK-B) where JOD and the brokers use a dot.
function yahooSymbol(id: string): string | null {
  const [market, symbol] = id.split(':')
  if (!symbol) return null
  if (market === 'US') return symbol.replace(/\./g, '-')
  if (market === 'SET') return `${symbol}.BK`
  return null
}

interface Chart {
  meta: {
    currency: string
    regularMarketPrice: number
    regularMarketTime: number
    gmtoffset: number
    longName?: string
    shortName?: string
    fullExchangeName?: string
    exchangeName?: string
    instrumentType?: string
  }
  timestamp?: number[]
  indicators: { quote: { close: (number | null)[] }[] }
}

// The previous close is the last daily close from an earlier exchange day than the price, so a share that has not
// traded yet today compares against the day before yesterday's close, not against itself.
function toQuote(id: string, chart: Chart): MarketQuote | null {
  const { meta } = chart
  if (typeof meta?.regularMarketPrice !== 'number' || meta.regularMarketPrice <= 0) return null
  const dayOf = (s: number) => Math.floor((s + meta.gmtoffset) / 86_400)
  const today = dayOf(meta.regularMarketTime)
  const times = chart.timestamp ?? []
  const closes = chart.indicators?.quote?.[0]?.close ?? []
  let previous = -1
  for (let i = 0; i < times.length; i++) if (dayOf(times[i]) < today && typeof closes[i] === 'number') previous = i
  return {
    id,
    price: plain(meta.regularMarketPrice),
    currency: meta.currency,
    at: new Date(meta.regularMarketTime * 1000).toISOString(),
    previousClose: previous >= 0 ? plain(closes[previous]!) : null,
    previousCloseAt: previous >= 0 ? new Date(times[previous] * 1000).toISOString() : null,
    source: 'Yahoo',
  }
}

interface FinnhubNews {
  id: number
  datetime: number
  headline: string
  source: string
  url: string
  related: string
}

// Only the headline, source and link: JOD never shows the article text or pictures Finnhub passes along.
function toNews(items: FinnhubNews[]): NewsItem[] {
  return items
    .filter((n) => n.url && n.headline)
    .map((n) => ({
      id: String(n.id),
      headline: n.headline,
      source: n.source,
      url: n.url,
      publishedAt: new Date(n.datetime * 1000).toISOString(),
      symbols: (n.related ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    }))
}

type Fact = { frame?: string; val: number; end: string }
type Facts = { entityName?: string; facts?: { dei?: Record<string, { units: Record<string, Fact[]> }>; 'us-gaap'?: Record<string, { units: Record<string, Fact[]> }> } }

function byFrame(gaap: NonNullable<NonNullable<Facts['facts']>['us-gaap']>, tags: string[]): Map<string, Fact> {
  const found = new Map<string, Fact>()
  for (const tag of tags) for (const fact of gaap[tag]?.units.USD ?? []) if (fact.frame && !found.has(fact.frame)) found.set(fact.frame, fact)
  return found
}

// SEC gives every fact ever filed; the page needs five years and five quarters of three lines. Free cash flow is
// operating cash flow less capital spending, and only when both were reported for the same period: 10-Qs report cash
// flow year to date, so most quarters have none.
function toFinancials(symbol: string, body: Facts): Financials | null {
  const gaap = body.facts?.['us-gaap']
  if (!gaap) return null
  const revenue = byFrame(gaap, REVENUE_TAGS)
  const income = byFrame(gaap, ['NetIncomeLoss'])
  const operating = byFrame(gaap, ['NetCashProvidedByUsedInOperatingActivities'])
  const capex = byFrame(gaap, ['PaymentsToAcquirePropertyPlantAndEquipment'])
  if (revenue.size === 0 && income.size === 0) return null
  const periods = (pattern: RegExp): FinancialPeriod[] => {
    const ends = new Map<string, string>()
    for (const facts of [revenue, income]) for (const [frame, fact] of facts) if (pattern.test(frame)) ends.set(frame, fact.end)
    return [...ends]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .slice(-PERIODS_SHOWN)
      .map(([frame, end]) => {
        const cash = operating.get(frame)
        const spent = capex.get(frame)
        return {
          period: frame,
          end,
          revenue: decimal(revenue.get(frame)?.val),
          netIncome: decimal(income.get(frame)?.val),
          freeCashFlow: cash && spent ? plain(cash.val - spent.val) : null,
        }
      })
  }
  const shares = [...(body.facts?.dei?.EntityCommonStockSharesOutstanding?.units.shares ?? [])].sort((a, b) => a.end.localeCompare(b.end)).at(-1)
  return {
    symbol,
    name: body.entityName ?? symbol,
    currency: 'USD',
    shares: shares ? plain(shares.val) : null,
    annual: periods(/^CY\d{4}$/),
    quarterly: periods(/^CY\d{4}Q\d$/),
  }
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const decimal = (n: number | null | undefined) => (typeof n === 'number' ? plain(n) : null)

export interface MarketOptions {
  fetchFn?: typeof fetch
  now?: () => number
  finnhubKey?: string
  secUserAgent?: string
  readPdf?: (pdf: Uint8Array) => Promise<string>
}

export function createMarket({ fetchFn = (i, o) => fetch(i, o), now = Date.now, finnhubKey = '', secUserAgent = '', readPdf = pdfText }: MarketOptions = {}): Market {
  const cache = new Map<string, { expires: number; value: Promise<unknown> }>()

  // Concurrent asks for the same URL share one request; a failure is forgotten at once so the next ask retries. A
  // reducer keeps only what JOD uses, so a large file such as SEC's company facts is not held in memory.
  function cached(
    url: string,
    ttl: number,
    { userAgent = 'Mozilla/5.0', body = 'json', reduce }: { userAgent?: string; body?: 'json' | 'text' | 'bytes'; reduce?: (body: never) => unknown } = {},
  ): Promise<unknown> {
    const hit = cache.get(url)
    if (hit && hit.expires > now()) return hit.value
    cache.delete(url)
    const value = fetchFn(url, { headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(TIMEOUT_MS) }).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`)
      const read = body === 'bytes' ? new Uint8Array(await res.arrayBuffer()) : body === 'text' ? await res.text() : await res.json()
      return reduce ? reduce(read as never) : read
    })
    value.catch(() => cache.delete(url))
    cache.set(url, { expires: now() + ttl, value })
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
    return value
  }

  async function quote(id: string): Promise<MarketQuote | null> {
    const symbol = yahooSymbol(id)
    if (!symbol) return null
    const body = (await cached(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, QUOTE_TTL)) as {
      chart?: { result?: Chart[] }
    }
    const chart = body.chart?.result?.[0]
    return chart ? toQuote(id, chart) : null
  }

  // Yahoo's endpoint is unofficial and sometimes refuses; the operator's Finnhub key covers US shares then.
  async function finnhubQuote(id: string): Promise<MarketQuote | null> {
    if (!finnhubKey || !id.startsWith('US:')) return null
    const body = (await finnhub(`quote?symbol=${encodeURIComponent(id.slice(3))}`, QUOTE_TTL)) as { c?: number; pc?: number; t?: number }
    if (typeof body.c !== 'number' || body.c <= 0 || typeof body.t !== 'number') return null
    return {
      id,
      price: plain(body.c),
      currency: 'USD',
      at: new Date(body.t * 1000).toISOString(),
      previousClose: typeof body.pc === 'number' && body.pc > 0 ? plain(body.pc) : null,
      previousCloseAt: null,
      source: 'Finnhub',
    }
  }

  async function yahooSearch(query: string): Promise<FoundAsset[]> {
    const body = (await cached(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`,
      SEARCH_TTL,
    )) as { quotes?: { symbol: string; exchange: string; quoteType: string; longname?: string; shortname?: string }[] }
    return (body.quotes ?? []).flatMap((q): FoundAsset[] => {
      const assetType = ASSET_TYPES[q.quoteType]
      const name = q.longname ?? q.shortname ?? q.symbol
      if (!assetType) return []
      if (q.exchange === 'SET' && q.symbol.endsWith('.BK')) return [{ market: 'SET', symbol: q.symbol.slice(0, -3), name, assetType }]
      if (US_EXCHANGES.has(q.exchange)) return [{ market: 'US', symbol: q.symbol.replace(/-/g, '.'), name, assetType }]
      return []
    })
  }

  async function coinSearch(query: string): Promise<FoundAsset[]> {
    const body = (await cached(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`, SEARCH_TTL)) as {
      coins?: { symbol: string; name: string }[]
    }
    // CoinGecko also matches inside names (kbank finds blockbank), and lists many tokens under one symbol (a dozen
    // tokenised NVDA); the first of a symbol is the largest by market value, which is the one JOD prices.
    const starts = (text: string) => text.toLowerCase().startsWith(query.toLowerCase())
    const seen = new Set<string>()
    return (body.coins ?? [])
      .filter((c) => (starts(c.symbol) || starts(c.name)) && !seen.has(c.symbol.toUpperCase()) && seen.add(c.symbol.toUpperCase()))
      .slice(0, 8)
      .map((c) => ({ market: 'CRYPTO', symbol: c.symbol.toUpperCase(), name: c.name, assetType: 'crypto' }))
  }

  function finnhub(path: string, ttl: number): Promise<unknown> {
    if (!finnhubKey) return Promise.reject(new Error('FINNHUB_API_KEY is not set'))
    return cached(`https://finnhub.io/api/v1/${path}&token=${encodeURIComponent(finnhubKey)}`, ttl)
  }

  // A story listed under several held symbols is shown once, carrying all of them.
  async function companyNews(symbols: string[]): Promise<NewsItem[]> {
    const range = `from=${isoDay(now() - NEWS_DAYS * 86_400_000)}&to=${isoDay(now())}`
    const lists = await Promise.allSettled(symbols.map((s) => finnhub(`company-news?symbol=${encodeURIComponent(s)}&${range}`, NEWS_TTL)))
    if (lists.every((l) => l.status === 'rejected')) throw (lists[0] as PromiseRejectedResult).reason
    const byUrl = new Map<string, NewsItem>()
    for (const item of lists.flatMap((l) => (l.status === 'fulfilled' ? toNews(l.value as FinnhubNews[]) : []))) {
      const seen = byUrl.get(item.url)
      byUrl.set(item.url, seen ? { ...seen, symbols: [...new Set([...seen.symbols, ...item.symbols])] } : item)
    }
    return [...byUrl.values()]
  }

  // SEC's list of listed companies: ticker to CIK for filings, and names for matching 13F rows to tickers.
  function companies() {
    return cached('https://www.sec.gov/files/company_tickers.json', FILINGS_TTL, {
      userAgent: secUserAgent,
      reduce: (body: Record<string, SecCompany>) => ({ cik: new Map(Object.values(body).map((c) => [c.ticker, c.cik_str])), names: nameIndex(body) }),
    }) as Promise<{ cik: Map<string, number>; names: Map<string, string> }>
  }

  const big = createBigMoney({ get: cached, now, secUserAgent, readPdf, companies })

  async function financials(symbol: string): Promise<Financials | null> {
    if (!secUserAgent) throw new Error('SEC_USER_AGENT is not set')
    // SEC lists class shares with a dash (BRK-B).
    const cik = (await companies()).cik.get(symbol.replace(/\./g, '-'))
    if (!cik) return null
    return (await cached(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`, FILINGS_TTL, {
      userAgent: secUserAgent,
      reduce: (body: Facts) => toFinancials(symbol, body),
    })) as Financials | null
  }

  return {
    newsReady: Boolean(finnhubKey),
    financialsReady: Boolean(secUserAgent),
    financials,
    ...big,
    async chart(id) {
      const symbol = yahooSymbol(id)
      if (!symbol) return null
      const body = (await cached(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d`, CHART_TTL)) as {
        chart?: { result?: Chart[] }
      }
      const chart = body.chart?.result?.[0]
      if (!chart) return null
      const { meta } = chart
      const closes = chart.indicators?.quote?.[0]?.close ?? []
      return {
        id,
        name: meta.longName ?? meta.shortName ?? id.split(':')[1],
        exchange: meta.fullExchangeName ?? meta.exchangeName ?? '',
        assetType: meta.instrumentType === 'ETF' ? 'etf' : 'stock',
        currency: meta.currency,
        points: (chart.timestamp ?? []).flatMap((t, i) => {
          const close = closes[i]
          return typeof close === 'number' ? [{ date: new Date((t + meta.gmtoffset) * 1000).toISOString().slice(0, 10), close: plain(close) }] : []
        }),
      }
    },
    async news(symbols) {
      const items = symbols.length > 0 ? await companyNews(symbols) : toNews((await finnhub('news?category=general', NEWS_TTL)) as FinnhubNews[])
      return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, NEWS_MAX)
    },
    async earnings(from, to) {
      const body = (await finnhub(`calendar/earnings?from=${from}&to=${to}`, EARNINGS_TTL)) as {
        earningsCalendar?: { symbol: string; date: string; hour: string; epsEstimate: number | null; epsActual: number | null }[]
      }
      return (body.earningsCalendar ?? [])
        .map((e) => ({ symbol: e.symbol, date: e.date, time: EARNINGS_TIMES[e.hour] ?? null, epsEstimate: decimal(e.epsEstimate), epsActual: decimal(e.epsActual) }))
        .sort((a, b) => a.date.localeCompare(b.date))
    },
    async search(query) {
      const found = await Promise.allSettled([yahooSearch(query), coinSearch(query)])
      if (found.every((f) => f.status === 'rejected')) throw (found[0] as PromiseRejectedResult).reason
      return found.flatMap((f) => (f.status === 'fulfilled' ? f.value : []))
    },
    async quotes(ids) {
      const quotes = await Promise.all(ids.map(async (id) => (await quote(id).catch(() => null)) ?? finnhubQuote(id).catch(() => null)))
      return quotes.filter((q) => q !== null)
    },
  }
}

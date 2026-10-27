// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createMarket } from './market.ts'

const day = (iso: string) => Date.parse(iso) / 1000

function chart({ closes, times, at, currency = 'THB', offset = 25200 }: { closes: (number | null)[]; times: string[]; at: string; currency?: string; offset?: number }) {
  return {
    chart: {
      result: [
        {
          meta: { currency, regularMarketPrice: closes.at(-1), regularMarketTime: day(at), gmtoffset: offset },
          timestamp: times.map(day),
          indicators: { quote: [{ close: closes }] },
        },
      ],
      error: null,
    },
  }
}

const ptt = chart({
  closes: [41.5, 41.75, 42],
  times: ['2026-10-23T03:00:00Z', '2026-10-24T03:00:00Z', '2026-10-27T03:00:00Z'],
  at: '2026-10-27T09:39:00Z',
})

function fakeFetch(routes: Record<string, unknown>) {
  const urls: string[] = []
  const fetchFn = (async (url: string | URL | Request) => {
    urls.push(String(url))
    const hit = Object.entries(routes).find(([part]) => String(url).includes(part))
    if (!hit) return new Response('{}', { status: 404 })
    return hit[1] === 500 ? new Response('down', { status: 500 }) : new Response(JSON.stringify(hit[1]))
  }) as typeof fetch
  return { fetchFn, urls }
}

describe('market quotes', () => {
  it('quotes a Thai share with the close of the day before as the previous close', async () => {
    const { fetchFn } = fakeFetch({ '/chart/PTT.BK': ptt })
    expect(await createMarket(fetchFn).quotes(['SET:PTT'])).toEqual([
      {
        id: 'SET:PTT',
        price: '42',
        currency: 'THB',
        at: '2026-10-27T09:39:00.000Z',
        previousClose: '41.75',
        previousCloseAt: '2026-10-24T03:00:00.000Z',
        source: 'Yahoo',
      },
    ])
  })

  it('has no previous close for a share with no earlier bar', async () => {
    const listed = chart({ closes: [10.2], times: ['2026-10-27T03:00:00Z'], at: '2026-10-27T09:39:00Z' })
    const { fetchFn } = fakeFetch({ '/chart/NEW.BK': listed })
    const [quote] = await createMarket(fetchFn).quotes(['SET:NEW'])
    expect([quote.price, quote.previousClose, quote.previousCloseAt]).toEqual(['10.2', null, null])
  })

  it('asks Yahoo for BRK-B, rounds away float noise and skips markets it does not cover', async () => {
    const brk = chart({ closes: [469.9999847412109, 472.5], times: ['2026-10-23T13:30:00Z', '2026-10-26T13:30:00Z'], at: '2026-10-26T20:00:00Z', currency: 'USD', offset: -14400 })
    const { fetchFn, urls } = fakeFetch({ '/chart/BRK-B': brk })
    const quotes = await createMarket(fetchFn).quotes(['US:BRK.B', 'FUND:K-USA', 'CRYPTO:BTC'])
    expect(quotes.map((q) => [q.id, q.price, q.previousClose])).toEqual([['US:BRK.B', '472.5', '470']])
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('/chart/BRK-B?')
  })

  it('serves a quote from memory for five minutes', async () => {
    const { fetchFn, urls } = fakeFetch({ '/chart/PTT.BK': ptt })
    let now = 0
    const market = createMarket(fetchFn, () => now)
    await market.quotes(['SET:PTT'])
    now = 4 * 60_000
    await market.quotes(['SET:PTT'])
    expect(urls).toHaveLength(1)
    now = 6 * 60_000
    await market.quotes(['SET:PTT'])
    expect(urls).toHaveLength(2)
  })
})

describe('market search', () => {
  const yahoo = {
    quotes: [
      { symbol: 'KBANK.BK', exchange: 'SET', quoteType: 'EQUITY', longname: 'Kasikornbank Public Company Limited', shortname: 'KBANK_KASIKORNBANK' },
      { symbol: 'BRK-B', exchange: 'NYQ', quoteType: 'EQUITY', shortname: 'Berkshire Hathaway Inc. New' },
      { symbol: 'SPY', exchange: 'PCX', quoteType: 'ETF', longname: 'SPDR S&P 500 ETF Trust' },
      { symbol: '0P0000XYZ', exchange: 'MUN', quoteType: 'MUTUALFUND', longname: 'Some fund' },
      { symbol: '7203.T', exchange: 'TYO', quoteType: 'EQUITY', longname: 'Toyota Motor Corporation' },
    ],
  }
  const gecko = {
    coins: [
      { id: 'bitkub-coin', symbol: 'kub', name: 'Bitkub Coin' },
      { id: 'blockbank', symbol: 'bbank', name: 'blockbank' },
      { id: 'kub-wrapped', symbol: 'KUB', name: 'KUB (Wrapped)' },
    ],
  }

  it('searches US and Thai shares and the coins whose symbol or name starts with the query, one per symbol', async () => {
    const { fetchFn } = fakeFetch({ 'finance/search?q=k': yahoo, 'search?query=k': gecko })
    expect(await createMarket(fetchFn).search('k')).toEqual([
      { market: 'SET', symbol: 'KBANK', name: 'Kasikornbank Public Company Limited', assetType: 'stock' },
      { market: 'US', symbol: 'BRK.B', name: 'Berkshire Hathaway Inc. New', assetType: 'stock' },
      { market: 'US', symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', assetType: 'etf' },
      { market: 'CRYPTO', symbol: 'KUB', name: 'Bitkub Coin', assetType: 'crypto' },
    ])
  })

  it('still searches when one source fails', async () => {
    const { fetchFn } = fakeFetch({ 'finance/search?q=k': yahoo, 'search?query=k': 500 })
    expect((await createMarket(fetchFn).search('k')).map((f) => f.symbol)).toEqual(['KBANK', 'BRK.B', 'SPY'])
    const down = fakeFetch({ 'finance/search?q=k': 500, 'search?query=k': 500 })
    await expect(createMarket(down.fetchFn).search('k')).rejects.toThrow()
  })
})

describe('market news and earnings', () => {
  const now = () => Date.parse('2026-10-27T10:00:00Z')
  const story = (id: number, url: string, related = '', at = '2026-10-27T08:00:00Z') => ({
    id,
    datetime: day(at),
    headline: `Story ${id}`,
    source: 'Reuters',
    url,
    related,
    summary: 'Text JOD must not copy',
    image: 'https://img.test/x.jpg',
    category: 'company',
  })

  it('reads the general news newest first without article text', async () => {
    const { fetchFn, urls } = fakeFetch({
      'news?category=general': [story(1, 'https://a.test/1', 'AAPL,MSFT', '2026-10-27T07:00:00Z'), story(2, ''), story(3, 'https://a.test/3', '', '2026-10-27T09:00:00Z')],
    })
    const news = await createMarket(fetchFn, now, 'key').news([])
    expect(news).toEqual([
      { id: '3', headline: 'Story 3', source: 'Reuters', url: 'https://a.test/3', publishedAt: '2026-10-27T09:00:00.000Z', symbols: [] },
      { id: '1', headline: 'Story 1', source: 'Reuters', url: 'https://a.test/1', publishedAt: '2026-10-27T07:00:00.000Z', symbols: ['AAPL', 'MSFT'] },
    ])
    expect(urls[0]).toContain('token=key')
  })

  it('merges the news of several symbols once per story', async () => {
    const { fetchFn, urls } = fakeFetch({
      'company-news?symbol=AAPL': [story(1, 'https://a.test/both', 'AAPL'), story(2, 'https://a.test/aapl', 'AAPL', '2026-10-26T08:00:00Z')],
      'company-news?symbol=NVDA': [story(9, 'https://a.test/both', 'NVDA')],
    })
    const news = await createMarket(fetchFn, now, 'key').news(['AAPL', 'NVDA'])
    expect(news.map((n) => n.url)).toEqual(['https://a.test/both', 'https://a.test/aapl'])
    expect(urls[0]).toContain('from=2026-10-24&to=2026-10-27')
  })

  it("keeps the other symbols' news when one fails", async () => {
    const { fetchFn } = fakeFetch({ 'company-news?symbol=AAPL': [story(1, 'https://a.test/1', 'AAPL')], 'company-news?symbol=NVDA': 500 })
    expect((await createMarket(fetchFn, now, 'key').news(['AAPL', 'NVDA'])).map((n) => n.id)).toEqual(['1'])
  })

  it('reads the earnings calendar', async () => {
    const row = (symbol: string, hour: string, epsEstimate: number | null, epsActual: number | null = null) => ({
      symbol,
      date: '2026-10-28',
      hour,
      epsEstimate,
      epsActual,
      revenueEstimate: 1e9,
      revenueActual: null,
      quarter: 3,
      year: 2026,
    })
    const { fetchFn, urls } = fakeFetch({
      'calendar/earnings?from=2026-10-26&to=2026-10-30': { earningsCalendar: [row('AAPL', 'amc', 1.6), row('KO', 'bmo', 0.7, 0.71), row('X', 'dmh', null), row('Y', '', 0.1)] },
    })
    expect(await createMarket(fetchFn, now, 'key').earnings('2026-10-26', '2026-10-30')).toEqual([
      { symbol: 'AAPL', date: '2026-10-28', time: 'after', epsEstimate: '1.6', epsActual: null },
      { symbol: 'KO', date: '2026-10-28', time: 'before', epsEstimate: '0.7', epsActual: '0.71' },
      { symbol: 'X', date: '2026-10-28', time: 'during', epsEstimate: null, epsActual: null },
      { symbol: 'Y', date: '2026-10-28', time: null, epsEstimate: '0.1', epsActual: null },
    ])
    expect(urls[0]).toContain('token=key')
  })

  it('is not ready without a key and asks nothing', async () => {
    const { fetchFn, urls } = fakeFetch({})
    const market = createMarket(fetchFn, now)
    expect([market.newsReady, createMarket(fetchFn, now, 'key').newsReady]).toEqual([false, true])
    await expect(market.news([])).rejects.toThrow()
    await expect(market.earnings('2026-10-26', '2026-10-30')).rejects.toThrow()
    expect(urls).toHaveLength(0)
  })
})

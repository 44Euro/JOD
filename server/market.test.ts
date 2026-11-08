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
    expect(await createMarket({ fetchFn }).quotes(['SET:PTT'])).toEqual([
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

  it("falls back to Finnhub with the server's key when Yahoo has no US quote", async () => {
    const { fetchFn, urls } = fakeFetch({ '/chart/AAPL': 500, 'finnhub.io/api/v1/quote?symbol=AAPL': { c: 338.32, pc: 344.6, t: 1793736000 } })
    expect(await createMarket({ fetchFn, finnhubKey: 'fh' }).quotes(['US:AAPL'])).toEqual([
      { id: 'US:AAPL', price: '338.32', currency: 'USD', at: '2026-11-03T20:00:00.000Z', previousClose: '344.6', previousCloseAt: null, source: 'Finnhub' },
    ])
    expect(urls[1]).toContain('token=fh')
    expect((await createMarket({ fetchFn: fakeFetch({ '/chart/AAPL': 500 }).fetchFn }).quotes(['US:AAPL']))).toEqual([])
  })

  it('has no previous close for a share with no earlier bar', async () => {
    const listed = chart({ closes: [10.2], times: ['2026-10-27T03:00:00Z'], at: '2026-10-27T09:39:00Z' })
    const { fetchFn } = fakeFetch({ '/chart/NEW.BK': listed })
    const [quote] = await createMarket({ fetchFn }).quotes(['SET:NEW'])
    expect([quote.price, quote.previousClose, quote.previousCloseAt]).toEqual(['10.2', null, null])
  })

  it('asks Yahoo for BRK-B, rounds away float noise and skips markets it does not cover', async () => {
    const brk = chart({ closes: [469.9999847412109, 472.5], times: ['2026-10-23T13:30:00Z', '2026-10-26T13:30:00Z'], at: '2026-10-26T20:00:00Z', currency: 'USD', offset: -14400 })
    const { fetchFn, urls } = fakeFetch({ '/chart/BRK-B': brk })
    const quotes = await createMarket({ fetchFn }).quotes(['US:BRK.B', 'FUND:K-USA', 'CRYPTO:BTC'])
    expect(quotes.map((q) => [q.id, q.price, q.previousClose])).toEqual([['US:BRK.B', '472.5', '470']])
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('/chart/BRK-B?')
  })

  it('serves a quote from memory for five minutes', async () => {
    const { fetchFn, urls } = fakeFetch({ '/chart/PTT.BK': ptt })
    let now = 0
    const market = createMarket({ fetchFn, now: () => now })
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
    expect(await createMarket({ fetchFn }).search('k')).toEqual([
      { market: 'SET', symbol: 'KBANK', name: 'Kasikornbank Public Company Limited', assetType: 'stock' },
      { market: 'US', symbol: 'BRK.B', name: 'Berkshire Hathaway Inc. New', assetType: 'stock' },
      { market: 'US', symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', assetType: 'etf' },
      { market: 'CRYPTO', symbol: 'KUB', name: 'Bitkub Coin', assetType: 'crypto' },
    ])
  })

  it('still searches when one source fails', async () => {
    const { fetchFn } = fakeFetch({ 'finance/search?q=k': yahoo, 'search?query=k': 500 })
    expect((await createMarket({ fetchFn }).search('k')).map((f) => f.symbol)).toEqual(['KBANK', 'BRK.B', 'SPY'])
    const down = fakeFetch({ 'finance/search?q=k': 500, 'search?query=k': 500 })
    await expect(createMarket({ fetchFn: down.fetchFn }).search('k')).rejects.toThrow()
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
    const news = await createMarket({ fetchFn, now, finnhubKey: 'key' }).news([])
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
    const news = await createMarket({ fetchFn, now, finnhubKey: 'key' }).news(['AAPL', 'NVDA'])
    expect(news.map((n) => n.url)).toEqual(['https://a.test/both', 'https://a.test/aapl'])
    expect(urls[0]).toContain('from=2026-10-24&to=2026-10-27')
  })

  it("keeps the other symbols' news when one fails", async () => {
    const { fetchFn } = fakeFetch({ 'company-news?symbol=AAPL': [story(1, 'https://a.test/1', 'AAPL')], 'company-news?symbol=NVDA': 500 })
    expect((await createMarket({ fetchFn, now, finnhubKey: 'key' }).news(['AAPL', 'NVDA'])).map((n) => n.id)).toEqual(['1'])
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
    expect(await createMarket({ fetchFn, now, finnhubKey: 'key' }).earnings('2026-10-26', '2026-10-30')).toEqual([
      { symbol: 'AAPL', date: '2026-10-28', time: 'after', epsEstimate: '1.6', epsActual: null },
      { symbol: 'KO', date: '2026-10-28', time: 'before', epsEstimate: '0.7', epsActual: '0.71' },
      { symbol: 'X', date: '2026-10-28', time: 'during', epsEstimate: null, epsActual: null },
      { symbol: 'Y', date: '2026-10-28', time: null, epsEstimate: '0.1', epsActual: null },
    ])
    expect(urls[0]).toContain('token=key')
  })

  it('is not ready without a key and asks nothing', async () => {
    const { fetchFn, urls } = fakeFetch({})
    const market = createMarket({ fetchFn, now })
    expect([market.newsReady, createMarket({ fetchFn, now, finnhubKey: 'key' }).newsReady]).toEqual([false, true])
    await expect(market.news([])).rejects.toThrow()
    await expect(market.earnings('2026-10-26', '2026-10-30')).rejects.toThrow()
    expect(urls).toHaveLength(0)
  })
})

describe('market charts', () => {
  const appleChart = {
    chart: {
      result: [
        {
          meta: { currency: 'USD', longName: 'Apple Inc.', shortName: 'Apple', fullExchangeName: 'NasdaqGS', instrumentType: 'EQUITY', gmtoffset: -14400, regularMarketPrice: 346.05, regularMarketTime: day('2026-10-27T20:00:00Z') },
          timestamp: ['2026-10-23T13:30:00Z', '2026-10-26T13:30:00Z', '2026-10-27T13:30:00Z'].map(day),
          indicators: { quote: [{ close: [340.1000061035, null, 346.05] }] },
        },
      ],
    },
  }

  it('gives six months of closes with the name and exchange', async () => {
    const { fetchFn, urls } = fakeFetch({ '/chart/AAPL?range=6mo': appleChart })
    expect(await createMarket({ fetchFn }).chart('US:AAPL')).toEqual({
      id: 'US:AAPL',
      name: 'Apple Inc.',
      exchange: 'NasdaqGS',
      assetType: 'stock',
      currency: 'USD',
      points: [
        { date: '2026-10-23', close: '340.1' },
        { date: '2026-10-27', close: '346.05' },
      ],
    })
    expect(urls[0]).toContain('interval=1d')
  })

  it('has no chart for markets Yahoo is not asked about', async () => {
    const { fetchFn, urls } = fakeFetch({})
    expect(await createMarket({ fetchFn }).chart('CRYPTO:BTC')).toBeNull()
    expect(urls).toHaveLength(0)
  })
})

describe('SEC financials', () => {
  const tickers = { '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, '1': { cik_str: 1067983, ticker: 'BRK-B', title: 'BERKSHIRE HATHAWAY INC' } }
  const year = (y: number, val: number) => ({ frame: `CY${y}`, val, end: `${y}-09-27`, form: '10-K' })
  const quarter = (q: string, val: number, end: string) => ({ frame: `CY${q}`, val, end, form: '10-Q' })
  const facts = {
    cik: 320193,
    entityName: 'Apple Inc.',
    facts: {
      dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: '2026-04-17', val: 14687356000, frame: 'CY2026Q1I' }, { end: '2026-07-17', val: 14594180000, frame: 'CY2026Q2I' }] } } },
      'us-gaap': {
        SalesRevenueNet: { units: { USD: [year(2019, 260e9), year(2020, 274e9)] } },
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [
              year(2021, 365e9), year(2022, 394e9), year(2023, 383e9), year(2024, 391e9), year(2025, 416e9),
              quarter('2025Q2', 94e9, '2025-06-28'), quarter('2025Q3', 102e9, '2025-09-27'), quarter('2025Q4', 143e9, '2025-12-27'), quarter('2026Q1', 111e9, '2026-03-28'), quarter('2026Q2', 109e9, '2026-06-27'), quarter('2025Q1', 95e9, '2025-03-29'),
              { val: 1, end: '2026-06-27', form: '10-Q' },
            ],
          },
        },
        NetIncomeLoss: { units: { USD: [year(2021, 94e9), year(2022, 99e9), year(2023, 97e9), year(2024, 93e9), year(2025, 112e9), quarter('2026Q2', 29e9, '2026-06-27')] } },
        NetCashProvidedByUsedInOperatingActivities: { units: { USD: [year(2021, 104e9), year(2022, 122e9), year(2023, 110e9), year(2024, 118e9), year(2025, 111e9), quarter('2025Q4', 54e9, '2025-12-27')] } },
        PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: [year(2021, 11e9), year(2023, 11e9), year(2024, 9e9), year(2025, 13e9), quarter('2025Q4', 2e9, '2025-12-27')] } },
      },
    },
  }
  const ua = 'JOD Test operator@example.test'

  it('reduces company facts to five years and five quarters', async () => {
    const { fetchFn } = fakeFetch({ 'company_tickers.json': tickers, 'CIK0000320193.json': facts })
    const result = await createMarket({ fetchFn, secUserAgent: ua }).financials('AAPL')
    expect(result?.name).toBe('Apple Inc.')
    expect(result?.shares).toBe('14594180000')
    expect(result?.annual.map((p) => [p.period, p.revenue, p.netIncome])).toEqual([
      ['CY2021', '365000000000', '94000000000'],
      ['CY2022', '394000000000', '99000000000'],
      ['CY2023', '383000000000', '97000000000'],
      ['CY2024', '391000000000', '93000000000'],
      ['CY2025', '416000000000', '112000000000'],
    ])
    expect(result?.annual.at(-1)).toMatchObject({ end: '2025-09-27', freeCashFlow: '98000000000' })
    expect(result?.quarterly.map((p) => p.period)).toEqual(['CY2025Q2', 'CY2025Q3', 'CY2025Q4', 'CY2026Q1', 'CY2026Q2'])
    expect(result?.quarterly.find((p) => p.period === 'CY2025Q4')?.freeCashFlow).toBe('52000000000')
    expect(result?.quarterly.find((p) => p.period === 'CY2026Q2')).toMatchObject({ netIncome: '29000000000', freeCashFlow: null })
  })

  it('leaves free cash flow blank without both cash-flow facts', async () => {
    const { fetchFn } = fakeFetch({ 'company_tickers.json': tickers, 'CIK0000320193.json': facts })
    const result = await createMarket({ fetchFn, secUserAgent: ua }).financials('AAPL')
    expect(result?.annual.find((p) => p.period === 'CY2022')?.freeCashFlow).toBeNull()
  })

  it('finds the CIK of BRK.B as BRK-B, and nothing for a symbol SEC does not list', async () => {
    const { fetchFn, urls } = fakeFetch({ 'company_tickers.json': tickers, 'CIK0001067983.json': { ...facts, entityName: 'Berkshire' } })
    const market = createMarket({ fetchFn, secUserAgent: ua })
    expect((await market.financials('BRK.B'))?.name).toBe('Berkshire')
    expect(await market.financials('NOPE')).toBeNull()
    expect(urls.filter((u) => u.includes('company_tickers'))).toHaveLength(1)
  })

  it('is off without an SEC user agent and asks nothing', async () => {
    const { fetchFn, urls } = fakeFetch({})
    const market = createMarket({ fetchFn })
    expect([market.financialsReady, createMarket({ fetchFn, secUserAgent: ua }).financialsReady]).toEqual([false, true])
    await expect(market.financials('AAPL')).rejects.toThrow()
    expect(urls).toHaveLength(0)
  })

  it("sends the operator's user agent to SEC", async () => {
    const agents: (string | null)[] = []
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      agents.push(new Headers(init?.headers).get('user-agent'))
      return new Response(JSON.stringify(String(url).includes('company_tickers') ? tickers : facts))
    }) as typeof fetch
    await createMarket({ fetchFn, secUserAgent: ua }).financials('AAPL')
    expect(agents).toEqual([ua, ua])
  })
})

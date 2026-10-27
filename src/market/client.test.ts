import { describe, expect, it } from 'vitest'
import { MarketError, createMarketClient } from './client'

function fakeServer(body: unknown) {
  const calls: { url: string; auth: string | null }[] = []
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') })
    return new Response(JSON.stringify(body))
  }) as typeof fetch
  return { fetchFn, calls }
}

const signedIn = () => ({ server: 'http://jod.test/', token: 'tok' })

describe('market client', () => {
  it('sends the session token and reads quotes and results', async () => {
    const quote = { id: 'SET:PTT', price: '42', currency: 'THB', at: '2026-10-27T09:39:00.000Z', previousClose: '41.75', previousCloseAt: null, source: 'Yahoo' }
    const quotes = fakeServer({ quotes: [quote] })
    const client = createMarketClient(signedIn, quotes.fetchFn)
    expect(client.ready()).toBe(true)
    expect(await client.quotes(['SET:PTT', 'US:BRK.B'])).toEqual([quote])
    expect(quotes.calls[0]).toEqual({ url: 'http://jod.test/api/market/quotes?ids=SET%3APTT%2CUS%3ABRK.B', auth: 'Bearer tok' })

    const found = { market: 'SET', symbol: 'KBANK', name: 'Kasikornbank', assetType: 'stock' }
    const search = fakeServer({ results: [found] })
    expect(await createMarketClient(signedIn, search.fetchFn).search('kbank')).toEqual([found])
    expect(search.calls[0].url).toBe('http://jod.test/api/market/search?q=kbank')
  })

  it('is not ready and asks nothing while signed out', async () => {
    const { fetchFn, calls } = fakeServer({ results: [] })
    const client = createMarketClient(() => null, fetchFn)
    expect(client.ready()).toBe(false)
    await expect(client.search('kbank')).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })

  it('asks the server once per query in a session', async () => {
    const { fetchFn, calls } = fakeServer({ results: [] })
    const client = createMarketClient(signedIn, fetchFn)
    await client.search('kbank')
    await client.search(' KBank ')
    expect(calls).toHaveLength(1)
  })

  it('says the server refused', async () => {
    const fetchFn = (async () => new Response('{"error":"sign in"}', { status: 401 })) as typeof fetch
    await expect(createMarketClient(signedIn, fetchFn).quotes(['SET:PTT'])).rejects.toThrow('401')
  })

  it('asks for news of held symbols and the earnings range', async () => {
    const news = fakeServer({ news: [{ id: '1', headline: 'H', source: 'Reuters', url: 'https://a.test', publishedAt: '2026-10-27T08:00:00.000Z', symbols: ['AAPL'] }] })
    const client = createMarketClient(signedIn, news.fetchFn)
    expect((await client.news(['AAPL', 'BRK.B']))[0].headline).toBe('H')
    expect(news.calls[0].url).toBe('http://jod.test/api/market/news?symbols=AAPL%2CBRK.B')
    const earnings = fakeServer({ earnings: [{ symbol: 'AAPL', date: '2026-10-28', time: 'after', epsEstimate: '1.6', epsActual: null }] })
    expect(await createMarketClient(signedIn, earnings.fetchFn).earnings('2026-10-26', '2026-10-30')).toHaveLength(1)
    expect(earnings.calls[0].url).toBe('http://jod.test/api/market/earnings?from=2026-10-26&to=2026-10-30')
  })

  it('remembers news for ten minutes', async () => {
    const { fetchFn, calls } = fakeServer({ news: [] })
    let now = 0
    const client = createMarketClient(signedIn, fetchFn, () => now)
    await client.news([])
    now = 9 * 60_000
    await client.news([])
    expect(calls).toHaveLength(1)
    now = 11 * 60_000
    await client.news([])
    expect(calls).toHaveLength(2)
  })

  it('gives the status of a refused call', async () => {
    const fetchFn = (async () => new Response('{"error":"news source not set"}', { status: 503 })) as typeof fetch
    const error = await createMarketClient(signedIn, fetchFn).news([]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MarketError)
    expect((error as MarketError).status).toBe(503)
  })
})


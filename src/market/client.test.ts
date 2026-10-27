import { describe, expect, it } from 'vitest'
import { createMarketClient } from './client'

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
})

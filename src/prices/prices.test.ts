import { beforeEach, describe, expect, it } from 'vitest'
import { createDb, type JodDB } from '../db/db'
import type { Instrument } from '../domain/types'
import type { MarketClient } from '../market/client'
import { createCoinGecko, createFinnhub, createJodServer, toPlain, type PriceSource } from './providers'
import { describeUpdate, runPriceUpdate } from './run'
import { updatePrices } from './update'

function jsonFetch(routes: Record<string, unknown>) {
  const urls: string[] = []
  const fetchFn = (async (url: RequestInfo | URL) => {
    urls.push(String(url))
    const hit = Object.entries(routes).find(([part]) => String(url).includes(part))
    return hit ? new Response(JSON.stringify(hit[1])) : new Response('{}', { status: 404 })
  }) as typeof fetch
  return { fetchFn, urls }
}

const coin = (symbol: string, currency = 'USD'): Instrument => ({ id: `CRYPTO:${symbol}`, market: 'CRYPTO', symbol, name: symbol, assetType: 'crypto', currency })
const stock = (symbol: string, market: Instrument['market'] = 'US', currency = 'USD'): Instrument => ({ id: `${market}:${symbol}`, market, symbol, name: symbol, assetType: 'stock', currency })

let db: JodDB
beforeEach(async () => {
  db = createDb(`test-${crypto.randomUUID()}`)
})

describe('price sources', () => {
  it('quotes a known coin by its pinned id and finds others through search', async () => {
    const { fetchFn, urls } = jsonFetch({
      'simple/price?ids=bitcoin&vs_currencies=thb': { bitcoin: { thb: 2150000.5 } },
      'search?query=PEPE': { coins: [{ id: 'pepe', symbol: 'pepe' }] },
      'simple/price?ids=pepe': { pepe: { usd: 0.0000123 } },
    })
    const gecko = createCoinGecko(fetchFn)
    expect(await gecko.quote(coin('BTC', 'THB'))).toEqual({ price: '2150000.5', currency: 'THB' })
    expect(await gecko.quote(coin('PEPE'))).toEqual({ price: '0.0000123', currency: 'USD' })
    expect(urls.some((u) => u.includes('search?query=BTC'))).toBe(false)
  })

  it('covers US shares only when the user has a Finnhub key', async () => {
    const { fetchFn, urls } = jsonFetch({ 'quote?symbol=AAPL': { c: 231.42 } })
    expect(createFinnhub('', fetchFn).covers(stock('AAPL'))).toBe(false)
    const finnhub = createFinnhub('my-key', fetchFn)
    expect(finnhub.covers(stock('PTT', 'SET', 'THB'))).toBe(false)
    expect(await finnhub.quote(stock('AAPL'))).toEqual({ price: '231.42', currency: 'USD' })
    expect(urls[0]).toContain('token=my-key')
  })

  it('quotes US and Thai shares through the JOD server with the time and previous close', async () => {
    const asked: string[][] = []
    const market: MarketClient = {
      ready: () => true,
      search: async () => [],
      quotes: async (ids) => {
        asked.push(ids)
        return [{ id: 'SET:PTT', price: '42', currency: 'THB', at: '2026-10-27T09:39:00.000Z', previousClose: '41.75', previousCloseAt: '2026-10-24T03:00:00.000Z', source: 'Yahoo' }]
      },
    }
    const server = createJodServer(market)
    expect([server.covers(stock('AAPL')), server.covers(stock('PTT', 'SET', 'THB')), server.covers(coin('BTC'))]).toEqual([true, true, false])
    expect(createJodServer({ ...market, ready: () => false }).covers(stock('AAPL'))).toBe(false)
    expect(await server.quote(stock('PTT', 'SET', 'THB'))).toEqual({
      price: '42',
      currency: 'THB',
      at: '2026-10-27T09:39:00.000Z',
      previousClose: '41.75',
      previousCloseAt: '2026-10-24T03:00:00.000Z',
      source: 'Yahoo',
    })
    expect(asked).toEqual([['SET:PTT']])
    expect(await createJodServer({ ...market, quotes: async () => [] }).quote(stock('PTT', 'SET', 'THB'))).toBeNull()
  })

  it('writes tiny prices without exponents', () => {
    expect(toPlain(1.23e-7)).toBe('0.000000123')
  })
})

describe('updatePrices', () => {
  it('updates what a source covers, leaves the rest manual and survives a failure', async () => {
    const instruments = [coin('BTC'), coin('USDT', 'USDT'), stock('PTT', 'SET', 'THB'), coin('NOPE')]
    await db.instruments.bulkAdd(instruments)
    const { fetchFn } = jsonFetch({
      'ids=bitcoin': { bitcoin: { usd: 65000 } },
      'ids=tether': { tether: { usd: 1.0002 } },
      'search?query=NOPE': { coins: [] },
    })
    const result = await updatePrices(db, instruments, [createCoinGecko(fetchFn)], new Date('2026-10-26T01:00:00Z'))
    expect(result).toEqual({ updated: ['BTC', 'USDT'], manual: ['PTT'], failed: ['NOPE'] })
    expect(await db.instruments.get('CRYPTO:BTC')).toMatchObject({ lastPrice: '65000', lastPriceAt: '2026-10-26T01:00:00.000Z' })
    expect((await db.instruments.get('CRYPTO:USDT'))?.lastPrice).toBe('1.0002')
  })
})

describe('updatePrices with the JOD server', () => {
  it('keeps the price time, source and previous close the server sends', async () => {
    await db.instruments.add(stock('PTT', 'SET', 'THB'))
    const server: PriceSource = {
      name: 'JOD',
      covers: () => true,
      quote: async () => ({ price: '42', currency: 'THB', at: '2026-10-27T09:39:00.000Z', previousClose: '41.75', previousCloseAt: '2026-10-24T03:00:00.000Z', source: 'Yahoo' }),
    }
    await updatePrices(db, [stock('PTT', 'SET', 'THB')], [server], new Date('2026-10-27T12:00:00Z'))
    expect(await db.instruments.get('SET:PTT')).toMatchObject({
      lastPrice: '42',
      lastPriceAt: '2026-10-27T09:39:00.000Z',
      priceSource: 'Yahoo',
      previousPrice: '41.75',
      previousPriceAt: '2026-10-24T03:00:00.000Z',
    })
  })

  it('falls through to the next source when the first fails', async () => {
    await db.instruments.add(stock('AAPL'))
    const down: PriceSource = { name: 'JOD', covers: () => true, quote: async () => Promise.reject(new Error('offline')) }
    const { fetchFn } = jsonFetch({ 'quote?symbol=AAPL': { c: 231.42 } })
    const result = await updatePrices(db, [stock('AAPL')], [down, createFinnhub('my-key', fetchFn)], new Date('2026-10-27T12:00:00Z'))
    expect(result).toEqual({ updated: ['AAPL'], manual: [], failed: [] })
    expect(await db.instruments.get('US:AAPL')).toMatchObject({ lastPrice: '231.42', priceSource: 'Finnhub', lastPriceAt: '2026-10-27T12:00:00.000Z' })
  })
})

describe('runPriceUpdate', () => {
  it('prices the benchmark from the next source when the first fails', async () => {
    await db.dailyValues.add({ date: '2026-10-27', valueBase: '100', netInvestedBase: '90', recordedAt: '2026-10-27T01:00:00.000Z' })
    const down: PriceSource = { name: 'JOD', covers: () => true, quote: async () => Promise.reject(new Error('offline')) }
    const { fetchFn } = jsonFetch({ 'quote?symbol=SPY': { c: 580.1 } })
    await runPriceUpdate(db, [], [down, createFinnhub('my-key', fetchFn)], 'SPY', '2026-10-27')
    expect(await db.dailyValues.get('2026-10-27')).toMatchObject({ benchmarkSymbol: 'SPY', benchmarkPrice: '580.1' })
  })
})

describe('describeUpdate', () => {
  it('points US shares at the missing key and the rest at typing the price', () => {
    const held = [stock('AAPL'), stock('PTT', 'SET', 'THB')]
    expect(describeUpdate({ updated: ['BTC'], manual: ['AAPL', 'PTT'], failed: [] }, held)).toBe(
      'อัปเดต 1 ตัว · ใส่ key Finnhub ในหน้าตั้งค่าเพื่อดึง: AAPL · ไม่มีแหล่งราคาอัตโนมัติ กรอกเอง: PTT',
    )
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { createDb, type JodDB } from '../db/db'
import type { Instrument } from '../domain/types'
import { createCoinGecko, createFinnhub, toPlain } from './providers'
import { describeUpdate } from './run'
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

describe('describeUpdate', () => {
  it('points US shares at the missing key and the rest at typing the price', () => {
    const held = [stock('AAPL'), stock('PTT', 'SET', 'THB')]
    expect(describeUpdate({ updated: ['BTC'], manual: ['AAPL', 'PTT'], failed: [] }, held)).toBe(
      'อัปเดต 1 ตัว · ใส่ key Finnhub ในหน้าตั้งค่าเพื่อดึง: AAPL · ไม่มีแหล่งราคาอัตโนมัติ กรอกเอง: PTT',
    )
  })
})

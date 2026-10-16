import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDb, type JodDB } from '../db/db'
import { fakeFxProvider } from '../test/fakeFx'
import { createFrankfurterProvider, FxUnavailableError } from './frankfurter'
import { getFxQuote } from './fxService'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('createFrankfurterProvider', () => {
  it('requests the dated endpoint and returns the date the rate belongs to', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ amount: 1, base: 'USD', date: '2024-01-12', rates: { THB: 35.1 } }))
    const provider = createFrankfurterProvider(fetchFn)
    const result = await provider.getRate('USD', 'THB', '2024-01-13')
    expect(fetchFn).toHaveBeenCalledWith('https://api.frankfurter.dev/v1/2024-01-13?base=USD&symbols=THB')
    expect(result).toEqual({ rate: '35.1', rateDate: '2024-01-12' })
  })

  it('turns a 404 into FxUnavailableError', async () => {
    const provider = createFrankfurterProvider(async () => jsonResponse({ message: 'not found' }, 404))
    await expect(provider.getRate('USD', 'THB', '2030-01-01')).rejects.toBeInstanceOf(FxUnavailableError)
  })

  it('turns a network failure into FxUnavailableError', async () => {
    const provider = createFrankfurterProvider(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(provider.getRate('USD', 'THB', 'latest')).rejects.toThrow('เชื่อมต่อแหล่งเรทไม่ได้')
  })
})

describe('getFxQuote', () => {
  let db: JodDB
  const now = new Date(2024, 5, 30, 12, 0)

  beforeEach(() => {
    db = createDb(`test-${crypto.randomUUID()}`)
  })

  it('returns 1 for the same currency without calling the provider', async () => {
    const { provider, calls } = fakeFxProvider({})
    expect(await getFxQuote(db, provider, 'THB', 'THB', '2024-01-15', now)).toEqual({
      rate: '1',
      rateDate: '2024-01-15',
      source: 'same',
    })
    expect(calls).toEqual([])
  })

  it('refuses unsupported currencies without a network call', async () => {
    const { provider, calls } = fakeFxProvider({})
    await expect(getFxQuote(db, provider, 'VND', 'THB', '2024-01-15', now)).rejects.toThrow(
      'ไม่มีเรทอัตโนมัติสำหรับ VND/THB',
    )
    expect(calls).toEqual([])
  })

  it('caches past dates forever', async () => {
    const { provider, calls } = fakeFxProvider({ 'USD|THB': '35.1' })
    await getFxQuote(db, provider, 'USD', 'THB', '2024-01-15', now)
    const again = await getFxQuote(db, provider, 'USD', 'THB', '2024-01-15', new Date(2030, 0, 1))
    expect(again.rate).toBe('35.1')
    expect(calls).toEqual(['USD|THB|2024-01-15'])
  })

  it('treats today as latest and refreshes it after six hours', async () => {
    const { provider, calls } = fakeFxProvider({ 'USD|THB': '33.5' }, '2024-06-28')
    await getFxQuote(db, provider, 'USD', 'THB', '2024-06-30', now)
    await getFxQuote(db, provider, 'USD', 'THB', 'latest', new Date(2024, 5, 30, 17, 0))
    await getFxQuote(db, provider, 'USD', 'THB', 'latest', new Date(2024, 5, 30, 19, 0))
    expect(calls).toEqual(['USD|THB|latest', 'USD|THB|latest'])
  })

  it('falls back to a stale cached rate when offline', async () => {
    const online = fakeFxProvider({ 'USD|THB': '33.5' })
    await getFxQuote(db, online.provider, 'USD', 'THB', 'latest', now)
    const offline = fakeFxProvider({})
    const quote = await getFxQuote(db, offline.provider, 'USD', 'THB', 'latest', new Date(2024, 6, 5))
    expect(quote.rate).toBe('33.5')
  })
})

import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import { FxProviderContext } from '../fx/context'
import type { FxProvider } from '../fx/frankfurter'
import { fakeFxProvider, lateFxProvider } from '../test/fakeFx'
import { makeTx } from '../test/fixtures'
import { resetDb } from '../test/render'
import { useLatestRates } from './hooks'

const withProvider = (provider: FxProvider) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(FxProviderContext.Provider, { value: provider }, children)
  }

beforeEach(resetDb)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useLatestRates for dollar-pegged currencies', () => {
  it('gives USDT and USDC the dollar rate when they have none of their own', async () => {
    const { provider } = fakeFxProvider({ 'USD|THB': '33' })
    const { result } = renderHook(() => useLatestRates(['USDT', 'USDC'], 'THB', []), { wrapper: withProvider(provider) })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.rates).toEqual({
      USDT: { rate: '33', note: 'ใช้เรท USD' },
      USDC: { rate: '33', note: 'ใช้เรท USD' },
    })
    expect(result.current.confirmed).toBe(true)
  })

  it('does not report the dollar when only the pegged currency was asked for', async () => {
    const { provider } = fakeFxProvider({ 'USD|THB': '33' })
    const { result } = renderHook(() => useLatestRates(['USDT'], 'THB', []), { wrapper: withProvider(provider) })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(Object.keys(result.current.rates)).toEqual(['USDT'])
  })

  it('waits for the dollar rate before it is ready', async () => {
    const { provider, release, requested } = lateFxProvider({ 'USD|THB': '33' })
    const { result } = renderHook(() => useLatestRates(['USDT'], 'THB', []), { wrapper: withProvider(provider) })
    await waitFor(() => expect(requested()).toBeGreaterThan(0))
    await act(async () => {})
    expect(result.current.ready).toBe(false)
    expect(result.current.rates).toEqual({})

    release()
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.rates.USDT).toEqual({ rate: '33', note: 'ใช้เรท USD' })
  })

  it('never shows the dollar rate for a currency whose own lookup has not finished', async () => {
    await db.fxRates.put({ key: 'USD|THB|latest', rate: '32', rateDate: '2024-01-10', fetchedAt: new Date().toISOString() })
    const get = db.fxRates.get.bind(db.fxRates) as (key: string) => Promise<unknown>
    let open = () => {}
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    vi.spyOn(db.fxRates, 'get').mockImplementation((async (key: string) => {
      if (key.startsWith('USDT|')) await gate
      return get(key)
    }) as never)
    const { provider } = fakeFxProvider({ 'USD|THB': '33' })
    const transactions = [makeTx({ currency: 'USDT', fxRate: '34.5' })]
    const notes: (string | undefined)[] = []
    const { result } = renderHook(
      () => {
        const latest = useLatestRates(['USD', 'USDT'], 'THB', transactions)
        notes.push(latest.rates.USDT?.note)
        return latest
      },
      { wrapper: withProvider(provider) },
    )
    await waitFor(() => expect(result.current.rates.USD).toBeDefined())
    await act(async () => {})
    expect(result.current.ready).toBe(false)
    expect(result.current.rates.USDT).toBeUndefined()

    open()
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.rates.USDT).toEqual({ rate: '34.5', note: 'เรทล่าสุดที่บันทึกไว้' })
    expect(notes).not.toContain('ใช้เรท USD')
  })

  it('keeps a rate the currency has of its own', async () => {
    const { provider } = fakeFxProvider({ 'USD|THB': '33' })
    const transactions = [makeTx({ currency: 'USDT', fxRate: '34.5' })]
    const { result } = renderHook(() => useLatestRates(['USDT'], 'THB', transactions), { wrapper: withProvider(provider) })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.rates.USDT).toEqual({ rate: '34.5', note: 'เรทล่าสุดที่บันทึกไว้' })
  })

  it('leaves a pegged currency without a rate when the dollar has none either', async () => {
    const { provider } = fakeFxProvider({})
    const { result } = renderHook(() => useLatestRates(['USDT'], 'THB', []), { wrapper: withProvider(provider) })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.rates).toEqual({})
  })

  it('uses 1 when the base currency is the dollar', async () => {
    const { provider } = fakeFxProvider({})
    const { result } = renderHook(() => useLatestRates(['USDT'], 'USD', []), { wrapper: withProvider(provider) })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.rates.USDT).toEqual({ rate: '1', note: 'ใช้เรท USD' })
  })
})

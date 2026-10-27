import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarketError } from '../market/client'
import { useMarket } from './useMarket'

describe('useMarket', () => {
  it('goes from loading to ready', async () => {
    const { result } = renderHook(() => useMarket('k', async () => 42))
    expect(result.current).toEqual({ status: 'loading' })
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', data: 42 }))
  })

  it('is off when the server has no news source', async () => {
    const { result } = renderHook(() => useMarket('k', async () => Promise.reject(new MarketError(503))))
    await waitFor(() => expect(result.current).toEqual({ status: 'off' }))
  })

  it('fails on any other error', async () => {
    const { result } = renderHook(() => useMarket('k', async () => Promise.reject(new MarketError(502))))
    await waitFor(() => expect(result.current).toEqual({ status: 'failed' }))
  })

  it('ignores an answer for a key it no longer shows', async () => {
    let answerOld: (n: number) => void = () => {}
    const { result, rerender } = renderHook(({ key }) => useMarket(key, key === 'old' ? () => new Promise<number>((r) => (answerOld = r)) : async () => 2), {
      initialProps: { key: 'old' },
    })
    rerender({ key: 'new' })
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', data: 2 }))
    await act(async () => answerOld(1))
    expect(result.current).toEqual({ status: 'ready', data: 2 })
  })
})

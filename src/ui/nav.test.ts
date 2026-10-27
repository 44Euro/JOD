import { describe, expect, it } from 'vitest'
import { foundPath, isMoreTab, isTransactionEdit } from './nav'

describe('isMoreTab', () => {
  it.each([
    ['/more', true],
    ['/income', true],
    ['/fx', true],
    ['/import', true],
    ['/settings', true],
    ['/transactions', true],
    ['/transactions/tx-1', true],
    ['/transactions/newfoo', true],
    ['/transactions/new', false],
    ['/transactions/new/x', false],
    ['/fxx', false],
    ['/trades', false],
    ['/portfolio', false],
    ['/', false],
    ['/nowhere', false],
  ])('%s is %s', (pathname, expected) => {
    expect(isMoreTab(pathname)).toBe(expected)
  })
})

describe('isTransactionEdit', () => {
  it.each([
    ['/transactions/tx-1', true],
    ['/transactions/newfoo', true],
    ['/transactions', false],
    ['/transactions/new', false],
    ['/transactions/new/x', false],
    ['/trades', false],
    ['/', false],
  ])('%s is %s', (pathname, expected) => {
    expect(isTransactionEdit(pathname)).toBe(expected)
  })
})

describe('foundPath', () => {
  const ptt = { id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'PTT', assetType: 'stock', currency: 'THB' } as const

  it('opens the asset page of an asset the app knows', () => {
    expect(foundPath({ market: 'SET', symbol: 'PTT', name: 'PTT Public', assetType: 'stock' }, [ptt])).toBe('/assets/SET%3APTT')
  })

  it('starts a buy of an asset the app does not know yet', () => {
    expect(foundPath({ market: 'US', symbol: 'BRK.B', name: 'Berkshire & Co', assetType: 'stock' }, [ptt])).toBe(
      '/transactions/new?type=buy&market=US&symbol=BRK.B&name=Berkshire+%26+Co&assetType=stock',
    )
  })
})

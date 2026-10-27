import { describe, expect, it } from 'vitest'
import { buyPath, foundPath, isMoreTab, isTransactionEdit } from './nav'

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

describe('foundPath and buyPath', () => {
  it('opens the stock page of any picked asset', () => {
    expect(foundPath({ market: 'SET', symbol: 'PTT', name: 'PTT Public', assetType: 'stock' })).toBe('/assets/SET%3APTT')
    expect(foundPath({ market: 'US', symbol: 'BRK.B', name: 'Berkshire', assetType: 'stock' })).toBe('/assets/US%3ABRK.B')
  })

  it('starts a buy of an asset the app does not know yet', () => {
    expect(buyPath({ market: 'US', symbol: 'BRK.B', name: 'Berkshire & Co', assetType: 'stock' })).toBe(
      '/transactions/new?type=buy&market=US&symbol=BRK.B&name=Berkshire+%26+Co&assetType=stock',
    )
  })
})

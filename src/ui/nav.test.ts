import { describe, expect, it } from 'vitest'
import { isMoreTab, isTransactionEdit } from './nav'

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

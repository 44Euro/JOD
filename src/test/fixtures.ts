import type { Transaction } from '../domain/types'

let seq = 0

export function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  seq += 1
  const stamp = new Date(Date.UTC(2024, 0, 1) + seq * 1000).toISOString()
  return {
    id: `tx-${seq}`,
    accountId: 'acc-1',
    type: 'buy',
    date: '2024-01-15',
    instrumentId: 'US:AAPL',
    quantity: '1',
    price: '100',
    currency: 'USD',
    fees: '0',
    tax: '0',
    fxRate: '35',
    fxSource: 'manual',
    note: '',
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  }
}

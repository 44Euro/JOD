import { describe, expect, it } from 'vitest'
import { crossedAlerts, validateAlert } from './alerts'
import type { PriceAlert } from './types'

const alert = (id: string, instrumentId: string, direction: PriceAlert['direction'], price: string, extra: Partial<PriceAlert> = {}): PriceAlert => ({
  id,
  instrumentId,
  direction,
  price,
  createdAt: '2026-11-01T00:00:00.000Z',
  ...extra,
})

describe('crossedAlerts', () => {
  const prices: Record<string, string> = { 'SET:PTT': '34.5', 'US:NVDA': '150', 'US:AAPL': '346' }
  const priceOf = (id: string) => prices[id] ?? null

  it('finds the alerts the price has reached, including exactly at the target', () => {
    const alerts = [alert('a', 'SET:PTT', 'below', '35'), alert('b', 'US:NVDA', 'above', '150'), alert('c', 'US:AAPL', 'above', '400'), alert('d', 'US:MSFT', 'below', '500')]
    expect(crossedAlerts(alerts, priceOf).map((hit) => [hit.alert.id, hit.price])).toEqual([
      ['a', '34.5'],
      ['b', '150'],
    ])
  })

  it('leaves out an alert that has already fired', () => {
    expect(crossedAlerts([alert('a', 'SET:PTT', 'below', '35', { firedAt: '2026-11-01T02:00:00.000Z' })], priceOf)).toEqual([])
  })
})

describe('validateAlert', () => {
  it('asks for a price above zero', () => {
    expect(validateAlert('0')).toEqual(['ใส่ราคาที่มากกว่า 0'])
    expect(validateAlert('abc')).toEqual(['ใส่ราคาที่มากกว่า 0'])
    expect(validateAlert('35.25')).toEqual([])
  })
})

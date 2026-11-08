import { describe, expect, it } from 'vitest'
import { dayAxis } from './Charts'

describe('dayAxis', () => {
  it('puts several trades of one day on one tick and spaces days by time', () => {
    const { data, ticks, label } = dayAxis([
      { date: '2025-12-31', price: 190 },
      { date: '2026-11-03', price: 306 },
      { date: '2026-11-03', price: 306 },
      { date: '2026-11-04', price: 338 },
    ])
    expect(data.map((d) => d.day)).toEqual([Date.UTC(2025, 11, 31), Date.UTC(2026, 10, 3), Date.UTC(2026, 10, 3), Date.UTC(2026, 10, 4)])
    expect(ticks.map(label)).toEqual(['31/12', '3/11', '4/11'])
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Instrument } from '../../domain/types'
import { StockHeader } from './StockHeader'

const local = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).toISOString()
const aapl: Instrument = { id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD' }

describe('StockHeader', () => {
  it('shows the live price, signed change and source', () => {
    const live = { id: 'US:AAPL', price: '346.05', currency: 'USD', at: local(28, 3, 0), previousClose: '343.91', previousCloseAt: local(27, 20, 30), source: 'Yahoo' }
    render(<StockHeader market="US" symbol="AAPL" name="Apple Inc." exchange="NasdaqGS" live={live} instrument={aapl} points={[]} today="2026-10-28" />)
    const board = screen.getByRole('region', { name: 'AAPL' })
    expect(screen.getByRole('heading', { level: 1, name: 'AAPL' })).toBeInTheDocument()
    expect(board).toHaveTextContent('Apple Inc. · NasdaqGS')
    expect(board).toHaveTextContent('346.05')
    expect(board).toHaveTextContent('+2.14 (+0.62%)')
    expect(board).toHaveTextContent('Yahoo ช้าราว 15 นาที · 03:00 · เทียบราคาปิด 27 ต.ค. 2026')
  })

  it('falls back to the stored price with its date', () => {
    const stored = { ...aapl, lastPrice: '120', lastPriceAt: local(20, 9, 0), previousPrice: '100', previousPriceAt: local(19, 9, 0) }
    render(<StockHeader market="US" symbol="AAPL" live={null} instrument={stored} points={[]} today="2026-10-28" />)
    const board = screen.getByRole('region', { name: 'AAPL' })
    expect(board).toHaveTextContent('120.00')
    expect(board).toHaveTextContent('+20.00 (+20.00%)')
    expect(board).toHaveTextContent('ราคา 20 ต.ค. 2026')
    expect(board).not.toHaveTextContent('Yahoo')
  })

  it('says there is no price yet', () => {
    render(<StockHeader market="CRYPTO" symbol="SOL" live={null} points={[]} today="2026-10-28" />)
    expect(screen.getByRole('region', { name: 'SOL' })).toHaveTextContent('ยังไม่มีราคา')
  })

  it('draws the six-month line', () => {
    const points = [
      { date: '2026-05-01', close: '200' },
      { date: '2026-08-01', close: '260' },
      { date: '2026-10-27', close: '346.05' },
    ]
    render(<StockHeader market="US" symbol="AAPL" live={null} instrument={aapl} points={points} today="2026-10-28" />)
    const line = screen.getByRole('img', { name: 'ราคาปิด 6 เดือน 1 พ.ค. 2026 – 27 ต.ค. 2026' })
    expect(line.querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(3)
  })
})

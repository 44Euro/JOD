import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { NewsItem } from '../../market/client'
import { MarketNote, NewsList } from './NewsList'

const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).toISOString()
const items: NewsItem[] = [
  { id: '1', headline: 'Apple beats estimates', source: 'Reuters', url: 'https://news.test/apple', publishedAt: at(27, 8, 5), symbols: ['AAPL', 'MSFT'] },
  { id: '2', headline: 'Markets close higher', source: 'CNBC', url: 'https://news.test/close', publishedAt: at(26, 21, 40), symbols: [] },
]

describe('NewsList', () => {
  it('links each headline out and says its source and time', () => {
    render(<NewsList items={items} today="2026-10-27" />)
    const link = screen.getByRole('link', { name: 'Apple beats estimates' })
    expect(link).toHaveAttribute('href', 'https://news.test/apple')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    const [first, second] = screen.getAllByRole('listitem')
    expect(first).toHaveTextContent('Reuters · 08:05')
    expect(second).toHaveTextContent('CNBC · 26 ต.ค. 2026 21:40')
  })

  it('shows the related symbols', () => {
    render(<NewsList items={items} today="2026-10-27" />)
    const [first, second] = screen.getAllByRole('listitem')
    expect(within(first).getByText('AAPL')).toBeInTheDocument()
    expect(within(first).getByText('MSFT')).toBeInTheDocument()
    expect(second).not.toHaveTextContent('US')
  })
})

describe('MarketNote', () => {
  it('says when news is not switched on, failed or loading', () => {
    const { rerender } = render(<MarketNote state={{ status: 'off' }} />)
    expect(screen.getByText(/ยังไม่เปิด/)).toBeInTheDocument()
    rerender(<MarketNote state={{ status: 'failed' }} />)
    expect(screen.getByText('ดึงข้อมูลตลาดไม่ได้ตอนนี้ ลองใหม่ภายหลัง')).toBeInTheDocument()
    rerender(<MarketNote state={{ status: 'loading' }} />)
    expect(screen.getByText('กำลังดึงข้อมูลตลาด…')).toBeInTheDocument()
  })
})

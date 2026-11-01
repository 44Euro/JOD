import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { todayLocal, tradingWeek } from '../../domain/dates'
import { marketClient } from '../../market/client'
import { renderRoute, resetDb } from '../../test/render'

beforeEach(async () => {
  await resetDb()
  await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
  await db.instruments.add({ id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'PTT', assetType: 'stock', currency: 'THB', lastPrice: '30' })
})

afterEach(() => vi.restoreAllMocks())

describe('MarketPage', () => {
  it('shows the earnings week and the news before the watchlist', async () => {
    const week = tradingWeek(todayLocal())
    vi.spyOn(marketClient, 'earnings').mockResolvedValue([{ symbol: 'AAPL', date: week[2], time: 'after', epsEstimate: '1.6', epsActual: null }])
    vi.spyOn(marketClient, 'news').mockResolvedValue([
      { id: '1', headline: 'Markets close higher', source: 'CNBC', url: 'https://news.test/1', publishedAt: '2026-10-27T01:00:00.000Z', symbols: [] },
    ])
    renderRoute('/market')
    const earnings = await screen.findByRole('region', { name: 'ประกาศงบสัปดาห์นี้' })
    const news = screen.getByRole('region', { name: 'ข่าวต่างประเทศ' })
    expect(await within(news).findByRole('link', { name: 'Markets close higher' })).toBeInTheDocument()
    expect(await within(earnings).findByText('ทั้งตลาดสัปดาห์นี้ 1 บริษัท')).toBeInTheDocument()
    const watchlist = screen.getByRole('heading', { name: 'ติดตาม (watchlist)' })
    expect(earnings.compareDocumentPosition(news) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(news.compareDocumentPosition(watchlist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the big-money moves after the news and before the watchlist', async () => {
    vi.spyOn(marketClient, 'news').mockResolvedValue([])
    vi.spyOn(marketClient, 'bigMoney').mockResolvedValue({
      funds: null,
      congress: [{ ticker: 'NVDA', asset: 'NVIDIA', type: 'buy', tradedAt: '2026-10-15', notifiedAt: '2026-10-29', amount: '$1,001 – $15,000', member: 'Josh Gottheimer', state: 'NJ05', filedAt: '2026-10-29', url: 'https://house.test/1.pdf' }],
    })
    renderRoute('/market')
    const big = await screen.findByRole('region', { name: 'เงินใหญ่ขยับ' })
    expect(await within(big).findByRole('listitem', { name: /NVDA/ })).toBeInTheDocument()
    const news = screen.getByRole('region', { name: 'ข่าวต่างประเทศ' })
    const watchlist = screen.getByRole('heading', { name: 'ติดตาม (watchlist)' })
    expect(news.compareDocumentPosition(big) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(big.compareDocumentPosition(watchlist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('opens under its own title on a navy band', async () => {
    renderRoute('/market')
    const title = await screen.findByRole('heading', { level: 1, name: 'ตลาด' })
    expect(title.closest('header')).toHaveClass('bg-board')
  })

  it('opens the search from the board and goes to a picked asset the app knows', async () => {
    const user = userEvent.setup()
    const router = renderRoute('/market')
    await user.click(await screen.findByRole('button', { name: 'ค้นหาหุ้นหรือคริปโต' }))
    await user.type(screen.getByRole('combobox', { name: 'ค้นหาสินทรัพย์' }), 'ptt')
    await user.click(screen.getByRole('option', { name: /^PTT/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/assets/SET%3APTT'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('lists watched symbols on ตลาด and flags one that reached the price to buy at', async () => {
    const user = userEvent.setup()
    renderRoute('/market')
    await user.selectOptions(await screen.findByLabelText('ตลาด'), 'SET')
    await user.type(screen.getByLabelText('สัญลักษณ์'), 'ptt')
    await user.type(screen.getByLabelText('อยากซื้อต่ำกว่า (ไม่บังคับ)'), '31')
    await user.click(screen.getByRole('button', { name: 'เพิ่มเข้า watchlist' }))
    const list = await screen.findByRole('list', { name: 'สินทรัพย์ที่ติดตาม' })
    expect(within(list).getByText('PTT')).toBeInTheDocument()
    expect(within(list).getByText('ถึงราคาที่อยากซื้อ')).toBeInTheDocument()
    expect(within(list).getByText(/ล่าสุด 30.00 · อยากซื้อต่ำกว่า 31.00/)).toBeInTheDocument()
  })

})

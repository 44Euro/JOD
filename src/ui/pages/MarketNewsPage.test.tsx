import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { marketClient, type NewsItem } from '../../market/client'
import { makeTx } from '../../test/fixtures'
import { renderRoute, resetDb } from '../../test/render'

const story = (headline: string, symbols: string[]): NewsItem => ({ id: headline, headline, source: 'Reuters', url: `https://news.test/${headline}`, publishedAt: '2026-10-27T01:00:00.000Z', symbols })

beforeEach(async () => {
  await resetDb()
  await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
  await db.instruments.add({ id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD' })
  await db.transactions.add(makeTx())
})

afterEach(() => vi.restoreAllMocks())

describe('MarketNewsPage', () => {
  it('switches to news of held shares', async () => {
    const news = vi.spyOn(marketClient, 'news').mockImplementation(async (symbols) => [symbols.length ? story('Apple beats estimates', symbols) : story('Markets close higher', [])])
    const user = userEvent.setup()
    renderRoute('/market/news')
    expect(await screen.findByRole('link', { name: 'Markets close higher' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'ข่าวทั่วไป' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'หุ้นที่ถือ' }))
    expect(await screen.findByRole('link', { name: 'Apple beats estimates' })).toBeInTheDocument()
    await waitFor(() => expect(news).toHaveBeenLastCalledWith(['AAPL']))
  })
})

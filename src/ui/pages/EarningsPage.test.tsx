import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { todayLocal, tradingWeek } from '../../domain/dates'
import { marketClient } from '../../market/client'
import { renderRoute, resetDb } from '../../test/render'

beforeEach(async () => {
  await resetDb()
  await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
  await db.watchlist.add({ id: 'w-1', market: 'US', symbol: 'KO', note: '', createdAt: '2026-10-01T00:00:00.000Z' })
})

afterEach(() => vi.restoreAllMocks())

describe('EarningsPage', () => {
  it('lists every report of the week when asked for all', async () => {
    const week = tradingWeek(todayLocal())
    vi.spyOn(marketClient, 'earnings').mockResolvedValue([
      { symbol: 'KO', date: week[1], time: 'before', epsEstimate: '0.7', epsActual: '0.71' },
      { symbol: 'ZZZ', date: week[3], time: null, epsEstimate: null, epsActual: null },
    ])
    const user = userEvent.setup()
    renderRoute('/market/earnings')
    const ko = await screen.findByText('KO')
    expect(ko.closest('li')).toHaveTextContent('ก่อนเปิด')
    expect(ko.closest('li')).toHaveTextContent('EPS คาด 0.7 · จริง 0.71')
    expect(screen.queryByText('ZZZ')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'ทั้งหมด' }))
    expect(screen.getByText('ZZZ')).toBeInTheDocument()
  })
})

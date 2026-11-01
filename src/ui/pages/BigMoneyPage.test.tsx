import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { marketClient } from '../../market/client'
import { renderRoute, resetDb } from '../../test/render'

beforeEach(async () => {
  await resetDb()
  await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
})

afterEach(() => vi.restoreAllMocks())

describe('BigMoneyPage', () => {
  it('shows each fund with its moves, and the House trades on their own chip', async () => {
    vi.spyOn(marketClient, 'bigMoney').mockResolvedValue({
      funds: [
        {
          cik: '1067983',
          name: 'BERKSHIRE HATHAWAY INC',
          period: '2026-06-30',
          filedAt: '2026-08-14',
          moves: [{ issuer: 'APPLE INC', ticker: 'AAPL', shares: '280000000', value: '6e10', change: 'reduce', sharesChange: '-20000000', valueChange: '-1e10' }],
        },
      ],
      congress: [{ ticker: 'MPC', asset: 'Marathon', type: 'sell', tradedAt: '2026-10-15', notifiedAt: '2026-10-29', amount: '$1,001 – $15,000', member: 'David J. Taylor', state: 'OH02', filedAt: '2026-10-29', url: 'https://house.test/2.pdf' }],
    })
    const user = userEvent.setup()
    renderRoute('/market/bigmoney')
    const fund = await screen.findByRole('region', { name: 'BERKSHIRE HATHAWAY INC' })
    expect(within(fund).getByRole('listitem', { name: /AAPL/ })).toHaveTextContent('− ขายบางส่วน 20M หุ้น')
    expect(screen.queryByText('David J. Taylor · OH02')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'สภาผู้แทนฯ' }))
    expect(screen.getByRole('listitem', { name: /MPC/ })).toHaveTextContent('David J. Taylor · OH02')
    expect(screen.getByText('รายงานของสภาผู้แทนฯ ช้าได้ 30–45 วันตามกฎหมาย')).toBeInTheDocument()
  })
})

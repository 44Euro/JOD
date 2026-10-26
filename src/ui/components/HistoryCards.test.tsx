import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { D } from '../../domain/decimal'
import type { RealizedEvent } from '../../domain/ledger'
import { resetDb } from '../../test/render'
import { PlCalendar, PortfolioHistoryCard } from './HistoryCards'

beforeEach(resetDb)

describe('PortfolioHistoryCard', () => {
  it('waits for two days of values, then shows growth without deposits and the deepest fall', async () => {
    await db.dailyValues.add({ date: '2024-06-01', valueBase: '1000', netInvestedBase: '1000', recordedAt: '' })
    const { unmount } = render(<PortfolioHistoryCard base="THB" today="2024-06-30" />)
    expect(await screen.findByText(/กราฟจะขึ้นเมื่อมีข้อมูลอย่างน้อย 2 วัน/)).toBeInTheDocument()
    unmount()

    await db.dailyValues.bulkAdd([
      { date: '2024-06-02', valueBase: '1200', netInvestedBase: '1000', recordedAt: '' },
      { date: '2024-06-03', valueBase: '1900', netInvestedBase: '2000', recordedAt: '' },
    ])
    render(<PortfolioHistoryCard base="THB" today="2024-06-30" />)
    expect(await screen.findByText('−10.0%')).toBeInTheDocument()
    expect(screen.getByText('−25.0%')).toBeInTheDocument()
    expect(screen.getByText('2 มิ.ย. 2024 → 3 มิ.ย. 2024')).toBeInTheDocument()
  })
})

describe('PlCalendar', () => {
  const event = (date: string, pl: string) => ({ date, realizedBase: D(pl) }) as RealizedEvent

  it('opens on the latest month with results and colours each day', async () => {
    const user = userEvent.setup()
    render(<PlCalendar events={[event('2024-03-05', '120'), event('2024-03-07', '-40'), event('2024-02-10', '15')]} base="THB" today="2024-06-01" />)
    const grid = screen.getByRole('grid', { name: 'กำไรขาดทุนรายวัน มี.ค. 2024' })
    expect(within(grid).getByTitle('5 มี.ค. 2024 ฿120')).toHaveClass('bg-gain-soft')
    expect(within(grid).getByTitle('7 มี.ค. 2024 −฿40')).toHaveClass('bg-loss-soft')
    expect(screen.getByText('+80')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'เดือนก่อน' }))
    expect(screen.getByRole('grid', { name: 'กำไรขาดทุนรายวัน ก.พ. 2024' })).toBeInTheDocument()
  })
})

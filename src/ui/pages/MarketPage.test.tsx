import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { renderRoute, resetDb } from '../../test/render'

beforeEach(async () => {
  await resetDb()
  await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
  await db.instruments.add({ id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'PTT', assetType: 'stock', currency: 'THB', lastPrice: '30' })
})

describe('MarketPage', () => {
  it('opens under its own title on a navy band', async () => {
    renderRoute('/market')
    const title = await screen.findByRole('heading', { level: 1, name: 'ตลาด' })
    expect(title.closest('header')).toHaveClass('bg-board')
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

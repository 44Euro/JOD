import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { makeTx } from '../../test/fixtures'
import { renderRoute, resetDb } from '../../test/render'

const account = { id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' }

beforeEach(async () => {
  await resetDb()
  await db.accounts.add(account)
  await db.instruments.bulkAdd([
    { id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'PTT', assetType: 'stock', currency: 'THB', lastPrice: '30' },
    { id: 'SET:KBANK', market: 'SET', symbol: 'KBANK', name: 'KBANK', assetType: 'stock', currency: 'THB', lastPrice: '100' },
  ])
  await db.transactions.bulkAdd([
    makeTx({ id: 'a', instrumentId: 'SET:PTT', currency: 'THB', fxRate: '1', fxSource: 'same', quantity: '1000', price: '30' }),
    makeTx({ id: 'b', instrumentId: 'SET:KBANK', currency: 'THB', fxRate: '1', fxSource: 'same', quantity: '100', price: '100' }),
  ])
})

describe('PlansPage', () => {
  it('saves a target share and says how much to buy or sell to reach it', async () => {
    const user = userEvent.setup()
    renderRoute('/plans')
    const list = await screen.findByRole('list', { name: 'สัดส่วนแต่ละตัว' })
    expect(within(list).getByText('ตอนนี้ 75%')).toBeInTheDocument()
    await user.type(within(list).getByLabelText('เป้าหมายของ PTT (%)'), '50')
    await user.tab()
    await waitFor(async () => expect((await db.instruments.get('SET:PTT'))?.targetPct).toBe('50'))
    expect(await within(list).findByText('ขาย ฿10,000')).toBeInTheDocument()
    expect(screen.getByText(/เป้าหมายรวมกันได้ 50%/)).toBeInTheDocument()
  })

  it('adds a monthly plan and shows how many periods were done', async () => {
    const user = userEvent.setup()
    renderRoute('/plans')
    await user.selectOptions(await screen.findByLabelText('สินทรัพย์'), 'SET:PTT')
    await user.type(screen.getByLabelText('ซื้องวดละ (THB)'), '3,000')
    await user.clear(screen.getByLabelText('เริ่ม'))
    await user.type(screen.getByLabelText('เริ่ม'), '2024-01-01')
    await user.click(screen.getByRole('button', { name: 'เพิ่มแผน' }))
    const plans = await screen.findByRole('list', { name: 'แผนที่มี' })
    expect(within(plans).getByText(/3,000.00 THB ทุกเดือน · Dime US/)).toBeInTheDocument()
    expect(within(plans).getByText(/^ครบ 1 จาก/)).toBeInTheDocument()
    const [plan] = await db.plans.toArray()
    expect([plan.amount, plan.currency, plan.frequency]).toEqual(['3000', 'THB', 'monthly'])
  })
})

describe('watchlist and checklist', () => {
  it('flags a watched asset that reached the price to buy at', async () => {
    const user = userEvent.setup()
    renderRoute('/plans')
    await user.selectOptions(await screen.findByLabelText('ตลาด'), 'SET')
    await user.type(screen.getByLabelText('สัญลักษณ์'), 'ptt')
    await user.type(screen.getByLabelText('อยากซื้อต่ำกว่า (ไม่บังคับ)'), '31')
    await user.click(screen.getByRole('button', { name: 'เพิ่มเข้า watchlist' }))
    const list = await screen.findByRole('list', { name: 'สินทรัพย์ที่ติดตาม' })
    expect(within(list).getByText('PTT')).toBeInTheDocument()
    expect(within(list).getByText('ถึงราคาที่อยากซื้อ')).toBeInTheDocument()
    expect(within(list).getByText(/ล่าสุด 30.00 · อยากซื้อต่ำกว่า 31.00/)).toBeInTheDocument()
  })

  it('keeps the checklist in settings and offers it when a buy is recorded', async () => {
    const user = userEvent.setup()
    const router = renderRoute('/plans')
    await user.type(await screen.findByLabelText('เพิ่มข้อ'), 'มี Stop loss')
    await user.click(screen.getByRole('button', { name: 'เพิ่ม' }))
    expect(await screen.findByText('1. มี Stop loss')).toBeInTheDocument()
    expect((await db.settings.get('app'))?.checklist).toEqual(['มี Stop loss'])
    await router.navigate('/transactions/new')
    await user.click(await screen.findByRole('button', { name: /บันทึกการเทรด/ }))
    await user.click(screen.getByRole('checkbox', { name: 'มี Stop loss' }))
    expect(screen.getByText('ติ๊กแล้ว 1 จาก 1 ข้อ')).toBeInTheDocument()
  })
})

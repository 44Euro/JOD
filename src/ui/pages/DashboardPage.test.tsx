import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { fakeFxProvider } from '../../test/fakeFx'
import { makeTx } from '../../test/fixtures'
import { renderRoute, resetDb } from '../../test/render'

const account = { id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' }

describe('DashboardPage', () => {
  beforeEach(resetDb)

  it('welcomes a new user who has no account yet', async () => {
    renderRoute('/')
    expect(await screen.findByRole('heading', { name: 'ยินดีต้อนรับสู่ JOD' })).toBeInTheDocument()
  })

  it('summarizes realized gains by stock and currency, income and fees', async () => {
    await db.accounts.add(account)
    await db.transactions.bulkAdd([
      makeTx({ quantity: '10', price: '100', fees: '1', fxRate: '35', date: '2024-01-10' }),
      makeTx({ type: 'sell', quantity: '10', price: '120', fxRate: '33', date: '2024-03-10' }),
      makeTx({ type: 'dividend', quantity: undefined, price: undefined, amount: '10', tax: '1.5', fxRate: '34', date: '2024-02-01' }),
    ])
    renderRoute('/')
    expect(await screen.findByText('+4,565.00')).toBeInTheDocument()
    expect(screen.getByText('จากหุ้น +6,965.00 · จากค่าเงิน −2,400.00')).toBeInTheDocument()
    expect(screen.getByText('289.00 THB')).toBeInTheDocument()
    expect(screen.getByText('ค่าธรรมเนียมรวม 35.00 THB')).toBeInTheDocument()
  })

  it('draws the route from cost to today and the rate board', async () => {
    await db.accounts.add(account)
    await db.instruments.add({
      id: 'US:AAPL',
      market: 'US',
      symbol: 'AAPL',
      name: 'Apple',
      assetType: 'stock',
      currency: 'USD',
      lastPrice: '120',
    })
    await db.transactions.add(makeTx({ quantity: '10', price: '100', fxRate: '35' }))
    renderRoute('/', fakeFxProvider({ 'USD|THB': '33' }).provider)
    const route = await screen.findByRole('list', { name: 'จากทุนถึงมูลค่าวันนี้' })
    expect(within(route).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '35,000ทุนของที่ถืออยู่',
      '+7,000จากหุ้น · ยังไม่ขาย',
      '−2,400จากค่าเงิน · ยังไม่ขาย',
      '39,600มูลค่าวันนี้',
    ])
    const board = screen.getByRole('region', { name: 'กระดานเรทของคุณ' })
    expect(within(board).getByText('−5.71%')).toBeInTheDocument()
    expect(within(board).getByText('−2,400.00 THB')).toBeInTheDocument()
  })
})

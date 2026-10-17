import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { fakeFxProvider, lateFxProvider } from '../../test/fakeFx'
import { makeTx } from '../../test/fixtures'
import { renderRoute, resetDb } from '../../test/render'

const voo = { id: 'US:VOO', market: 'US', symbol: 'VOO', name: 'Vanguard S&P 500', assetType: 'etf', currency: 'USD', lastPrice: '500' } as const
const usd = fakeFxProvider({ 'USD|THB': '33' }).provider

beforeEach(async () => {
  await resetDb()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2024, 9, 16, 9, 0))
  await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
  await db.transactions.bulkAdd([
    makeTx({ instrumentId: 'US:VOO', quantity: '10', price: '400', fees: '2', fxRate: '35', date: '2024-01-10', note: 'DCA' }),
    makeTx({ instrumentId: 'US:VOO', type: 'dividend', quantity: undefined, price: undefined, amount: '20', tax: '3', fxRate: '34', date: '2024-03-01' }),
    makeTx({ instrumentId: 'US:VOO', type: 'sell', quantity: '2', price: '450', fees: '1', fxRate: '34', date: '2024-04-01' }),
  ])
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('AssetPage', () => {
  it('shows nothing about the asset’s value until the rates arrive', async () => {
    await db.instruments.add(voo)
    const { provider, release, requested } = lateFxProvider({ 'USD|THB': '33' })
    renderRoute('/assets/US%3AVOO', provider)
    await waitFor(() => expect(requested()).toBeGreaterThan(0))
    expect(screen.getByText('กำลังโหลด…')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'VOO' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'เส้นทางเงินของ VOO' })).not.toBeInTheDocument()

    release()
    expect(await screen.findByText('฿132,000', { selector: 'p' })).toBeInTheDocument()
  })

  it('sums the asset up with its total return including dividends', async () => {
    await db.instruments.add(voo)
    renderRoute('/assets/US%3AVOO', usd)
    expect(await screen.findByRole('heading', { name: 'VOO' })).toBeInTheDocument()
    expect(await screen.findByText('มูลค่าวันนี้ · 8 หน่วย × 500.00 USD')).toBeInTheDocument()
    expect(await screen.findByText('฿132,000', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('+23,074')).toBeInTheDocument()
    expect(screen.getByText('+20.6% รวมปันผล')).toBeInTheDocument()
    expect(screen.getByText('฿578')).toBeInTheDocument()
    expect(screen.getByText('ปันผล/ทุน 0.5%')).toBeInTheDocument()
    expect(screen.getByText('400.20', { selector: 'p' })).toBeInTheDocument()
  })

  it('draws the six-station route and the three badges under it', async () => {
    await db.instruments.add(voo)
    renderRoute('/assets/US%3AVOO', usd)
    const route = await screen.findByRole('list', { name: 'เส้นทางเงินของ VOO' })
    await waitFor(() => expect(within(route).getAllByRole('listitem')[4]).toHaveTextContent('33.00เรทวันนี้ · บาทแข็งขึ้น'))
    expect(within(route).getAllByRole('listitem')).toHaveLength(6)
    expect(screen.getByText('จากหุ้น +27,944')).toHaveClass('bg-gain-soft')
    expect(screen.getByText('จากค่าเงิน −8,000')).toBeInTheDocument()
    expect(screen.getByText('ปันผล +578')).toBeInTheDocument()
  })

  it('lists every transaction of the asset and the summary of realized gain and fees', async () => {
    await db.instruments.add(voo)
    renderRoute('/assets/US%3AVOO', usd)
    expect(await screen.findByText('ทั้งหมด 3 รายการ')).toBeInTheDocument()
    const rows = within(screen.getAllByRole('table').at(-1)!).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('1 เม.ย. 2024ขาย')
    expect(rows[2]).toHaveTextContent('20 หัก ณ ที่จ่าย 3')
    expect(rows[3]).toHaveTextContent('10 × 400.00 · DCA')
    expect(screen.getByText('กำไรที่ขายแล้ว').nextSibling).toHaveTextContent('+2,552')
    expect(screen.getByText('ค่าธรรมเนียมรวม').nextSibling).toHaveTextContent('104')
  })

  it('saves the reason for holding, the target price and the review date', async () => {
    await db.instruments.add(voo)
    const user = userEvent.setup()
    renderRoute('/assets/US%3AVOO', usd)
    await user.click(await screen.findByRole('button', { name: 'แก้ไขเหตุผลที่ถือ' }))
    await user.type(screen.getByLabelText('ทำไมถึงซื้อ / ถือ'), 'ถือยาว ทยอยซื้อทุกเดือน')
    await user.type(screen.getByLabelText('ราคาเป้าหมาย (USD)'), 'abc')
    await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(screen.getByRole('alert')).toHaveTextContent('ราคาเป้าหมายต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป')

    await user.clear(screen.getByLabelText('ราคาเป้าหมาย (USD)'))
    await user.type(screen.getByLabelText('ราคาเป้าหมาย (USD)'), '1,200')
    await user.type(screen.getByLabelText('วันทบทวน'), '2024-10-01')
    await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(await screen.findByText('1,200.00 USD')).toBeInTheDocument()
    expect(screen.getByText('ถือยาว ทยอยซื้อทุกเดือน', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('ถึงวันทบทวนแล้ว')).toBeInTheDocument()
    expect(await db.instruments.get('US:VOO')).toMatchObject({ targetPrice: '1200', reviewDate: '2024-10-01' })
  })

  it('shows a falling stock price in the loss colour', async () => {
    await db.instruments.add({ ...voo, lastPrice: '300' })
    renderRoute('/assets/US%3AVOO', usd)
    expect(await screen.findByText('จากหุ้น −28,056')).toHaveClass('bg-loss-soft')
  })

  it('closes the editor when another asset opens', async () => {
    await db.instruments.bulkAdd([voo, { id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'AAPL', assetType: 'stock', currency: 'USD' }])
    const user = userEvent.setup()
    const router = renderRoute('/assets/US%3AVOO', usd)
    await user.click(await screen.findByRole('button', { name: 'แก้ไขเหตุผลที่ถือ' }))
    expect(screen.getByLabelText('ทำไมถึงซื้อ / ถือ')).toBeInTheDocument()
    await act(() => router.navigate('/assets/US%3AAAPL'))
    expect(await screen.findByRole('heading', { name: 'AAPL' })).toBeInTheDocument()
    expect(screen.queryByLabelText('ทำไมถึงซื้อ / ถือ')).not.toBeInTheDocument()
  })

  it('gives the back link a phone-sized touch target', async () => {
    await db.instruments.add(voo)
    renderRoute('/assets/US%3AVOO', usd)
    await screen.findByRole('heading', { name: 'VOO' })
    const back = within(screen.getByRole('main')).getByRole('link', { name: 'พอร์ต' })
    expect(back).toHaveAttribute('href', '/portfolio')
    expect(back).toHaveClass('min-h-11', 'w-fit')
  })

  it('shows the transactions as two-line rows on a phone and calls an estimated rate an estimate', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    await db.instruments.add(voo)
    await db.transactions.add(makeTx({ instrumentId: 'US:VOO', quantity: '1', price: '410', fxRate: '34.12', fxSource: 'estimated', date: '2024-02-01' }))
    renderRoute('/assets/US%3AVOO', usd)
    const list = await screen.findByRole('list', { name: 'ทุกรายการของ VOO' })
    expect(within(list).getByText('ซื้อ 1 × 410.00 · เรทประมาณ 34.12')).toBeInTheDocument()
    expect(within(list).getByText('ซื้อ 10 × 400.00 · เรท 35.00')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('says so when the asset does not exist', async () => {
    renderRoute('/assets/US%3ANOPE')
    expect(await screen.findByText('ไม่พบสินทรัพย์นี้')).toBeInTheDocument()
  })
})

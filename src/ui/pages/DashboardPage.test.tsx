import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { fakeFxProvider } from '../../test/fakeFx'
import { makeTx } from '../../test/fixtures'
import { renderRoute, resetDb } from '../../test/render'

const account = { id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' }
const usd = () => fakeFxProvider({ 'USD|THB': '33' }).provider
const thb = { currency: 'THB', fxRate: '1', fxSource: 'same' as const, instrumentId: undefined, quantity: undefined, price: undefined }

// The account from the investor tests: deposit, convert, buy, dividend, sell, account fee, withdraw.
async function seedDime(instrument: Record<string, string> = {}) {
  await db.accounts.add(account)
  await db.instruments.add({ id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD', lastPrice: '120', ...instrument })
  await db.transactions.bulkAdd([
    makeTx({ ...thb, type: 'deposit', amount: '35000', date: '2024-01-02' }),
    makeTx({ ...thb, type: 'fx_convert', amount: '34000', toCurrency: 'USD', toAmount: '1000', marketRate: '33.5', date: '2024-01-03' }),
    makeTx({ type: 'buy', quantity: '5', price: '100', fees: '1', fxRate: '34', date: '2024-01-04' }),
    makeTx({ type: 'dividend', quantity: undefined, price: undefined, amount: '10', tax: '1.5', fxRate: '34', date: '2024-02-01' }),
    makeTx({ type: 'sell', quantity: '2', price: '110', fees: '1', fxRate: '33', date: '2024-02-02' }),
    makeTx({ type: 'fee', instrumentId: undefined, quantity: undefined, price: undefined, amount: '2', fxRate: '33', date: '2024-02-03' }),
    makeTx({ ...thb, type: 'withdraw', amount: '1000', date: '2024-02-04' }),
  ])
}

function setToday(year: number, monthIndex: number, day: number) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(year, monthIndex, day, 9, 0))
}

describe('DashboardPage', () => {
  beforeEach(resetDb)
  afterEach(() => {
    vi.useRealTimers()
  })

  it('welcomes a new user who has no account yet', async () => {
    renderRoute('/')
    expect(await screen.findByRole('heading', { name: 'ยินดีต้อนรับสู่ JOD' })).toBeInTheDocument()
  })

  it('shows value today, money invested, total gain and the return since the start under a year', async () => {
    setToday(2024, 6, 1)
    await seedDime()
    renderRoute('/', usd())
    expect(await screen.findByText('มูลค่าวันนี้ · สินทรัพย์ + เงินสด')).toBeInTheDocument()
    expect(await screen.findByText('฿35,789')).toBeInTheDocument()
    expect(screen.getByText('฿34,000')).toBeInTheDocument()
    expect(screen.getByText('ฝาก 35,000 · ถอน 1,000')).toBeInTheDocument()
    expect(screen.getByText('+1,789')).toBeInTheDocument()
    expect(screen.getByText('ตั้งแต่ 2 ม.ค. 2024')).toBeInTheDocument()
    expect(screen.getByText('ผลตอบแทนตั้งแต่เริ่ม')).toBeInTheDocument()
    expect(screen.getByText('+5.2%')).toBeInTheDocument()
    expect(screen.getByText('ข้อมูลยังไม่ถึง 1 ปี')).toBeInTheDocument()
    expect(screen.queryByText('ผลตอบแทนต่อปี')).not.toBeInTheDocument()
  })

  it('shows the annual return once there is a year of history', async () => {
    setToday(2025, 6, 1)
    await seedDime()
    renderRoute('/', usd())
    expect(await screen.findByText('ผลตอบแทนต่อปี')).toBeInTheDocument()
    expect(await screen.findByText('+3.5%')).toBeInTheDocument()
    expect(screen.getByText('+5.3% ตั้งแต่เริ่ม')).toBeInTheDocument()
  })

  it('walks from money invested to today in seven stations that add up', async () => {
    setToday(2024, 6, 1)
    await seedDime()
    renderRoute('/', usd())
    const route = await screen.findByRole('list', { name: 'จากเงินลงทุนถึงวันนี้' })
    await waitFor(() =>
      expect(within(route).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        '34,000เงินลงทุน',
        '+2,020หุ้นขึ้น · ยังไม่ขาย',
        '−360ค่าเงิน · ยังไม่ขาย',
        '+413ขายแล้ว',
        '+289ปันผล ดอกเบี้ย',
        '−573ค่าธรรมเนียม · ค่าเงินเงินสด',
        '35,789วันนี้',
      ]),
    )
    const board = screen.getByRole('region', { name: 'กระดานเรทของคุณ' })
    expect(within(board).getByText('−2.94%')).toBeInTheDocument()
    expect(within(board).getByText('−360.00 THB')).toBeInTheDocument()
  })

  it('links the largest asset’s short route and warns about old prices and review dates', async () => {
    setToday(2024, 6, 1)
    await seedDime({ lastPriceAt: new Date(2024, 5, 20, 12).toISOString(), reviewDate: '2024-06-30' })
    renderRoute('/', usd())
    const route = await screen.findByRole('link', { name: /เส้นทางเงิน · AAPL/ })
    expect(route).toHaveAttribute('href', '/assets/US%3AAAPL')
    expect(within(route).getByText('แลกที่ 34.00')).toBeInTheDocument()
    expect(within(route).getByText('AAPL @100.20')).toBeInTheDocument()
    expect(screen.getByText('ราคาเก่า')).toBeInTheDocument()
    expect(screen.getByText(/ราคา 1 ตัวไม่ได้อัปเดตเกิน 7 วัน/)).toBeInTheDocument()
    expect(screen.getByText(/ถึงวันทบทวนเหตุผลที่ถือ AAPL/)).toBeInTheDocument()
  })

  it('counts a holding without a price at cost and says so', async () => {
    setToday(2024, 6, 1)
    await seedDime({ lastPrice: '' })
    renderRoute('/', usd())
    expect(await screen.findByText(/ยังไม่มีราคาล่าสุด 1 ตัว \(นับที่ทุนไปก่อน\)/)).toBeInTheDocument()
  })

  describe('phone touch targets', () => {
    it('gives the link to the whole portfolio the standalone link pattern', async () => {
      setToday(2024, 6, 1)
      await seedDime()
      renderRoute('/', usd())
      const link = await screen.findByRole('link', { name: 'ดูพอร์ตทั้งหมด' })
      expect(link).toHaveAttribute('href', '/portfolio')
      expect(link).toHaveClass('-my-3', 'inline-flex', 'min-h-11', 'items-center', 'md:my-0', 'md:min-h-0')
    })

    it('grows the links inside the issues alert on a phone without moving the text', async () => {
      setToday(2024, 6, 1)
      await db.accounts.add(account)
      await db.transactions.add(makeTx({ type: 'sell', quantity: '1', price: '100', fxRate: '34', date: '2024-01-05' }))
      renderRoute('/', usd())
      const link = await screen.findByRole('link', { name: 'ไปตรวจสอบ' })
      expect(link.closest('[role="alert"]')).toHaveClass('max-md:[&_a]:py-3')
    })

    it('does the same for the links inside the price and review notes', async () => {
      setToday(2024, 6, 1)
      await seedDime({ lastPrice: '', reviewDate: '2024-06-30' })
      renderRoute('/', usd())
      for (const name of ['กรอกราคา', 'เปิดดู']) {
        const link = await screen.findByRole('link', { name })
        expect(link.closest('[role="note"]')).toHaveClass('max-md:[&_a]:py-3')
      }
    })
  })
})

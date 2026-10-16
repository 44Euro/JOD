import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { makeTx } from '../../test/fixtures'
import { renderRoute, resetDb } from '../../test/render'

const cashFree = { quantity: undefined, price: undefined }
const baht = { currency: 'THB', fxRate: '1', fxSource: 'same' as const }

beforeEach(async () => {
  await resetDb()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2025, 9, 16, 9, 0))
  await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function seedIncome() {
  await db.instruments.bulkAdd([
    { id: 'US:VOO', market: 'US', symbol: 'VOO', name: 'Vanguard S&P 500', assetType: 'etf', currency: 'USD' },
    { id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'ปตท.', assetType: 'stock', currency: 'THB' },
  ])
  await db.transactions.bulkAdd([
    makeTx({ ...baht, instrumentId: 'SET:PTT', quantity: '1000', price: '30', date: '2024-01-05' }),
    makeTx({ ...cashFree, type: 'dividend', instrumentId: 'US:VOO', amount: '10', tax: '1.5', fxRate: '34', date: '2024-03-05' }),
    makeTx({ ...cashFree, ...baht, type: 'dividend', instrumentId: 'SET:PTT', amount: '1000', tax: '100', date: '2024-11-20' }),
    makeTx({ ...cashFree, ...baht, type: 'interest', instrumentId: undefined, amount: '100', tax: '15', date: '2025-02-10' }),
    makeTx({ ...cashFree, type: 'dividend', instrumentId: 'US:VOO', amount: '12', tax: '1.8', fxRate: '33', date: '2025-03-05' }),
    makeTx({ ...cashFree, ...baht, type: 'dividend', instrumentId: 'SET:PTT', amount: '1200', tax: '120', date: '2025-08-20' }),
  ])
}

describe('IncomePage', () => {
  it('invites the user to record income when there is none', async () => {
    renderRoute('/income')
    expect(await screen.findByText('ยังไม่มีรายได้')).toBeInTheDocument()
    expect(screen.getByText('บันทึกปันผลหรือดอกเบี้ยแล้วจะสรุปให้ที่นี่')).toBeInTheDocument()
  })

  it('sums this year after tax and compares it with the same days last year', async () => {
    await seedIncome()
    renderRoute('/income')
    expect(await screen.findByText('รายได้ปีนี้ · หลังหักภาษี')).toBeInTheDocument()
    expect(screen.getByText('฿1,502')).toBeInTheDocument()
    expect(screen.getByText('+419.6%')).toBeInTheDocument()
    expect(screen.getByText('ช่วงเดียวกันปีก่อน ฿289')).toBeInTheDocument()
    expect(screen.getByText('฿200')).toBeInTheDocument()
    expect(screen.getByText('12 เดือนล่าสุด ฿2,402')).toBeInTheDocument()
    expect(screen.getByText('฿194')).toBeInTheDocument()
    expect(screen.getByText('SET 10% · US 15%')).toBeInTheDocument()
  })

  it('stacks each month of the year by kind of income', async () => {
    await seedIncome()
    renderRoute('/income')
    const bars = await screen.findByRole('list', { name: 'รายได้แต่ละช่วง' })
    const months = within(bars).getAllByRole('listitem')
    expect(months).toHaveLength(12)
    expect(months[1]).toHaveTextContent('ก.พ. 2025 ฿85')
    expect(months[7]).toHaveTextContent('ส.ค. 2025 ฿1,080')
    expect(screen.getByText('ปันผล ฿1,417')).toBeInTheDocument()
    expect(screen.getByText('ดอกเบี้ย/คูปอง ฿85')).toBeInTheDocument()
  })

  it('ranks assets by income with their yield on cost', async () => {
    await seedIncome()
    renderRoute('/income')
    const ptt = (await screen.findByText('PTT', { selector: 'b' })).closest('tr')!
    expect(within(ptt).getByText('1,080')).toBeInTheDocument()
    expect(within(ptt).getByText('6.6%')).toBeInTheDocument()
    const cash = screen.getByText('ดอกเบี้ยเงินสด').closest('tr')!
    expect(within(cash).getByText('Dime US')).toBeInTheDocument()
    expect(within(cash).getByText('85')).toBeInTheDocument()
    const recent = screen.getByRole('list', { name: 'รายได้ล่าสุด' })
    expect(within(recent).getAllByRole('listitem')[0]).toHaveTextContent('PTT ปันผล20 ส.ค. 2025 · หัก 120+1,080')
  })

  it('switches to everything, shown by year', async () => {
    await seedIncome()
    const user = userEvent.setup()
    renderRoute('/income')
    await user.click(await screen.findByRole('button', { name: 'ทั้งหมด' }))
    expect(screen.getByText('รายได้ทั้งหมด · หลังหักภาษี')).toBeInTheDocument()
    expect(screen.getByText('฿2,691')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'รายปี' })).toBeInTheDocument()
    const years = within(screen.getByRole('list', { name: 'รายได้แต่ละช่วง' })).getAllByRole('listitem')
    expect(years.map((year) => year.textContent)).toEqual(['2024 ฿1,189', '2025 ฿1,502'])
  })

  it('compares this year with last year when everything is shown', async () => {
    await seedIncome()
    const user = userEvent.setup()
    renderRoute('/income')
    await user.click(await screen.findByRole('button', { name: 'ทั้งหมด' }))
    expect(screen.getByText('ปีนี้เทียบปีก่อน')).toBeInTheDocument()
    expect(screen.getByText('+419.6%')).toBeInTheDocument()
    expect(screen.getByText('ปีนี้ ฿1,502 · ช่วงเดียวกันปีก่อน ฿289')).toBeInTheDocument()
  })

  it('names the twelve months in the headline and the table with a space', async () => {
    await seedIncome()
    const user = userEvent.setup()
    renderRoute('/income')
    await user.click(await screen.findByRole('button', { name: '12 เดือนล่าสุด' }))
    expect(screen.getByText('รายได้ 12 เดือนล่าสุด · หลังหักภาษี')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'รายได้ 12 เดือนล่าสุด (THB)' })).toBeInTheDocument()
    expect(screen.getByText('12 เดือนก่อนหน้า ฿289')).toBeInTheDocument()
  })

  it('shows the net after tax and fees for an asset whose dividend carried a fee', async () => {
    await db.instruments.add({ id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'ปตท.', assetType: 'stock', currency: 'THB' })
    await db.transactions.add(
      makeTx({ ...cashFree, ...baht, type: 'dividend', instrumentId: 'SET:PTT', amount: '1000', tax: '100', fees: '50', date: '2025-08-20' }),
    )
    renderRoute('/income')
    const ptt = (await screen.findByText('PTT', { selector: 'b' })).closest('tr')!
    expect(within(ptt).getByText('850')).toBeInTheDocument()
    expect(within(ptt).getByText('100')).toBeInTheDocument()
  })

  it('labels cash interest with every currency it came in', async () => {
    await db.transactions.bulkAdd([
      makeTx({ ...cashFree, ...baht, type: 'interest', instrumentId: undefined, amount: '100', date: '2025-02-10' }),
      makeTx({ ...cashFree, type: 'interest', instrumentId: undefined, amount: '5', fxRate: '34', date: '2025-03-10' }),
    ])
    renderRoute('/income')
    const cash = (await screen.findByText('ดอกเบี้ยเงินสด')).closest('tr')!
    expect(within(cash).getByText('THB/USD')).toBeInTheDocument()
    expect(within(cash).getByText('270')).toBeInTheDocument()
  })

  it('shows two-line rows on a phone', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    await seedIncome()
    renderRoute('/income')
    const list = await screen.findByRole('list', { name: 'รายได้ตามสินทรัพย์' })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const items = within(list).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('PTT1,080ปันผล/ทุน 6.6% · หัก 120')
    const cash = items.find((item) => item.textContent?.includes('Dime US'))!
    expect(within(cash).getByText('ดอกเบี้ยเงินสด · หัก 15')).toBeInTheDocument()
    expect(within(cash).getAllByText(/ดอกเบี้ยเงินสด/)).toHaveLength(1)
    expect(cash).not.toHaveTextContent('ปันผล/ทุน')
  })
})

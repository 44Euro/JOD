import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_KEY_STORAGE_KEY, READER_MODE_STORAGE_KEY } from '../../ai/apiKey'
import { AiError, type AiReader } from '../../ai/reader'
import { createLocalReader } from '../../ai/localReader'
import { db } from '../../db/db'
import { makeTx } from '../../test/fixtures'
import { fakeFxProvider } from '../../test/fakeFx'
import { renderRoute, resetDb } from '../../test/render'

const account = { id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' }
const local = createLocalReader({ recognize: async () => '', pdfLines: async () => [] })
const fx = () => fakeFxProvider({ 'USD|THB': '33.58' }).provider

const orders = 'Trade Date,Symbol,Side,Quantity,Price,Commission,Currency\n10/15/2024,AAPL,Buy,10,172.40,1.50,USD\n01/15/2024,AAPL,Buy,1,100,0,USD'
const holdings = 'Symbol,Shares,Average Cost,Market Price,Currency\nVOO,40,455.20,512.30,USD\nAAPL,15,172.40,185,USD'

async function upload(text: string, name = 'export.csv') {
  const user = userEvent.setup()
  await user.upload(await screen.findByLabelText('เลือกรูปหรือไฟล์'), new File([text], name, { type: 'text/csv' }))
  await screen.findByText(name)
  return user
}

beforeEach(async () => {
  await resetDb()
  await db.accounts.add(account)
  localStorage.removeItem(READER_MODE_STORAGE_KEY)
  localStorage.removeItem(API_KEY_STORAGE_KEY)
})

afterEach(() => vi.restoreAllMocks())

describe('ImportPage', () => {
  it('reads an export on the device, leaves a repeat unticked and saves the rest as one batch that can be undone', async () => {
    await db.transactions.add(makeTx({ id: 'mine', date: '2024-01-15', quantity: '1' }))
    renderRoute('/import', fx(), local)
    expect(await screen.findByText(/ไม่มีค่าใช้จ่าย ไฟล์ไม่ออกจากเครื่อง/)).toBeInTheDocument()
    const user = await upload(orders)
    await user.click(screen.getByRole('button', { name: 'อ่านไฟล์' }))

    const list = await screen.findByRole('list', { name: 'รายการที่อ่านได้' })
    const boxes = within(list).getAllByRole('checkbox', { name: 'บันทึก AAPL' })
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, false])
    expect(within(list).getByText(/อาจซ้ำกับรายการซื้อ 15 ม\.ค\. 2024 ที่มีอยู่แล้ว · ไม่ได้เลือกไว้/)).toBeInTheDocument()
    await waitFor(() => expect(within(list).getAllByLabelText('เรท 1 USD = ? THB')[0]).toHaveValue('33.58'))

    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก 1 รายการ' }))
    expect(await screen.findByText(/บันทึก 1 รายการแล้ว/)).toBeInTheDocument()
    const [batch] = await db.imports.toArray()
    const saved = await db.transactions.where('importBatchId').equals(batch.id).toArray()
    expect(saved.map((t) => [t.date, t.quantity, t.price, t.fees, t.fxRate, t.fxSource])).toEqual([['2024-10-15', '10', '172.4', '1.5', '33.58', 'auto']])
    expect([batch.source, batch.count, batch.fileCount]).toEqual(['orders', 1, 1])

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const history = screen.getByRole('heading', { name: 'ประวัติการนำเข้า' }).parentElement!
    expect(within(history).getByText('ประวัติคำสั่ง 1 ไฟล์ · 1 รายการ')).toBeInTheDocument()
    await user.click(within(history).getByRole('button', { name: 'ยกเลิกการนำเข้าครั้งนี้' }))
    expect(await screen.findByText('ลบ 1 รายการจากการนำเข้าครั้งนั้นแล้ว')).toBeInTheDocument()
    expect((await db.transactions.toArray()).map((t) => t.id)).toEqual(['mine'])
  })

  it('carries holdings in at an estimated rate when the purchase rate is unknown, and updates their prices', async () => {
    renderRoute('/import', fx(), local)
    const user = await upload(holdings)
    await user.click(screen.getByRole('button', { name: 'อ่านไฟล์' }))
    await screen.findByRole('list', { name: 'รายการที่อ่านได้' })
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก 2 รายการ' }))
    expect(await screen.findByText('ใส่เรทเฉลี่ยตอนซื้อของ USD')).toBeInTheDocument()
    expect(await db.transactions.count()).toBe(0)

    await user.click(await screen.findByRole('button', { name: 'ใช้เรทกลาง 33.58 เป็นค่าประมาณ' }))
    expect(screen.getByLabelText('เรทเฉลี่ยตอนซื้อ (1 USD = ? THB)')).toHaveValue('33.58')
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก 2 รายการ' }))
    await screen.findByText(/บันทึก 2 รายการแล้ว/)
    const saved = await db.transactions.orderBy('date').toArray()
    saved.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    expect(saved.map((t) => [t.type, t.instrumentId, t.fxSource, t.referenceFxRate])).toEqual([
      ['opening', 'US:VOO', 'estimated', '33.58'],
      ['opening', 'US:AAPL', 'estimated', '33.58'],
    ])
    expect((await db.instruments.get('US:VOO'))?.lastPrice).toBe('512.3')
  })

  it('asks for a key before reading with Claude', async () => {
    localStorage.setItem(READER_MODE_STORAGE_KEY, 'claude')
    renderRoute('/import', fx(), local)
    await upload(holdings)
    expect(screen.getByRole('button', { name: 'ให้ AI อ่าน' })).toBeDisabled()
    expect(screen.getByText(/ใส่ API key ของ Anthropic ในหน้าตั้งค่าก่อน/)).toBeInTheDocument()
  })

  it('explains a failed read and offers to type the records instead', async () => {
    const failing: AiReader = { read: () => Promise.reject(new AiError('API key ไม่ถูกต้อง ตรวจอีกครั้งในหน้าตั้งค่า')), test: async () => {} }
    renderRoute('/import', fx(), failing)
    const user = await upload(holdings)
    await user.click(screen.getByRole('button', { name: 'อ่านไฟล์' }))
    expect(await screen.findByText(/API key ไม่ถูกต้อง/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'กรอกรายการเอง' })).toHaveAttribute('href', '/transactions/new')
    expect(screen.getByText('export.csv')).toBeInTheDocument()
  })

  it('compares the broker holdings with what the app counts, saving nothing', async () => {
    await db.instruments.bulkAdd([
      { id: 'US:VOO', market: 'US', symbol: 'VOO', name: 'VOO', assetType: 'etf', currency: 'USD' },
      { id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'AAPL', assetType: 'stock', currency: 'USD' },
    ])
    await db.transactions.bulkAdd([makeTx({ id: 'v', instrumentId: 'US:VOO', quantity: '40' }), makeTx({ id: 'a', instrumentId: 'US:AAPL', quantity: '10' })])
    renderRoute('/import?purpose=compare', fx(), local)
    const user = await upload(holdings)
    await user.click(screen.getByRole('button', { name: 'อ่านไฟล์' }))
    const result = await screen.findByRole('list', { name: 'ผลการเทียบยอด' })
    expect(screen.getByText('ตรงกัน 1 จาก 2 ตัว')).toBeInTheDocument()
    expect(within(result).getByText('จำนวนไม่ตรง')).toBeInTheDocument()
    expect(within(result).getByText(/ในโบรก 15 · ในแอป 10 · ต่าง 5/)).toBeInTheDocument()
    expect(await db.transactions.count()).toBe(2)
  })

  it('updates the latest prices of held assets from a portfolio file', async () => {
    await db.instruments.add({ id: 'US:VOO', market: 'US', symbol: 'VOO', name: 'VOO', assetType: 'etf', currency: 'USD', lastPrice: '500' })
    renderRoute('/import?purpose=prices', fx(), local)
    const user = await upload(holdings)
    await user.click(screen.getByRole('button', { name: 'อ่านไฟล์' }))
    expect(await screen.findByLabelText('ราคาใหม่ของ VOO')).toHaveValue('512.3')
    expect(screen.getByText('ไม่มีในพอร์ต จึงข้ามไป: AAPL')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'อัปเดตราคา 1 ตัว' }))
    expect(await screen.findByText('อัปเดตราคา 1 ตัวแล้ว')).toBeInTheDocument()
    expect((await db.instruments.get('US:VOO'))?.lastPrice).toBe('512.3')
  })
})

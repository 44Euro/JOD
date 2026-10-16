import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { FxUnavailableError, type FxProvider } from '../../fx/frankfurter'
import { fakeFxProvider } from '../../test/fakeFx'
import { makeTx } from '../../test/fixtures'
import { renderRoute, resetDb } from '../../test/render'

const account = { id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' }

beforeEach(async () => {
  await resetDb()
  await db.accounts.add(account)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TransactionFormPage', () => {
  it('fills the FX rate automatically and saves a buy', async () => {
    const user = userEvent.setup()
    const router = renderRoute('/transactions/new', fakeFxProvider({ 'USD|THB': '35.1' }).provider)
    await user.type(await screen.findByLabelText('สัญลักษณ์'), 'aapl')
    await user.type(screen.getByLabelText('จำนวนหน่วย'), '2')
    await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '100')
    await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35.1'))
    expect(screen.getByText('200.00 USD')).toBeInTheDocument()
    expect(screen.getByText('≈ 7,020.00 THB ที่เรท 35.1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
    const [saved] = await db.transactions.toArray()
    expect(saved).toMatchObject({ instrumentId: 'US:AAPL', quantity: '2', price: '100', fxRate: '35.1', fxSource: 'auto' })
    expect(await db.instruments.get('US:AAPL')).toMatchObject({ symbol: 'AAPL', currency: 'USD' })
  })

  it('lets the user type a rate when no automatic rate exists', async () => {
    const user = userEvent.setup()
    renderRoute('/transactions/new', fakeFxProvider({}).provider)
    await user.selectOptions(await screen.findByLabelText('สกุลเงิน'), 'VND')
    expect(await screen.findByText(/ไม่มีเรทอัตโนมัติสำหรับ VND\/THB/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('สัญลักษณ์'), 'VNM')
    await user.type(screen.getByLabelText('จำนวนหน่วย'), '100')
    await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '25,000')
    await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(await screen.findByText('เรทแลกเปลี่ยนต้องเป็นตัวเลขมากกว่า 0')).toBeInTheDocument()
    expect(await db.transactions.count()).toBe(0)
    await user.type(screen.getByLabelText(/เรทแลกเปลี่ยน/), '0.0014')
    await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    await waitFor(async () => expect(await db.transactions.count()).toBe(1))
    expect((await db.transactions.toArray())[0]).toMatchObject({
      currency: 'VND',
      price: '25000',
      fxRate: '0.0014',
      fxSource: 'manual',
    })
  })

  it('blocks a sell larger than the holding', async () => {
    await db.transactions.add(makeTx({ quantity: '1', date: '2024-01-15' }))
    const user = userEvent.setup()
    renderRoute('/transactions/new', fakeFxProvider({ 'USD|THB': '35' }).provider)
    await user.click(await screen.findByRole('button', { name: 'ขาย' }))
    await user.type(screen.getByLabelText('สัญลักษณ์'), 'AAPL')
    expect(await screen.findByText('ถืออยู่ 1 หน่วย')).toBeInTheDocument()
    await user.type(screen.getByLabelText('จำนวนหน่วย'), '5')
    await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '100')
    await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
    await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(await screen.findByText('ขาย 5 หน่วย แต่ถืออยู่ 1 หน่วย')).toBeInTheDocument()
    expect(await db.transactions.count()).toBe(1)
  })

  it('records an opening holding with an estimated purchase rate', async () => {
    const user = userEvent.setup()
    renderRoute('/transactions/new', fakeFxProvider({ 'USD|THB': '33.58' }).provider)
    await user.selectOptions(await screen.findByLabelText('ประเภทอื่นๆ'), 'opening')
    await user.type(screen.getByLabelText('สัญลักษณ์'), 'VOO')
    await user.type(screen.getByLabelText('จำนวนหน่วย'), '10')
    await user.type(screen.getByLabelText('ต้นทุนเฉลี่ยต่อหน่วย'), '455.2')
    expect(screen.getByLabelText(/เรทเฉลี่ยตอนซื้อ/)).toHaveValue('')
    await user.click(await screen.findByRole('button', { name: /เป็นค่าประมาณ/ }))
    await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    await waitFor(async () => expect(await db.transactions.count()).toBe(1))
    expect((await db.transactions.toArray())[0]).toMatchObject({
      type: 'opening',
      instrumentId: 'US:VOO',
      fxRate: '33.58',
      fxSource: 'estimated',
    })
  })

  it('keeps the account, date and rate for the next entry after save and add another', async () => {
    const user = userEvent.setup()
    const router = renderRoute('/transactions/new', fakeFxProvider({ 'USD|THB': '35' }).provider)
    await user.type(await screen.findByLabelText('สัญลักษณ์'), 'AAPL')
    await user.type(screen.getByLabelText('จำนวนหน่วย'), '1')
    await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '100')
    await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
    await user.click(screen.getByRole('button', { name: 'บันทึกแล้วเพิ่มอีก' }))
    expect(await screen.findByRole('status')).toHaveTextContent('บันทึกแล้ว')
    expect(await db.transactions.count()).toBe(1)
    expect(router.state.location.pathname).toBe('/transactions/new')
    expect(screen.getByLabelText('สัญลักษณ์')).toHaveValue('')
    expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35')
  })

  it('deletes a transaction from its edit page', async () => {
    await db.transactions.add(makeTx({ id: 'buy-1' }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    const router = renderRoute('/transactions/buy-1', fakeFxProvider({ 'USD|THB': '35' }).provider)
    await user.click(await screen.findByRole('button', { name: 'ลบรายการนี้' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
    expect(await db.transactions.count()).toBe(0)
  })

  it('drops an automatic rate when the date changes to one without a quote', async () => {
    const provider: FxProvider = {
      async getRate(_from, _to, date) {
        if (date !== 'latest') throw new FxUnavailableError('ไม่มีเรทของวันนั้น')
        return { rate: '35', rateDate: '2024-01-15' }
      },
    }
    const user = userEvent.setup()
    renderRoute('/transactions/new', provider)
    await user.type(await screen.findByLabelText('สัญลักษณ์'), 'AAPL')
    await user.type(screen.getByLabelText('จำนวนหน่วย'), '1')
    await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '100')
    await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
    fireEvent.change(screen.getByLabelText('วันที่'), { target: { value: '2024-03-01' } })
    await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue(''))
    expect(await screen.findByText(/ไม่มีเรทของวันนั้น/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(await screen.findByText('เรทแลกเปลี่ยนต้องเป็นตัวเลขมากกว่า 0')).toBeInTheDocument()
    expect(await db.transactions.count()).toBe(0)
  })
})

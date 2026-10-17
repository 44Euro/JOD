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
    expect(screen.getByText('≈ 7,020.00 THB ที่เรท 35.10')).toBeInTheDocument()
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

  it('saves once when the save button is pressed twice quickly', async () => {
    const user = userEvent.setup()
    const router = renderRoute('/transactions/new', fakeFxProvider({ 'USD|THB': '35' }).provider)
    await user.type(await screen.findByLabelText('สัญลักษณ์'), 'AAPL')
    await user.type(screen.getByLabelText('จำนวนหน่วย'), '1')
    await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '100')
    await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
    await user.dblClick(screen.getByRole('button', { name: 'บันทึก' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
    await screen.findByRole('heading', { name: 'รายการทั้งหมด' })
    expect(await db.transactions.count()).toBe(1)
  })

  it('keeps the form and says so when saving fails', async () => {
    vi.spyOn(db.transactions, 'put').mockRejectedValueOnce(new Error('QuotaExceededError'))
    const user = userEvent.setup()
    const router = renderRoute('/transactions/new', fakeFxProvider({ 'USD|THB': '35' }).provider)
    await user.type(await screen.findByLabelText('สัญลักษณ์'), 'AAPL')
    await user.type(screen.getByLabelText('จำนวนหน่วย'), '1')
    await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '100')
    await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
    await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(await screen.findByText('บันทึกไม่สำเร็จ ข้อมูลยังไม่ถูกบันทึก ลองอีกครั้ง')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/transactions/new')
    expect(screen.getByLabelText('สัญลักษณ์')).toHaveValue('AAPL')
    expect(screen.getByRole('button', { name: 'บันทึก' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
    expect(await db.transactions.count()).toBe(1)
  })

  it('keeps the stored details of a known instrument', async () => {
    await db.instruments.add({ id: 'HK:0700', market: 'HK', symbol: '0700', name: 'Tencent', assetType: 'stock', currency: 'HKD' })
    const user = userEvent.setup()
    renderRoute('/transactions/new', fakeFxProvider({ 'USD|THB': '35', 'HKD|THB': '4.5' }).provider)
    await user.click(await screen.findByRole('button', { name: 'ปันผล' }))
    await user.selectOptions(screen.getByLabelText('ตลาด'), 'HK')
    await user.type(screen.getByLabelText('สัญลักษณ์'), '0700')
    await user.selectOptions(screen.getByLabelText('สกุลเงิน'), 'USD')
    await user.type(screen.getByLabelText('ปันผลก่อนหักภาษี'), '10')
    await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
    await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    await waitFor(async () => expect(await db.transactions.count()).toBe(1))
    expect((await db.transactions.toArray())[0]).toMatchObject({ type: 'dividend', instrumentId: 'HK:0700', currency: 'USD' })
    expect(await db.instruments.get('HK:0700')).toMatchObject({ currency: 'HKD', name: 'Tencent' })
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

  describe('currency exchange', () => {
    const exchangeDay = { target: { value: '2024-01-15' } }

    async function openExchange(provider: FxProvider) {
      const user = userEvent.setup()
      const router = renderRoute('/transactions/new', provider)
      await user.click(await screen.findByRole('button', { name: 'แลกเงิน' }))
      fireEvent.change(screen.getByLabelText('วันที่'), exchangeDay)
      return { user, router }
    }

    it('fills the received amount from the day’s mid rate with the fee taken out of the amount', async () => {
      const { user, router } = await openExchange(fakeFxProvider({ 'USD|THB': '33.5' }).provider)
      await user.type(screen.getByLabelText('จำนวนเงินต้นทาง'), '20000')
      await user.type(screen.getByLabelText('ค่าธรรมเนียม (หักจากยอดที่แลก)'), '50')
      await waitFor(() => expect(screen.getByLabelText('จำนวนที่ได้รับ')).toHaveValue('595.52'))
      expect(
        screen.getByText('คำนวณจากเรทกลาง ECB 15 ม.ค. 2024 · 1 USD = 33.50 THB · แก้เป็นยอดจริงจากโบรกได้'),
      ).toBeInTheDocument()
      expect(screen.getByText('เรทที่ได้ 1 USD = 33.5841 THB · เรทตลาด 33.50 · แพงกว่าตลาด 0.25%')).toBeInTheDocument()
      expect(screen.getByText('20,000.00 THB')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      expect((await db.transactions.toArray())[0]).toMatchObject({
        type: 'fx_convert',
        currency: 'THB',
        toCurrency: 'USD',
        amount: '20000',
        fees: '50',
        toAmount: '595.52',
        marketRate: '33.5',
      })
    })

    it('names the day the rate belongs to when the picked day has none of its own', async () => {
      const provider: FxProvider = {
        async getRate(_from, _to, date) {
          return { rate: '33.5', rateDate: date === '2024-06-15' ? '2024-06-14' : date }
        },
      }
      const user = userEvent.setup()
      renderRoute('/transactions/new', provider)
      await user.click(await screen.findByRole('button', { name: 'แลกเงิน' }))
      fireEvent.change(screen.getByLabelText('วันที่'), { target: { value: '2024-06-15' } })
      await user.type(screen.getByLabelText('จำนวนเงินต้นทาง'), '20000')
      expect(
        await screen.findByText('คำนวณจากเรทกลาง ECB 14 มิ.ย. 2024 · 1 USD = 33.50 THB · แก้เป็นยอดจริงจากโบรกได้'),
      ).toBeInTheDocument()
    })

    it('uses the rate of the date picked after the amount was filled in', async () => {
      const provider: FxProvider = {
        async getRate(_from, _to, date) {
          return { rate: date === '2024-01-16' ? '34' : '33.5', rateDate: date }
        },
      }
      const { user } = await openExchange(provider)
      await user.type(screen.getByLabelText('จำนวนเงินต้นทาง'), '20000')
      await user.type(screen.getByLabelText(/ค่าธรรมเนียม/), '50')
      await waitFor(() => expect(screen.getByLabelText('จำนวนที่ได้รับ')).toHaveValue('595.52'))
      fireEvent.change(screen.getByLabelText('วันที่'), { target: { value: '2024-01-16' } })
      await waitFor(() => expect(screen.getByLabelText('จำนวนที่ได้รับ')).toHaveValue('586.76'))
    })

    it('keeps an amount typed by hand when the fee changes and can go back to the computed one', async () => {
      const { user } = await openExchange(fakeFxProvider({ 'USD|THB': '33.5' }).provider)
      const received = screen.getByLabelText('จำนวนที่ได้รับ')
      await user.type(screen.getByLabelText('จำนวนเงินต้นทาง'), '20000')
      await waitFor(() => expect(received).toHaveValue('597.01'))
      await user.clear(received)
      await user.type(received, '590')
      await user.type(screen.getByLabelText(/ค่าธรรมเนียม/), '50')
      expect(received).toHaveValue('590')
      expect(screen.queryByText(/คำนวณจากเรทกลาง ECB/)).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'ใช้ยอดคำนวณ 595.52' }))
      expect(received).toHaveValue('595.52')
      expect(screen.queryByRole('button', { name: /ใช้ยอดคำนวณ/ })).not.toBeInTheDocument()
      await user.clear(screen.getByLabelText(/ค่าธรรมเนียม/))
      await user.type(screen.getByLabelText(/ค่าธรรมเนียม/), '100')
      expect(received).toHaveValue('594.03')
    })

    it('leaves the received amount to the user when the day has no mid rate', async () => {
      const { user } = await openExchange(fakeFxProvider({}).provider)
      await user.type(screen.getByLabelText('จำนวนเงินต้นทาง'), '20000')
      expect(await screen.findByText('ไม่มีเรทกลางของวันนั้น กรอกจำนวนที่ได้รับเอง')).toBeInTheDocument()
      const received = screen.getByLabelText('จำนวนที่ได้รับ')
      expect(received).toHaveValue('')
      await user.type(received, '600')
      expect(received).toHaveValue('600')
    })

    it('does not claim the rate is missing while it is still loading', async () => {
      const provider: FxProvider = { getRate: () => new Promise(() => {}) }
      const { user } = await openExchange(provider)
      await user.type(screen.getByLabelText('จำนวนเงินต้นทาง'), '20000')
      expect(screen.queryByText(/ไม่มีเรทกลางของวันนั้น/)).not.toBeInTheDocument()
    })

    it('rejects a fee as large as the amount exchanged', async () => {
      const { user } = await openExchange(fakeFxProvider({ 'USD|THB': '33.5' }).provider)
      await user.type(screen.getByLabelText('จำนวนเงินต้นทาง'), '100')
      await user.type(screen.getByLabelText(/ค่าธรรมเนียม/), '100')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      expect(await screen.findByText('ค่าธรรมเนียมต้องน้อยกว่าจำนวนเงินต้นทาง')).toBeInTheDocument()
      expect(await db.transactions.count()).toBe(0)
    })

    it('computes the next entry again after save and add another', async () => {
      const { user } = await openExchange(fakeFxProvider({ 'USD|THB': '33.5' }).provider)
      const received = screen.getByLabelText('จำนวนที่ได้รับ')
      await user.type(screen.getByLabelText('จำนวนเงินต้นทาง'), '20000')
      await waitFor(() => expect(received).toHaveValue('597.01'))
      await user.clear(received)
      await user.type(received, '590')
      await user.click(screen.getByRole('button', { name: 'บันทึกแล้วเพิ่มอีก' }))
      expect(await screen.findByRole('status')).toHaveTextContent('บันทึกแล้ว')
      expect((await db.transactions.toArray())[0]).toMatchObject({ amount: '20000', toAmount: '590' })
      expect(received).toHaveValue('')
      await user.type(screen.getByLabelText('จำนวนเงินต้นทาง'), '10000')
      await waitFor(() => expect(received).toHaveValue('298.51'))
    })

    it('keeps the saved received amount when an exchange is edited', async () => {
      await db.transactions.add(
        makeTx({
          id: 'fx-1',
          type: 'fx_convert',
          instrumentId: undefined,
          quantity: undefined,
          price: undefined,
          currency: 'THB',
          amount: '20000',
          fees: '50',
          toCurrency: 'USD',
          toAmount: '590',
          marketRate: '33.5',
          fxRate: '1',
          fxSource: 'same',
          date: '2024-01-15',
        }),
      )
      const user = userEvent.setup()
      renderRoute('/transactions/fx-1', fakeFxProvider({ 'USD|THB': '33.5' }).provider)
      const received = await screen.findByLabelText('จำนวนที่ได้รับ')
      expect(received).toHaveValue('590')
      await user.clear(screen.getByLabelText(/ค่าธรรมเนียม/))
      await user.type(screen.getByLabelText(/ค่าธรรมเนียม/), '100')
      expect(received).toHaveValue('590')
      expect(await screen.findByRole('button', { name: 'ใช้ยอดคำนวณ 594.03' })).toBeInTheDocument()
    })
  })
})

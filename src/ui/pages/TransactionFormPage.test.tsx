import { fireEvent, screen, waitFor, within } from '@testing-library/react'
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
  vi.unstubAllGlobals()
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

  it('gives the way back to the reference rate a phone-sized target', async () => {
    const user = userEvent.setup()
    renderRoute('/transactions/new', fakeFxProvider({ 'USD|THB': '35' }).provider)
    await user.type(await screen.findByLabelText('สัญลักษณ์'), 'AAPL')
    await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
    await user.clear(screen.getByLabelText(/เรทแลกเปลี่ยน/))
    await user.type(screen.getByLabelText(/เรทแลกเปลี่ยน/), '36')
    expect(await screen.findByRole('button', { name: 'กลับไปใช้เรทกลาง 35' })).toHaveClass(
      '-my-3',
      'inline-flex',
      'min-h-11',
      'items-center',
      'leading-5',
      'justify-self-start',
      'md:my-0',
      'md:min-h-0',
    )
  })

  describe('transfers between accounts', () => {
    const ibkr = { id: 'acc-2', name: 'IBKR', broker: 'IBKR', note: '', createdAt: '2024-01-01T00:00:00.000Z' }
    const provider = () => fakeFxProvider({ 'USD|THB': '35' }).provider

    async function openTransfer() {
      await db.transactions.add(makeTx({ id: 'buy-1', quantity: '10', date: '2024-01-15' }))
      const user = userEvent.setup()
      const router = renderRoute('/transactions/new', provider())
      await user.selectOptions(await screen.findByLabelText('ประเภทอื่นๆ'), 'โอนระหว่างบัญชี')
      return { user, router }
    }

    it('records a transfer of shares to another account', async () => {
      await db.accounts.add(ibkr)
      const { user, router } = await openTransfer()
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'aapl')
      expect(await screen.findByText('ถืออยู่ 10 หน่วย')).toBeInTheDocument()
      expect(screen.getByLabelText('บัญชีปลายทาง')).toHaveDisplayValue('IBKR')
      await user.type(screen.getByLabelText('จำนวนหน่วยที่โอน'), '4')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
      const row = screen.getByText('AAPL · Dime US')
      expect(row).toHaveClass('min-w-0')
      expect(row.nextSibling).toHaveClass('shrink-0', 'whitespace-nowrap')
      expect(screen.getByText('AAPL · Dime US').nextSibling).toHaveTextContent('10 → 6')
      expect(screen.getByText('AAPL · IBKR').nextSibling).toHaveTextContent('0 → 4')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      const saved = (await db.transactions.toArray()).find((t) => t.type === 'transfer')
      expect(saved).toMatchObject({ accountId: 'acc-1', toAccountId: 'acc-2', instrumentId: 'US:AAPL', quantity: '4', fees: '0' })
      expect(saved?.price).toBeUndefined()
    })

    it('says a transfer needs two accounts', async () => {
      const { user } = await openTransfer()
      const note = await screen.findByRole('note')
      expect(note).toHaveTextContent('ต้องมีอย่างน้อย 2 บัญชีจึงจะโอนได้ · เพิ่มบัญชีในหน้าตั้งค่า')
      expect(within(note).getByRole('link', { name: 'เพิ่มบัญชีในหน้าตั้งค่า' })).toHaveAttribute('href', '/settings')
      expect(screen.queryByLabelText('บัญชีปลายทาง')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      expect(await screen.findByText('กรุณาเลือกบัญชีปลายทาง')).toBeInTheDocument()
      expect(await db.transactions.count()).toBe(1)
    })

    it('refuses to transfer more than is held', async () => {
      await db.accounts.add(ibkr)
      const { user } = await openTransfer()
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'AAPL')
      await user.type(screen.getByLabelText('จำนวนหน่วยที่โอน'), '12')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      expect(await screen.findByText('โอน 12 หน่วย แต่ถืออยู่ 10 หน่วย')).toBeInTheDocument()
      expect(await db.transactions.count()).toBe(1)
    })

    it('moves cash with a transfer fee and no tax field', async () => {
      await db.accounts.add(ibkr)
      const { user, router } = await openTransfer()
      await user.click(screen.getByRole('button', { name: 'เงินสด' }))
      await user.selectOptions(screen.getByLabelText('สกุลเงิน'), 'THB')
      expect(screen.queryByLabelText('สัญลักษณ์')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('จำนวนหน่วยที่โอน')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('ภาษี / VAT')).not.toBeInTheDocument()
      await user.type(screen.getByLabelText('จำนวนเงินที่โอน'), '20000')
      await user.type(screen.getByLabelText('ค่าธรรมเนียมการโอน'), '25')
      expect(screen.getByText('20,000.00 THB')).toBeInTheDocument()
      expect(screen.getByText('เงินสด THB · IBKR').nextSibling).toHaveTextContent('0.00 → 20,000.00')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      const saved = (await db.transactions.toArray()).find((t) => t.type === 'transfer')
      expect(saved).toMatchObject({ toAccountId: 'acc-2', currency: 'THB', amount: '20000', fees: '25', fxRate: '1' })
      expect(saved?.instrumentId).toBeUndefined()
    })

    it('says the currency and rate of a transfer of units are only for its fee', async () => {
      await db.accounts.add(ibkr)
      const { user } = await openTransfer()
      expect(screen.getByLabelText('สกุลเงินของค่าธรรมเนียม')).toHaveValue('USD')
      expect(screen.queryByLabelText('สกุลเงิน')).not.toBeInTheDocument()
      expect(await screen.findByText('ใช้คิดค่าธรรมเนียมการโอนเป็นบาทเท่านั้น')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'ซื้อ' }))
      expect(screen.getByLabelText('สกุลเงิน')).toBeInTheDocument()
      expect(screen.queryByLabelText('สกุลเงินของค่าธรรมเนียม')).not.toBeInTheDocument()
      expect(screen.queryByText(/ใช้คิดค่าธรรมเนียมการโอน/)).not.toBeInTheDocument()
    })

    it('keeps the plain currency label for cash but still says the rate is only for the fee', async () => {
      await db.accounts.add(ibkr)
      const { user } = await openTransfer()
      await user.click(screen.getByRole('button', { name: 'เงินสด' }))
      expect(screen.getByLabelText('สกุลเงิน')).toHaveValue('USD')
      expect(screen.queryByLabelText('สกุลเงินของค่าธรรมเนียม')).not.toBeInTheDocument()
      expect(await screen.findByText('ใช้คิดค่าธรรมเนียมการโอนเป็นบาทเท่านั้น')).toBeInTheDocument()
    })

    it('names the base currency in that hint when it is not baht', async () => {
      await db.accounts.add(ibkr)
      await db.settings.put({ key: 'app', baseCurrency: 'USD' })
      const { user } = await openTransfer()
      await user.selectOptions(screen.getByLabelText('สกุลเงินของค่าธรรมเนียม'), 'THB')
      expect(await screen.findByText('ใช้คิดค่าธรรมเนียมการโอนเป็น USD เท่านั้น')).toBeInTheDocument()
    })

    it('moves the receiving account off the account it is sent from', async () => {
      await db.accounts.add(ibkr)
      const { user } = await openTransfer()
      expect(screen.getByLabelText('บัญชีปลายทาง')).toHaveDisplayValue('IBKR')
      await user.selectOptions(screen.getByLabelText('บัญชี'), 'IBKR')
      expect(screen.getByLabelText('บัญชีปลายทาง')).toHaveDisplayValue('Dime US')
      expect(within(screen.getByLabelText('บัญชีปลายทาง')).queryByRole('option', { name: 'IBKR' })).not.toBeInTheDocument()
    })

    it('opens a saved cash transfer with its receiving account and kind', async () => {
      await db.accounts.add(ibkr)
      await db.transactions.add(
        makeTx({
          id: 'move-1',
          type: 'transfer',
          toAccountId: 'acc-2',
          instrumentId: undefined,
          quantity: undefined,
          price: undefined,
          amount: '20000',
          currency: 'THB',
          fees: '25',
          fxRate: '1',
          fxSource: 'same',
          date: '2024-01-15',
        }),
      )
      renderRoute('/transactions/move-1', provider())
      expect(await screen.findByLabelText('บัญชีปลายทาง')).toHaveDisplayValue('IBKR')
      expect(screen.getByRole('button', { name: 'เงินสด' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByLabelText('จำนวนเงินที่โอน')).toHaveValue('20000')
      expect(screen.getByLabelText('ค่าธรรมเนียมการโอน')).toHaveValue('25')
    })
  })

  describe('coin swaps', () => {
    const provider = () => fakeFxProvider({ 'USD|THB': '35' }).provider
    const btc = { id: 'CRYPTO:BTC', market: 'CRYPTO', symbol: 'BTC', name: 'Bitcoin', assetType: 'crypto', currency: 'USD' } as const
    const eth = { id: 'CRYPTO:ETH', market: 'CRYPTO', symbol: 'ETH', name: 'Ethereum', assetType: 'crypto', currency: 'USD' } as const
    const heldBtc = () =>
      makeTx({ id: 'btc-buy', instrumentId: 'CRYPTO:BTC', quantity: '0.01', price: '58000', fxRate: '34', date: '2024-01-15' })

    async function openSwap() {
      await db.instruments.add(btc)
      await db.transactions.add(heldBtc())
      const user = userEvent.setup()
      const router = renderRoute('/transactions/new', provider())
      await user.selectOptions(await screen.findByLabelText('ประเภทอื่นๆ'), 'แลกเหรียญ')
      return { user, router }
    }

    async function fillSwap(user: ReturnType<typeof userEvent.setup>, to = 'eth') {
      const [fromMarket, toMarket] = screen.getAllByLabelText('ตลาด')
      await user.selectOptions(fromMarket, 'คริปโต')
      await user.type(screen.getByLabelText('สินทรัพย์ที่แลกออก'), 'btc')
      await user.type(screen.getByLabelText('จำนวนที่แลกออก'), '0.01')
      await user.selectOptions(toMarket, 'คริปโต')
      await user.type(screen.getByLabelText('สินทรัพย์ที่ได้รับ'), to)
      await user.type(screen.getByLabelText('จำนวนที่ได้รับ'), '0.25')
      await user.type(screen.getByLabelText('มูลค่ารวม ณ ตอนแลก'), '660')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
    }

    it('records a swap and shows the cost of the coin received and the gain on the one given up', async () => {
      const { user, router } = await openSwap()
      await fillSwap(user)
      expect(screen.getByText(/^ต้นทุน ETH 2,640\.00 USD ต่อหน่วย · กำไรที่ขายแล้วของ BTC/)).toHaveTextContent(
        'ต้นทุน ETH 2,640.00 USD ต่อหน่วย · กำไรที่ขายแล้วของ BTC +80.00 USD',
      )
      expect(screen.getByText('BTC ที่ถือ').nextSibling).toHaveTextContent('0.01 → 0')
      expect(screen.getByText('ETH ที่ถือ').nextSibling).toHaveTextContent('0 → 0.25')
      expect(screen.getByText('660.00 USD')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      const saved = (await db.transactions.toArray()).find((t) => t.type === 'swap')
      expect(saved).toMatchObject({
        type: 'swap',
        instrumentId: 'CRYPTO:BTC',
        toInstrumentId: 'CRYPTO:ETH',
        quantity: '0.01',
        toQuantity: '0.25',
        amount: '660',
        currency: 'USD',
        fxRate: '35',
      })
      expect(saved?.price).toBeUndefined()
      expect(await db.instruments.get('CRYPTO:ETH')).toMatchObject({ symbol: 'ETH', currency: 'USD', assetType: 'crypto', name: 'ETH' })
    })

    it('puts the fee into the cost of the coin received and keeps the new coin’s name and type', async () => {
      const { user } = await openSwap()
      await fillSwap(user)
      await user.type(screen.getByLabelText('ค่าธรรมเนียม'), '1.5')
      expect(await screen.findByText(/^ต้นทุน ETH 2,646\.00 USD ต่อหน่วย/)).toBeInTheDocument()
      await user.type(document.getElementById('tx-to-name') as HTMLElement, 'Ethereum')
      await user.selectOptions(document.getElementById('tx-to-asset-type') as HTMLElement, 'คริปโต')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(async () => expect(await db.instruments.get('CRYPTO:ETH')).toMatchObject({ name: 'Ethereum', assetType: 'crypto' }))
      expect((await db.transactions.toArray()).find((t) => t.type === 'swap')).toMatchObject({ fees: '1.5' })
    })

    it('asks only for the parts of a swap that make sense and not for a price', async () => {
      await openSwap()
      expect(screen.getByLabelText('สินทรัพย์ที่แลกออก')).toBeInTheDocument()
      expect(screen.getByLabelText('สินทรัพย์ที่ได้รับ')).toBeInTheDocument()
      expect(screen.getByLabelText('จำนวนที่แลกออก')).toHaveAttribute('id', 'tx-quantity')
      expect(screen.getByLabelText('จำนวนที่ได้รับ')).toHaveAttribute('id', 'tx-to-quantity')
      expect(screen.getByLabelText('มูลค่ารวม ณ ตอนแลก')).toHaveAttribute('id', 'tx-amount')
      expect(screen.getByLabelText('สกุลเงินที่ใช้วัดมูลค่า')).toHaveValue('USD')
      expect(screen.queryByLabelText('ราคาต่อหน่วย')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('จำนวนหน่วย')).not.toBeInTheDocument()
    })

    it('groups the two coins so each field says which side it belongs to', async () => {
      await openSwap()
      const given = screen.getByRole('group', { name: 'แลกออก' })
      const received = screen.getByRole('group', { name: 'ได้รับ' })
      expect(within(given).getByLabelText('ตลาด')).toHaveAttribute('id', 'tx-market')
      expect(within(given).getByLabelText('สินทรัพย์ที่แลกออก')).toBeInTheDocument()
      expect(within(given).getByLabelText('จำนวนที่แลกออก')).toBeInTheDocument()
      expect(within(received).getByLabelText('ตลาด')).toHaveAttribute('id', 'tx-to-market')
      expect(within(received).getByLabelText('สินทรัพย์ที่ได้รับ')).toBeInTheDocument()
      expect(within(received).getByLabelText('จำนวนที่ได้รับ')).toBeInTheDocument()
      expect(within(given).queryByLabelText('จำนวนที่ได้รับ')).not.toBeInTheDocument()
    })

    it('starts on crypto in both markets and in the crypto currency', async () => {
      const user = userEvent.setup()
      renderRoute('/transactions/new', provider())
      await user.selectOptions(await screen.findByLabelText('ตลาด'), 'SET')
      expect(screen.getByLabelText('สกุลเงิน')).toHaveValue('THB')
      await user.selectOptions(screen.getByLabelText('ประเภทอื่นๆ'), 'แลกเหรียญ')
      expect(screen.getAllByLabelText('ตลาด').map((m) => (m as HTMLSelectElement).value)).toEqual(['CRYPTO', 'CRYPTO'])
      expect(screen.getByLabelText('สกุลเงินที่ใช้วัดมูลค่า')).toHaveValue('USD')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
    })

    it('says what is held of each coin', async () => {
      await db.instruments.add(eth)
      await db.transactions.add(makeTx({ id: 'eth-buy', instrumentId: 'CRYPTO:ETH', quantity: '2', price: '2000', date: '2024-01-10' }))
      const { user } = await openSwap()
      const [fromMarket, toMarket] = screen.getAllByLabelText('ตลาด')
      await user.selectOptions(fromMarket, 'คริปโต')
      await user.selectOptions(toMarket, 'คริปโต')
      await user.type(screen.getByLabelText('สินทรัพย์ที่แลกออก'), 'btc')
      await user.type(screen.getByLabelText('สินทรัพย์ที่ได้รับ'), 'eth')
      expect(await screen.findByText('Bitcoin · ถืออยู่ 0.01 หน่วย')).toBeInTheDocument()
      expect(screen.getByText('Ethereum · ถืออยู่ 2 หน่วย')).toBeInTheDocument()
      expect(document.getElementById('tx-to-name')).toBeNull()
    })

    it('refuses to swap more than is held and swapping a coin for itself', async () => {
      const { user } = await openSwap()
      await fillSwap(user)
      await user.clear(screen.getByLabelText('จำนวนที่แลกออก'))
      await user.type(screen.getByLabelText('จำนวนที่แลกออก'), '0.02')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      expect(await screen.findByText('แลก 0.02 หน่วย แต่ถืออยู่ 0.01 หน่วย')).toBeInTheDocument()
      expect(await db.transactions.count()).toBe(1)
      await user.clear(screen.getByLabelText('สินทรัพย์ที่ได้รับ'))
      await user.type(screen.getByLabelText('สินทรัพย์ที่ได้รับ'), 'btc')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      expect(await screen.findByText('สินทรัพย์ที่ได้รับต้องต่างจากที่แลกออก')).toBeInTheDocument()
      expect(await db.transactions.count()).toBe(1)
    })

    it('starts over with both coins empty after save and add another', async () => {
      const { user } = await openSwap()
      await fillSwap(user)
      await user.click(screen.getByRole('button', { name: 'บันทึกแล้วเพิ่มอีก' }))
      expect(await screen.findByRole('status')).toHaveTextContent('บันทึกแล้ว · แลกเหรียญ BTC → ETH')
      for (const label of ['สินทรัพย์ที่แลกออก', 'จำนวนที่แลกออก', 'สินทรัพย์ที่ได้รับ', 'จำนวนที่ได้รับ', 'มูลค่ารวม ณ ตอนแลก']) {
        expect(screen.getByLabelText(label)).toHaveValue('')
      }
      expect(screen.getAllByLabelText('ตลาด')[1]).toHaveDisplayValue('คริปโต')
    })

    it('opens a saved swap with both coins, the value and the fee', async () => {
      await db.instruments.bulkAdd([btc, eth])
      await db.transactions.add(heldBtc())
      await db.transactions.add(
        makeTx({
          id: 'swap-1',
          type: 'swap',
          instrumentId: 'CRYPTO:BTC',
          quantity: '0.01',
          price: undefined,
          toInstrumentId: 'CRYPTO:ETH',
          toQuantity: '0.25',
          amount: '660',
          fees: '1.5',
          fxRate: '35',
          date: '2024-04-01',
        }),
      )
      renderRoute('/transactions/swap-1', provider())
      expect(await screen.findByLabelText('สินทรัพย์ที่ได้รับ')).toHaveValue('ETH')
      expect(screen.getByLabelText('สินทรัพย์ที่แลกออก')).toHaveValue('BTC')
      expect(screen.getAllByLabelText('ตลาด').map((m) => (m as HTMLSelectElement).value)).toEqual(['CRYPTO', 'CRYPTO'])
      expect(screen.getByLabelText('จำนวนที่แลกออก')).toHaveValue('0.01')
      expect(screen.getByLabelText('จำนวนที่ได้รับ')).toHaveValue('0.25')
      expect(screen.getByLabelText('มูลค่ารวม ณ ตอนแลก')).toHaveValue('660')
      expect(screen.getByLabelText('ค่าธรรมเนียม')).toHaveValue('1.5')
      expect(await screen.findByText(/^ต้นทุน ETH 2,646\.00 USD ต่อหน่วย/)).toBeInTheDocument()
    })

    it('shows the summary line on a phone too', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
      const { user } = await openSwap()
      await fillSwap(user)
      expect(screen.getByText(/^ต้นทุน ETH 2,640\.00 USD ต่อหน่วย/)).toBeInTheDocument()
    })
  })
})

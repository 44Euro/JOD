import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { makeTx } from '../../test/fixtures'
import { renderRoute, resetDb } from '../../test/render'

const account = { id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' }

const deposit = makeTx({
  id: 'd',
  type: 'deposit',
  instrumentId: undefined,
  quantity: undefined,
  price: undefined,
  amount: '1000',
  currency: 'THB',
  fxRate: '1',
  fxSource: 'same',
  date: '2024-01-09',
})

beforeEach(async () => {
  await resetDb()
  await db.accounts.add(account)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('TransactionsPage', () => {
  it('flags a sell that became larger than the holding after an earlier buy was edited', async () => {
    await db.transactions.bulkAdd([
      makeTx({ id: 'buy-1', quantity: '2', date: '2024-01-10' }),
      makeTx({ id: 'sell-1', type: 'sell', quantity: '5', date: '2024-01-20' }),
    ])
    renderRoute('/transactions')
    expect(await screen.findByText('ขาย 5 หน่วย แต่ถืออยู่ 2 หน่วย')).toBeInTheDocument()
    expect(screen.getByText('ไม่นับในพอร์ต')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('มี 1 รายการที่คำนวณไม่ได้')
  })

  it('deletes a transaction after confirmation', async () => {
    await db.transactions.add(makeTx({ id: 'buy-1', date: '2024-01-10' }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderRoute('/transactions')
    await user.click(await screen.findByRole('button', { name: 'ลบรายการ ซื้อ 2024-01-10' }))
    await waitFor(async () => expect(await db.transactions.count()).toBe(0))
  })

  it('filters by type and by market', async () => {
    await db.transactions.bulkAdd([makeTx({ id: 'b', date: '2024-01-10' }), deposit])
    const user = userEvent.setup()
    renderRoute('/transactions')
    const table = await screen.findByRole('table')
    expect(await within(table).findByText('ฝากเงิน')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('กรองตามประเภท'), 'buy')
    expect(within(table).queryByText('ฝากเงิน')).not.toBeInTheDocument()
    expect(within(table).getByText('ซื้อ')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('กรองตามประเภท'), '')
    await user.selectOptions(screen.getByLabelText('กรองตามตลาด'), 'SET')
    expect(await screen.findByText('ไม่พบรายการที่ตรงกับตัวกรอง')).toBeInTheDocument()
  })

  it('groups rows under a Thai day heading', async () => {
    await db.transactions.add(makeTx({ id: 'b', date: '2024-01-15' }))
    renderRoute('/transactions')
    expect(await screen.findByText('จันทร์ 15 ม.ค. 2024')).toBeInTheDocument()
  })

  it('shows an exchange as source to target with the spread against the market rate', async () => {
    await db.transactions.add(
      makeTx({
        id: 'fx',
        type: 'fx_convert',
        instrumentId: undefined,
        quantity: undefined,
        price: undefined,
        currency: 'THB',
        amount: '34000',
        toCurrency: 'USD',
        toAmount: '1000',
        marketRate: '33.5',
        fxRate: '1',
        fxSource: 'same',
        date: '2024-01-10',
      }),
    )
    renderRoute('/transactions')
    const table = await screen.findByRole('table')
    expect(await within(table).findByText('34,000 THB → 1,000 USD')).toBeInTheDocument()
    expect(within(table).getByText('แพงกว่าตลาด 1.49%')).toBeInTheDocument()
  })

  it('shows the cost of an opening holding and no net amount for a split', async () => {
    await db.transactions.bulkAdd([
      makeTx({
        id: 'o',
        type: 'opening',
        instrumentId: 'US:VOO',
        quantity: '10',
        price: '400',
        fxRate: '34.5',
        fxSource: 'estimated',
        date: '2024-01-05',
      }),
      makeTx({ id: 'b', date: '2024-01-10' }),
      makeTx({
        id: 's',
        type: 'split',
        quantity: undefined,
        price: undefined,
        splitRatio: '4',
        fxRate: '1',
        fxSource: 'same',
        date: '2024-01-20',
      }),
    ])
    renderRoute('/transactions')
    const table = await screen.findByRole('table')
    expect(await within(table).findByText('ทุน 138,000')).toBeInTheDocument()
    const split = within(table).getByText('แตกพาร์/รวมหุ้น').closest('tr')!
    expect(split.cells[5]).toHaveTextContent(/^—$/)
  })

  it('shows the tax withheld from a dividend next to its amount', async () => {
    await db.transactions.bulkAdd([
      makeTx({ id: 'div', type: 'dividend', quantity: undefined, price: undefined, amount: '1200', tax: '120', date: '2024-03-01' }),
      makeTx({ id: 'div-free', type: 'dividend', quantity: undefined, price: undefined, amount: '300', tax: '0', date: '2024-02-01' }),
    ])
    renderRoute('/transactions')
    const table = await screen.findByRole('table')
    expect(await within(table).findByText(/^1,200 หัก ณ ที่จ่าย 120/)).toBeInTheDocument()
    expect(within(table).queryByText(/^300 หัก/)).not.toBeInTheDocument()
    expect(within(table).getByText(/^300/)).toBeInTheDocument()
  })

  it('shows two-line rows on a phone', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    await db.transactions.add(makeTx({ id: 'b', date: '2024-01-10', fxRate: '35' }))
    renderRoute('/transactions')
    const list = await screen.findByRole('list', { name: 'รายการทั้งหมด' })
    expect(within(list).getByText('1 × 100.00 USD')).toBeInTheDocument()
    expect(within(list).getByText('กรอกเอง')).toBeInTheDocument()
    expect(within(list).getByRole('link', { name: /AAPL/ })).toHaveAttribute('href', '/transactions/b')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  describe('transfers', () => {
    const ibkr = { id: 'acc-2', name: 'IBKR', broker: 'IBKR', note: '', createdAt: '2024-01-01T00:00:00.000Z' }
    const sendShares = makeTx({
      id: 'send-shares',
      type: 'transfer',
      toAccountId: 'acc-2',
      quantity: '4',
      price: undefined,
      date: '2024-01-20',
    })
    const sendCash = makeTx({
      id: 'send-cash',
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
      date: '2024-01-21',
    })

    beforeEach(async () => {
      await db.accounts.add(ibkr)
      await db.transactions.bulkAdd([makeTx({ id: 'buy-1', quantity: '10', date: '2024-01-10' }), deposit, sendShares, sendCash])
    })

    it('shows where a transfer goes and charges only its fee', async () => {
      renderRoute('/transactions')
      const table = await screen.findByRole('table')
      const shares = (await within(table).findByText('4 หน่วย → IBKR')).closest('tr')!
      expect(shares.cells[3]).toHaveTextContent(/^4 หน่วย → IBKR$/)
      expect(shares.cells[5]).toHaveTextContent(/^—$/)
      expect(shares.cells[5]).toHaveClass('text-muted-foreground')
      const cash = within(table).getByText('20,000 THB → IBKR').closest('tr')!
      expect(cash.cells[3]).toHaveTextContent(/^20,000 THB → IBKR$/)
      expect(cash.cells[5]).toHaveTextContent(/^−25\.00$/)
      expect(cash.cells[5]).toHaveClass('text-loss')
    })

    it('shows a transfer received by the account that is filtered on', async () => {
      const user = userEvent.setup()
      renderRoute('/transactions')
      const table = await screen.findByRole('table')
      await user.selectOptions(screen.getByLabelText('กรองตามบัญชี'), 'IBKR')
      expect(within(table).getByText('4 หน่วย → IBKR')).toBeInTheDocument()
      expect(within(table).getByText('20,000 THB → IBKR')).toBeInTheDocument()
      expect(within(table).queryByText('ฝากเงิน')).not.toBeInTheDocument()
      expect(within(table).queryByText('ซื้อ')).not.toBeInTheDocument()
      await user.selectOptions(screen.getByLabelText('กรองตามบัญชี'), 'Dime US')
      expect(within(table).getByText('4 หน่วย → IBKR')).toBeInTheDocument()
      expect(within(table).getByText('ฝากเงิน')).toBeInTheDocument()
    })

    it('reads the same on a phone', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
      renderRoute('/transactions')
      const list = await screen.findByRole('list', { name: 'รายการทั้งหมด' })
      expect(within(list).getByText('4 หน่วย → IBKR')).toBeInTheDocument()
      expect(within(list).getByText('20,000 THB → IBKR')).toBeInTheDocument()
      expect(within(list).getByText('−25.00')).toHaveClass('text-loss')
    })
  })
})

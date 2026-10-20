import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { saveSettings } from '../../db/repo'
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

  it('masks the quantities in the reason a sell was skipped while the numbers are hidden', async () => {
    await saveSettings(db, { baseCurrency: 'THB', hideNumbersOnLaunch: true })
    await db.transactions.bulkAdd([
      makeTx({ id: 'buy-1', quantity: '2', date: '2024-01-10' }),
      makeTx({ id: 'sell-1', type: 'sell', quantity: '5', date: '2024-01-20' }),
    ])
    renderRoute('/transactions')
    expect(await screen.findByText('ขาย ••• หน่วย แต่ถืออยู่ ••• หน่วย')).toBeInTheDocument()
    expect(screen.queryByText(/ขาย 5 หน่วย/)).not.toBeInTheDocument()
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

  it('warns on an exchange only when its spread is above 1% and never on one cheaper than the market', async () => {
    const exchange = (id: string, amount: string, date: string) =>
      makeTx({
        id,
        type: 'fx_convert',
        instrumentId: undefined,
        quantity: undefined,
        price: undefined,
        currency: 'THB',
        amount,
        toCurrency: 'USD',
        toAmount: '1000',
        marketRate: '33.5',
        fxRate: '1',
        fxSource: 'same',
        date,
      })
    await db.transactions.bulkAdd([
      exchange('over', '33840', '2024-01-12'),
      exchange('exactly', '33835', '2024-01-11'),
      exchange('under', '33000', '2024-01-10'),
    ])
    renderRoute('/transactions')
    const table = await screen.findByRole('table')
    expect(within(table).getByText('แพงกว่าตลาด 1.01%')).toHaveClass('bg-warning-bg')
    expect(within(table).getByText('แพงกว่าตลาด 1%')).not.toHaveClass('bg-warning-bg')
    expect(within(table).getByText('ถูกกว่าตลาด 1.49%')).not.toHaveClass('bg-warning-bg')
  })

  it('calls an exchange at the market rate when its spread rounds to nothing, instead of a cheaper or dearer one by 0%', async () => {
    const exchange = (id: string, amount: string, date: string) =>
      makeTx({
        id,
        type: 'fx_convert',
        instrumentId: undefined,
        quantity: undefined,
        price: undefined,
        currency: 'THB',
        amount,
        toCurrency: 'USD',
        toAmount: '1000',
        marketRate: '33.5',
        fxRate: '1',
        fxSource: 'same',
        date,
      })
    await db.transactions.bulkAdd([exchange('tiny', '33500.1', '2024-01-11'), exchange('exact', '33500', '2024-01-10')])
    renderRoute('/transactions')
    const table = await screen.findByRole('table')
    expect(await within(table).findAllByText('เท่าตลาด')).toHaveLength(2)
    expect(within(table).queryByText(/ตลาด 0%/)).not.toBeInTheDocument()
  })

  it('keeps the rate of an exchange and its badge on one line, however wide the amount column gets', async () => {
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
    const badge = within(await screen.findByRole('table')).getByText('แพงกว่าตลาด 1.49%')
    const rate = badge.parentElement!
    expect(rate).toHaveClass('inline-flex', 'whitespace-nowrap')
    expect(rate).not.toHaveClass('flex-wrap')
    expect(rate.closest('td')).toHaveClass('whitespace-nowrap')
  })

  it('keeps the rate of a trade and its badge on one line', async () => {
    await db.transactions.add(makeTx({ id: 'b', date: '2024-01-10', fxRate: '35' }))
    renderRoute('/transactions')
    const rate = within(await screen.findByRole('table')).getByText('กรอกเอง').parentElement!
    expect(rate).toHaveClass('inline-flex', 'whitespace-nowrap')
  })

  it('keeps the word rate together with its number on a phone, and the badge beside them', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
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
    const list = await screen.findByRole('list', { name: 'รายการทั้งหมด' })
    const pair = within(list).getByText('· เรท').parentElement!
    expect(pair).toHaveClass('inline-flex', 'whitespace-nowrap')
    expect(within(pair).getByText('แพงกว่าตลาด 1.49%').parentElement).toHaveClass('whitespace-nowrap')
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

  it('puts the tax withheld from a dividend or interest on a line of its own under the amount', async () => {
    await db.transactions.bulkAdd([
      makeTx({ id: 'div', type: 'dividend', quantity: undefined, price: undefined, amount: '1200', tax: '120', date: '2024-03-01' }),
      makeTx({ id: 'int', type: 'interest', instrumentId: undefined, quantity: undefined, price: undefined, amount: '500', tax: '50', date: '2024-02-15' }),
      makeTx({ id: 'div-free', type: 'dividend', quantity: undefined, price: undefined, amount: '300', tax: '0', date: '2024-02-01' }),
    ])
    renderRoute('/transactions')
    const table = await screen.findByRole('table')
    const note = await within(table).findByText('หัก ณ ที่จ่าย 120')
    expect(note).toHaveClass('block', 'text-[12.5px]', 'text-muted-foreground')
    expect(note.closest('td')).toHaveTextContent(/^1,200 USDหัก ณ ที่จ่าย 120$/)
    const interest = within(table).getByText('หัก ณ ที่จ่าย 50')
    expect(interest).toHaveClass('block', 'text-[12.5px]', 'text-muted-foreground')
    expect(interest.closest('td')).toHaveTextContent(/^500 USDหัก ณ ที่จ่าย 50$/)
    expect(within(table).getAllByText(/หัก ณ ที่จ่าย/)).toHaveLength(2)
    expect(within(table).getByText('300').closest('td')).toHaveTextContent(/^300 USD$/)
  })

  it('keeps the tax withheld inline in the phone row', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    await db.transactions.add(
      makeTx({ id: 'div', type: 'dividend', quantity: undefined, price: undefined, amount: '1200', tax: '120', date: '2024-03-01' }),
    )
    renderRoute('/transactions')
    const list = await screen.findByRole('list', { name: 'รายการทั้งหมด' })
    expect(within(list).getByText('1,200 หัก ณ ที่จ่าย 120 USD')).toBeInTheDocument()
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

  describe('the account in the rows', () => {
    const phone = () =>
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))

    it('starts the second line of a phone row with the account, so a long name cannot be cut next to the symbol', async () => {
      phone()
      await db.transactions.add(makeTx({ id: 'b', date: '2024-01-10', fxRate: '35' }))
      renderRoute('/transactions')
      const list = await screen.findByRole('list', { name: 'รายการทั้งหมด' })
      const link = within(list).getByRole('link', { name: /AAPL/ })
      const account = within(link).getByText('Dime US ·')
      const second = within(link).getByText('1 × 100.00 USD').parentElement!
      expect(account.parentElement).toBe(second)
      expect(second.firstElementChild).toBe(account)
      expect(second).toHaveClass('col-span-2', 'flex-wrap', 'text-muted-foreground')
      const first = within(link).getByText('AAPL').parentElement!
      expect(first).not.toContainElement(account)
      expect(first).not.toHaveTextContent('Dime US')
      expect(Array.from(second.children).map((part) => part.textContent)).toEqual(['Dime US ·', '1 × 100.00 USD', '· เรท35.00กรอกเอง'])
    })

    it('cuts a long symbol on a phone with an ellipsis and never squeezes the pill, the type or the net amount', async () => {
      phone()
      await db.transactions.add(
        makeTx({ id: 'bond', instrumentId: 'BOND:CPALL26NA', currency: 'THB', fxRate: '1', fxSource: 'same', quantity: '10', price: '1000', date: '2024-01-10' }),
      )
      renderRoute('/transactions')
      const list = await screen.findByRole('list', { name: 'รายการทั้งหมด' })
      const link = within(list).getByRole('link', { name: /CPALL26NA/ })
      const symbol = within(link).getByText('CPALL26NA')
      expect(symbol).toHaveClass('min-w-0', 'truncate')
      expect(symbol).toHaveAttribute('title', 'CPALL26NA')
      expect(within(link).getByText('BOND')).toHaveClass('shrink-0')
      expect(within(link).getByText('ซื้อ')).toHaveClass('shrink-0')
      expect(within(link).getByText('−10,000.00')).toHaveClass('shrink-0')
    })

    it('leaves the symbol in the table as it was', async () => {
      await db.transactions.add(
        makeTx({ id: 'bond', instrumentId: 'BOND:CPALL26NA', currency: 'THB', fxRate: '1', fxSource: 'same', quantity: '10', price: '1000', date: '2024-01-10' }),
      )
      renderRoute('/transactions')
      const symbol = await within(await screen.findByRole('table')).findByText('CPALL26NA')
      expect(symbol).not.toHaveClass('truncate')
      expect(symbol).not.toHaveAttribute('title')
    })

    it('keeps the account as the title of a cash row on a phone, and does not repeat it on the second line', async () => {
      phone()
      await db.transactions.add(deposit)
      renderRoute('/transactions')
      const list = await screen.findByRole('list', { name: 'รายการทั้งหมด' })
      const title = within(list).getByText('Dime US')
      expect(title).toHaveClass('truncate')
      expect(within(list).queryByText('Dime US ·')).not.toBeInTheDocument()
    })

    it('keeps the account beside the symbol in the table', async () => {
      await db.transactions.add(makeTx({ id: 'b', date: '2024-01-10', fxRate: '35' }))
      renderRoute('/transactions')
      const row = (await within(await screen.findByRole('table')).findByText('AAPL')).closest('tr')!
      expect(within(row).getByText('Dime US')).toHaveClass('truncate')
      expect(within(row).queryByText('Dime US ·')).not.toBeInTheDocument()
    })
  })

  describe('units of the assets', () => {
    const ibkr = { id: 'acc-2', name: 'IBKR', broker: 'IBKR', note: '', createdAt: '2024-01-01T00:00:00.000Z' }
    const phone = () =>
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))

    beforeEach(async () => {
      await db.accounts.add(ibkr)
      await db.instruments.bulkAdd([
        { id: 'GOLD:96.5', market: 'GOLD', symbol: '96.5', name: 'ทอง 96.5%', assetType: 'gold', currency: 'THB', unit: 'baht_gold' },
        { id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'ปตท.', assetType: 'stock', currency: 'THB' },
      ])
      const thb = { currency: 'THB', fxRate: '1', fxSource: 'same' as const }
      await db.transactions.bulkAdd([
        makeTx({ ...thb, id: 'gold-buy', instrumentId: 'GOLD:96.5', quantity: '2', price: '41000', date: '2024-01-10' }),
        makeTx({ ...thb, id: 'ptt-buy', instrumentId: 'SET:PTT', quantity: '100', price: '33', date: '2024-01-11' }),
        makeTx({ ...thb, id: 'gold-move', instrumentId: 'GOLD:96.5', type: 'transfer', toAccountId: 'acc-2', quantity: '0.5', price: undefined, date: '2024-01-20' }),
        makeTx({ ...thb, id: 'ptt-move', instrumentId: 'SET:PTT', type: 'transfer', toAccountId: 'acc-2', quantity: '40', price: undefined, date: '2024-01-21' }),
      ])
    })

    it('counts the units of a transfer in the unit of the asset in the table', async () => {
      renderRoute('/transactions')
      const table = await screen.findByRole('table')
      expect(await within(table).findByText('0.5 บาททองคำ → IBKR')).toBeInTheDocument()
      expect(within(table).getByText('40 หุ้น → IBKR')).toBeInTheDocument()
    })

    it('does the same in the phone row', async () => {
      phone()
      renderRoute('/transactions')
      const list = await screen.findByRole('list', { name: 'รายการทั้งหมด' })
      expect(await within(list).findByText('0.5 บาททองคำ → IBKR')).toBeInTheDocument()
      expect(within(list).getByText('40 หุ้น → IBKR')).toBeInTheDocument()
    })
  })

  describe('type names', () => {
    beforeEach(async () => {
      await db.transactions.bulkAdd([
        makeTx({ id: 'int', type: 'interest', instrumentId: undefined, quantity: undefined, price: undefined, amount: '5', date: '2024-01-12' }),
        makeTx({ id: 'spl', type: 'split', quantity: undefined, price: undefined, splitRatio: '4', date: '2024-01-11' }),
        makeTx({ id: 'div', type: 'dividend', quantity: undefined, price: undefined, amount: '5', date: '2024-01-10' }),
        makeTx({ id: 'buy', date: '2024-01-09' }),
      ])
    })

    it('keeps the full names in the table', async () => {
      renderRoute('/transactions')
      const table = await screen.findByRole('table')
      for (const full of ['ดอกเบี้ย/คูปอง', 'แตกพาร์/รวมหุ้น', 'ปันผล', 'ซื้อ']) expect(within(table).getByText(full)).toBeInTheDocument()
    })

    it('uses short names in the phone row, and the full name where none is short', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
      renderRoute('/transactions')
      const list = await screen.findByRole('list', { name: 'รายการทั้งหมด' })
      for (const short of ['ดอกเบี้ย', 'แตกพาร์', 'ปันผล', 'ซื้อ']) expect(within(list).getByText(short)).toBeInTheDocument()
      expect(within(list).queryByText('ดอกเบี้ย/คูปอง')).not.toBeInTheDocument()
      expect(within(list).queryByText('แตกพาร์/รวมหุ้น')).not.toBeInTheDocument()
    })

    it('lets the asset block shrink and clip inside the phone row, so the type label never lands on the symbol', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
      renderRoute('/transactions')
      const list = await screen.findByRole('list', { name: 'รายการทั้งหมด' })
      const buy = within(list).getByText('ซื้อ').closest('a')!
      const block = within(buy).getByText('AAPL').parentElement!
      expect(block).toHaveClass('min-w-0', 'overflow-hidden')
      const row = block.parentElement!
      expect(row).toHaveClass('min-w-0')
      expect(within(buy).getByText('ซื้อ')).toHaveClass('shrink-0')
    })

    it('keeps the full name of the opening balance in the table', async () => {
      await db.transactions.add(makeTx({ id: 'open', type: 'opening', date: '2024-01-08', quantity: '1', price: '100' }))
      renderRoute('/transactions')
      expect(within(await screen.findByRole('table')).getByText('ยอดยกมา')).toBeInTheDocument()
    })

    it('shortens the opening balance to ยกมา in the phone row', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
      await db.transactions.add(makeTx({ id: 'open', type: 'opening', date: '2024-01-08', quantity: '1', price: '100' }))
      renderRoute('/transactions')
      const list = await screen.findByRole('list', { name: 'รายการทั้งหมด' })
      expect(within(list).getByText('ยกมา')).toBeInTheDocument()
      expect(within(list).queryByText('ยอดยกมา')).not.toBeInTheDocument()
    })
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

    it('shows a rate only for a transfer that charges a fee', async () => {
      await db.transactions.add({ ...sendShares, id: 'send-fee', fees: '2', date: '2024-01-22' })
      renderRoute('/transactions')
      const table = await screen.findByRole('table')
      const rows = await within(table).findAllByText('4 หน่วย → IBKR')
      const [withFee, free] = rows.map((cell) => cell.closest('tr')!)
      expect(withFee.cells[4]).toHaveTextContent('35.00กรอกเอง')
      expect(free.cells[4]).toHaveTextContent(/^—$/)
      expect(within(table).getByText('20,000 THB → IBKR').closest('tr')!.cells[4]).toHaveTextContent(/^—$/)
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
      const shares = within(list).getByText('4 หน่วย → IBKR').closest('li')!
      expect(within(shares).queryByText('· เรท')).not.toBeInTheDocument()
      const buy = within(list).getByText('10 × 100.00 USD').closest('li')!
      expect(within(buy).getByText('· เรท')).toBeInTheDocument()
      expect(within(shares).getByText('โอน')).toBeInTheDocument()
      expect(within(list).queryByText('โอนระหว่างบัญชี')).not.toBeInTheDocument()
    })
  })

  describe('swaps', () => {
    const buyBtc = makeTx({ id: 'buy-btc', instrumentId: 'CRYPTO:BTC', quantity: '0.01', price: '58000', fxRate: '34', date: '2024-03-01' })
    const swap = (overrides = {}) =>
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
        ...overrides,
      })

    it('shows the units on both sides, the rate of the swap and the fee as the net amount', async () => {
      await db.transactions.bulkAdd([buyBtc, swap()])
      renderRoute('/transactions')
      const table = await screen.findByRole('table')
      const row = (await within(table).findByText('0.01 BTC → 0.25 ETH')).closest('tr')!
      expect(row.cells[1]).toHaveTextContent('แลกเหรียญ')
      expect(row.cells[3]).toHaveTextContent(/^0\.01 BTC → 0\.25 ETH$/)
      expect(row.cells[4]).toHaveTextContent('35.00กรอกเอง')
      expect(row.cells[5]).toHaveTextContent(/^−52\.50$/)
      expect(row.cells[5]).toHaveClass('text-loss')
    })

    it('shows a dash instead of a net amount when a swap has no fee', async () => {
      await db.transactions.bulkAdd([buyBtc, swap({ fees: '0' })])
      renderRoute('/transactions')
      const table = await screen.findByRole('table')
      const row = (await within(table).findByText('0.01 BTC → 0.25 ETH')).closest('tr')!
      expect(row.cells[5]).toHaveTextContent(/^—$/)
      expect(row.cells[5]).toHaveClass('text-muted-foreground')
      expect(row.cells[4]).toHaveTextContent('35.00กรอกเอง')
    })

    it('finds a swap by the coin received and by the market of either side', async () => {
      const aapl = makeTx({ id: 'buy-aapl', quantity: '1', date: '2024-03-02' })
      const toCoin = swap({ id: 'swap-2', instrumentId: 'US:AAPL', quantity: '1', date: '2024-04-02' })
      await db.transactions.bulkAdd([buyBtc, aapl, swap(), toCoin])
      const user = userEvent.setup()
      renderRoute('/transactions')
      const table = await screen.findByRole('table')
      await user.type(screen.getByLabelText('ค้นหา'), 'eth')
      expect(within(table).getAllByText(/→ 0\.25 ETH$/)).toHaveLength(2)
      expect(within(table).queryByText('1 × 100.00')).not.toBeInTheDocument()
      await user.clear(screen.getByLabelText('ค้นหา'))
      await user.selectOptions(screen.getByLabelText('กรองตามตลาด'), 'CRYPTO')
      expect(within(table).getAllByText(/→ 0\.25 ETH$/)).toHaveLength(2)
      expect(within(table).getByText('0.01 × 58,000.00')).toBeInTheDocument()
      await user.selectOptions(screen.getByLabelText('กรองตามตลาด'), 'US')
      expect(within(table).getAllByText(/→ 0\.25 ETH$/)).toHaveLength(1)
    })

    it('reads the same on a phone, with the rate of the swap', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
      await db.transactions.bulkAdd([buyBtc, swap()])
      renderRoute('/transactions')
      const list = await screen.findByRole('list', { name: 'รายการทั้งหมด' })
      const item = within(list).getByText('0.01 BTC → 0.25 ETH').closest('li')!
      expect(within(item).getByText('· เรท')).toBeInTheDocument()
      expect(within(item).getByText('−52.50')).toHaveClass('text-loss')
    })
  })

  describe('assets received', () => {
    const received = (overrides = {}) =>
      makeTx({
        id: 'recv-1',
        type: 'receive_asset',
        receiveKind: 'staking',
        instrumentId: 'CRYPTO:SOL',
        quantity: '0.5',
        price: '150',
        fxRate: '35',
        date: '2024-04-01',
        ...overrides,
      })

    it('shows the units, the value on the day and the kind, with the income in baht as the net amount', async () => {
      await db.transactions.add(received())
      renderRoute('/transactions')
      const table = await screen.findByRole('table')
      const row = (await within(table).findByText('SOL', { selector: 'b' })).closest('tr')!
      expect(row.cells[1]).toHaveTextContent('รับเป็นสินทรัพย์')
      expect(row.cells[3]).toHaveTextContent(/^0\.5 × 150\.00 · Staking USD$/)
      expect(row.cells[5]).toHaveTextContent(/^\+2,625\.00$/)
      expect(row.cells[5]).toHaveClass('text-gain')
    })

    it('names the tax withheld and takes it and the fee out of the income', async () => {
      await db.transactions.add(received({ receiveKind: 'stock_dividend', tax: '1', fees: '0.5' }))
      renderRoute('/transactions')
      const table = await screen.findByRole('table')
      const row = (await within(table).findByText('SOL', { selector: 'b' })).closest('tr')!
      expect(row.cells[3]).toHaveTextContent(/^0\.5 × 150\.00 · ปันผลเป็นหุ้น USDหัก ณ ที่จ่าย 1$/)
      expect(within(row.cells[3]).getByText('หัก ณ ที่จ่าย 1')).toHaveClass('block', 'text-[12.5px]', 'text-muted-foreground')
      expect(row.cells[5]).toHaveTextContent(/^\+2,572\.50$/)
    })

    it('keeps the tax withheld inline on a phone', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
      await db.transactions.add(received({ receiveKind: 'stock_dividend', tax: '1' }))
      renderRoute('/transactions')
      const list = await screen.findByRole('list', { name: 'รายการทั้งหมด' })
      expect(within(list).getByText('0.5 × 150.00 · ปันผลเป็นหุ้น หัก ณ ที่จ่าย 1 USD')).toBeInTheDocument()
    })

    it('reads the same on a phone', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
      await db.transactions.add(received())
      renderRoute('/transactions')
      const list = await screen.findByRole('list', { name: 'รายการทั้งหมด' })
      const item = within(list).getByText(/^0\.5 × 150\.00 · Staking USD$/).closest('li')!
      expect(within(item).getByText('+2,625.00')).toHaveClass('text-gain')
      expect(within(item).getByText('รับสินทรัพย์')).toBeInTheDocument()
      expect(within(item).queryByText('รับเป็นสินทรัพย์')).not.toBeInTheDocument()
      expect(within(item).getByText('Dime US ·')).toBeInTheDocument()
    })
  })

  describe('fees paid in something else', () => {
    const buyBnb = makeTx({ id: 'buy-bnb', instrumentId: 'CRYPTO:BNB', quantity: '1', price: '500', fxRate: '34', date: '2024-01-10' })
    const paidInBnb = makeTx({
      id: 'paid',
      instrumentId: 'CRYPTO:ETH',
      quantity: '0.5',
      price: '2600',
      fxRate: '34',
      date: '2024-01-11',
      feePaidIn: 'asset',
      feeInstrumentId: 'CRYPTO:BNB',
      feeQuantity: '0.001',
      fees: '0.6',
    })
    const taken = makeTx({
      id: 'taken',
      instrumentId: 'CRYPTO:ETH',
      quantity: '1',
      price: '2000',
      fxRate: '34',
      date: '2024-01-12',
      feePaidIn: 'received',
      feeQuantity: '0.002',
    })
    const phone = () =>
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))

    it('puts the fee note on its own line under the amount, after the currency', async () => {
      await db.transactions.bulkAdd([buyBnb, paidInBnb, taken])
      renderRoute('/transactions')
      const table = await screen.findByRole('table')
      const note = await within(table).findByText('ค่าธรรมเนียม 0.001 BNB')
      expect(note).toHaveClass('block', 'text-[12.5px]', 'text-muted-foreground')
      const paid = note.closest('td')!
      expect(paid).toHaveTextContent(/^0\.5 × 2,600\.00 USDค่าธรรมเนียม 0\.001 BNB$/)
      expect(within(paid).getByText('USD')).toHaveClass('text-muted-foreground')
      const takenNote = within(table).getByText('หัก 0.002 ETH')
      expect(takenNote).toHaveClass('block', 'text-[12.5px]', 'text-muted-foreground')
      expect(takenNote.closest('td')).toHaveTextContent(/^1 × 2,000\.00 USDหัก 0\.002 ETH$/)
    })

    it('leaves a row without a fee note as it was', async () => {
      await db.transactions.bulkAdd([makeTx({ id: 'plain', quantity: '3', price: '100' })])
      renderRoute('/transactions')
      const table = await screen.findByRole('table')
      expect(within(table).getByText('3 × 100.00').closest('td')).toHaveTextContent(/^3 × 100\.00 USD$/)
      expect(table.querySelector('td span.block')).toBeNull()
    })

    it('does the same in the phone row', async () => {
      phone()
      await db.transactions.bulkAdd([buyBnb, paidInBnb, taken])
      renderRoute('/transactions')
      const list = await screen.findByRole('list', { name: 'รายการทั้งหมด' })
      expect(within(list).getByText('0.5 × 2,600.00 USD · ค่าธรรมเนียม 0.001 BNB')).toBeInTheDocument()
      expect(within(list).getByText('1 × 2,000.00 USD · หัก 0.002 ETH')).toBeInTheDocument()
    })

    it('finds a trade by the asset its fee was paid in, and under the market of that asset', async () => {
      const usStock = makeTx({ id: 'us-paid', quantity: '2', price: '100', fxRate: '35', date: '2024-01-13', feePaidIn: 'asset', feeInstrumentId: 'CRYPTO:BNB', feeQuantity: '0.001', fees: '0.6' })
      const plain = makeTx({ id: 'plain', quantity: '3', price: '100', fxRate: '35', date: '2024-01-14' })
      await db.transactions.bulkAdd([buyBnb, paidInBnb, usStock, plain])
      const user = userEvent.setup()
      renderRoute('/transactions')
      const table = await screen.findByRole('table')
      await user.type(screen.getByLabelText('ค้นหา'), 'bnb')
      expect(within(table).getByText('2 × 100.00')).toBeInTheDocument()
      expect(within(table).getAllByText('ค่าธรรมเนียม 0.001 BNB')).toHaveLength(2)
      expect(within(table).getByText(/^0\.5 × 2,600\.00/)).toBeInTheDocument()
      expect(within(table).queryByText('3 × 100.00')).not.toBeInTheDocument()
      await user.clear(screen.getByLabelText('ค้นหา'))
      await user.selectOptions(screen.getByLabelText('กรองตามตลาด'), 'CRYPTO')
      expect(within(table).getByText('2 × 100.00')).toBeInTheDocument()
      expect(within(table).getAllByText('ค่าธรรมเนียม 0.001 BNB')).toHaveLength(2)
      expect(within(table).queryByText('3 × 100.00')).not.toBeInTheDocument()
    })
  })
})

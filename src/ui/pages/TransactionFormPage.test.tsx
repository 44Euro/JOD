import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { saveSettings } from '../../db/repo'
import { FxUnavailableError, type FxProvider } from '../../fx/frankfurter'
import { fakeFxProvider } from '../../test/fakeFx'
import { makeTx } from '../../test/fixtures'
import { renderRoute, resetDb } from '../../test/render'
import { pendingDeletes, undoDelete } from '../undoDelete'
import { TradeJournalFields } from '../components/txform/TradeJournalFields'
import { emptyDraft, type Draft } from '../transactionDraft'

const account = { id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' }

beforeEach(async () => {
  await resetDb()
  await db.accounts.add(account)
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await Promise.allSettled(pendingDeletes().map((p) => undoDelete(db, p.tx.id)))
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
    expect(await db.instruments.get('US:AAPL')).toMatchObject({ symbol: 'AAPL', currency: 'USD', assetType: 'stock', unit: 'share' })
  })

  it('refuses a new symbol with a space or a colon and saves nothing', async () => {
    const user = userEvent.setup()
    renderRoute('/transactions/new', fakeFxProvider({ 'USD|THB': '35.1' }).provider)
    await user.type(await screen.findByLabelText('สัญลักษณ์'), 'a:b')
    await user.type(screen.getByLabelText('จำนวนหน่วย'), '2')
    await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '100')
    await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35.1'))
    await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(await screen.findByText('สัญลักษณ์ห้ามมีช่องว่างหรือเครื่องหมาย :')).toBeInTheDocument()
    expect(await db.transactions.count()).toBe(0)
    expect(await db.instruments.count()).toBe(0)
  })

  it('does not check the symbol of an instrument that is already known', async () => {
    await db.instruments.add({ id: 'US:A B', market: 'US', symbol: 'A B', name: 'Odd', assetType: 'stock', currency: 'USD' })
    const user = userEvent.setup()
    const router = renderRoute('/transactions/new', fakeFxProvider({ 'USD|THB': '35.1' }).provider)
    await user.type(await screen.findByLabelText('สัญลักษณ์'), 'a b')
    await user.type(screen.getByLabelText('จำนวนหน่วย'), '2')
    await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '100')
    await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35.1'))
    await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
    expect(await db.transactions.count()).toBe(1)
  })

  describe('units in the money route of the form', () => {
    const provider = () => fakeFxProvider({ 'USD|THB': '35' }).provider
    const routeOf = () => screen.getByText('เส้นทางเงินของรายการนี้').closest('div')!

    it('counts the units bought in the unit of a known asset', async () => {
      await db.instruments.add({ id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD' })
      const user = userEvent.setup()
      renderRoute('/transactions/new', provider())
      await user.type(await screen.findByLabelText('สัญลักษณ์'), 'aapl')
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '2')
      await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '100')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
      expect(within(routeOf()).getByText('AAPL 2 หุ้น')).toBeInTheDocument()
    })

    it('counts them in the unit picked for a new asset, and follows a change of it', async () => {
      const user = userEvent.setup()
      renderRoute('/transactions/new', provider())
      await user.type(await screen.findByLabelText('สัญลักษณ์'), 'newco')
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '2')
      await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '100')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
      expect(within(routeOf()).getByText('NEWCO 2 หุ้น')).toBeInTheDocument()
      await user.selectOptions(screen.getByLabelText('หน่วยนับ'), 'หน่วย')
      expect(within(routeOf()).getByText('NEWCO 2 หน่วย')).toBeInTheDocument()
    })
  })

  describe('Thai assets and units', () => {
    const noRates = () => fakeFxProvider({}).provider
    const openGold = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.selectOptions(await screen.findByLabelText('ตลาด'), 'ทองคำ (GOLD)')
      await user.type(screen.getByLabelText('สัญลักษณ์'), '96.5')
    }

    it('records a gold buy in baht-weight and says how much is held in that unit', async () => {
      const user = userEvent.setup()
      const router = renderRoute('/transactions/new', noRates())
      await openGold(user)
      expect(screen.getByLabelText('สกุลเงิน')).toHaveValue('THB')
      expect(screen.getByLabelText('ประเภทสินทรัพย์')).toHaveDisplayValue('ทองคำ')
      expect(screen.getByLabelText('หน่วยนับ')).toHaveDisplayValue('บาททองคำ')
      await user.type(screen.getByLabelText('ชื่อ (ไม่บังคับ)'), 'ทอง 96.5%')
      await user.selectOptions(screen.getByLabelText('ประเภทสินทรัพย์'), 'ทองคำ')
      await user.selectOptions(screen.getByLabelText('หน่วยนับ'), 'บาททองคำ')
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '2')
      await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '41000')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      expect(await db.instruments.get('GOLD:96.5')).toMatchObject({
        market: 'GOLD',
        symbol: '96.5',
        name: 'ทอง 96.5%',
        assetType: 'gold',
        currency: 'THB',
        unit: 'baht_gold',
      })

      await screen.findByRole('heading', { name: 'รายการทั้งหมด' })
      await act(() => router.navigate('/transactions/new'))
      await openGold(user)
      expect(await screen.findByText('ทอง 96.5% · ถืออยู่ 2 บาททองคำ')).toBeInTheDocument()
      expect(screen.queryByLabelText('หน่วยนับ')).not.toBeInTheDocument()
    })

    it('keeps the unit picked by hand and offers the default of the type again when the type changes', async () => {
      const user = userEvent.setup()
      const router = renderRoute('/transactions/new', noRates())
      await openGold(user)
      await user.selectOptions(screen.getByLabelText('หน่วยนับ'), 'กรัม')
      await user.selectOptions(screen.getByLabelText('ประเภทสินทรัพย์'), 'กองทุนรวม')
      expect(screen.getByLabelText('หน่วยนับ')).toHaveDisplayValue('หน่วย')
      await user.selectOptions(screen.getByLabelText('ประเภทสินทรัพย์'), 'ทองคำ')
      await user.selectOptions(screen.getByLabelText('หน่วยนับ'), 'กรัม')
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '15')
      await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '2700')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      expect(await db.instruments.get('GOLD:96.5')).toMatchObject({ assetType: 'gold', unit: 'gram', name: '96.5' })
    })

    it.each([
      ['FUND', 'กองทุนรวม (FUND)', 'SCBS&P500', 'FUND:SCBS&P500', 'fund'],
      ['BOND', 'หุ้นกู้/พันธบัตร (BOND)', 'CPALL26NA', 'BOND:CPALL26NA', 'bond'],
    ] as const)('records a %s in baht as units', async (_market, label, symbol, id, assetType) => {
      const user = userEvent.setup()
      const router = renderRoute('/transactions/new', noRates())
      await user.selectOptions(await screen.findByLabelText('ตลาด'), label)
      expect(screen.getByLabelText('สัญลักษณ์')).toHaveAttribute('placeholder', symbol)
      expect(screen.getByLabelText('สกุลเงิน')).toHaveValue('THB')
      expect(screen.getByLabelText('หน่วยนับ')).toHaveDisplayValue('หน่วย')
      await user.type(screen.getByLabelText('สัญลักษณ์'), symbol)
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '1200')
      await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '16.1')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      expect(await db.instruments.get(id)).toMatchObject({ currency: 'THB', assetType, unit: 'unit' })
    })

    it('saves a DR of the Thai market counted in shares', async () => {
      const user = userEvent.setup()
      const router = renderRoute('/transactions/new', noRates())
      await user.selectOptions(await screen.findByLabelText('ตลาด'), 'ไทย (SET)')
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'aapl80')
      await user.selectOptions(screen.getByLabelText('ประเภทสินทรัพย์'), 'DR')
      expect(screen.getByLabelText('หน่วยนับ')).toHaveDisplayValue('หุ้น')
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '500')
      await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '8.5')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      expect(await db.instruments.get('SET:AAPL80')).toMatchObject({ assetType: 'dr', currency: 'THB', unit: 'share' })
    })
  })

  describe('layout by width', () => {
    const phone = () =>
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    const fillBuy = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.type(await screen.findByLabelText('สัญลักษณ์'), 'AAPL')
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '2')
      await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '100')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
    }

    it('splits into two columns only from xl, because the sidebar takes 240px from md', async () => {
      renderRoute('/transactions/new', fakeFxProvider({ 'USD|THB': '35' }).provider)
      const grid = (await screen.findByRole('button', { name: 'บันทึก' })).closest('[class*="xl:grid-cols"]')!
      expect(grid).toHaveClass('grid-cols-[minmax(0,1fr)]', 'xl:grid-cols-[minmax(0,1fr)_340px]')
      expect(grid).not.toHaveClass('md:grid-cols-[minmax(0,1fr)_340px]')
    })

    it('gives the currency of a trade room for USDT on a phone and puts the price under it, then keeps equal thirds from sm', async () => {
      renderRoute('/transactions/new', fakeFxProvider({ 'USD|THB': '35' }).provider)
      const row = (await screen.findByLabelText('สกุลเงิน')).closest('[class*="grid-cols"]')!
      expect(row).toHaveClass('grid', 'grid-cols-[minmax(5.5rem,auto)_1fr]', 'sm:grid-cols-3')
      expect(row).not.toHaveClass('grid-cols-3')
      expect(row).toContainElement(screen.getByLabelText('จำนวนหน่วย'))
      expect(row).toContainElement(screen.getByLabelText('ราคาต่อหน่วย'))
      expect(screen.getByLabelText('ราคาต่อหน่วย').parentElement).toHaveClass('col-span-2', 'sm:col-span-1')
      expect(screen.getByLabelText('จำนวนหน่วย').parentElement).not.toHaveClass('col-span-2')
      expect(screen.getByLabelText('สกุลเงิน').parentElement).not.toHaveClass('col-span-2')
    })

    it('lets the time wrap to its own row while the card is narrow, between 768 and 880px', async () => {
      renderRoute('/transactions/new', fakeFxProvider({ 'USD|THB': '35' }).provider)
      const row = (await screen.findByLabelText('บัญชี')).closest('[class*="sm:grid-cols-3"]')!
      // md:grid-cols-2 with min-[880px]:grid-cols-3 would not do: Tailwind writes the min-[880px] rule before the md one,
      // so the md rule would win at every width from 768px.
      expect(row).toHaveClass('sm:grid-cols-3', 'md:max-[880px]:grid-cols-2')
      expect(row).not.toHaveClass('md:grid-cols-2')
      expect(row).toContainElement(screen.getByLabelText('วันที่'))
      expect(row).toContainElement(screen.getByLabelText(/เวลา/))
    })

    it.each([
      ['wide', () => {}],
      ['phone', phone],
    ])('shows the total once on a %s screen', async (_name, setUp) => {
      setUp()
      const user = userEvent.setup()
      renderRoute('/transactions/new', fakeFxProvider({ 'USD|THB': '35' }).provider)
      await fillBuy(user)
      expect(screen.getAllByText('รวม')).toHaveLength(1)
      expect(screen.getByText('200.00 USD')).toBeInTheDocument()
    })

    it('keeps the side panels, stacked under the form, from md', async () => {
      const user = userEvent.setup()
      renderRoute('/transactions/new', fakeFxProvider({ 'USD|THB': '35' }).provider)
      await fillBuy(user)
      const form = screen.getByRole('button', { name: 'บันทึก' }).closest('form')!
      const grid = form.querySelector('[class*="xl:grid-cols"]')!
      const [card, side] = Array.from(grid.children)
      expect(card).toContainElement(screen.getByRole('button', { name: 'บันทึก' }))
      expect(side).toContainElement(screen.getByText('รวม'))
      expect(side).toContainElement(screen.getByText('หลังบันทึก'))
      expect(card).not.toContainElement(screen.getByText('รวม'))
    })
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

  it('masks the quantities in the error list of a sell larger than the holding while the numbers are hidden', async () => {
    await saveSettings(db, { baseCurrency: 'THB', hideNumbersOnLaunch: true })
    await db.instruments.add({ id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD' })
    await db.transactions.add(makeTx({ quantity: '1', date: '2024-01-15' }))
    const user = userEvent.setup()
    renderRoute('/transactions/new', fakeFxProvider({ 'USD|THB': '35' }).provider)
    await user.click(await screen.findByRole('button', { name: 'ขาย' }))
    await user.type(screen.getByLabelText('สัญลักษณ์'), 'AAPL')
    await user.type(screen.getByLabelText('จำนวนหน่วย'), '5')
    await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '100')
    await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
    await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(await screen.findByText('ขาย ••• หน่วย แต่ถืออยู่ ••• หน่วย')).toBeInTheDocument()
    expect(screen.getByLabelText('จำนวนหน่วย')).toHaveValue('5')
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
    await db.transactions.add(makeTx({ id: 'buy-1', date: '2024-01-10' }))
    const confirm = vi.spyOn(window, 'confirm')
    const user = userEvent.setup()
    const router = renderRoute('/transactions/buy-1', fakeFxProvider({ 'USD|THB': '35' }).provider)
    await user.click(await screen.findByRole('button', { name: 'ลบรายการนี้' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
    expect(await db.transactions.count()).toBe(0)
    expect(confirm).not.toHaveBeenCalled()
    const undo = await screen.findByRole('button', { name: 'ย้อนกลับการลบ ซื้อ 2024-01-10' })
    expect(within(undo.closest('tr')!).getByText('ยกเลิกแล้ว')).toBeInTheDocument()
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

  describe('opening on a type named in the link', () => {
    const provider = () => fakeFxProvider({ 'USD|THB': '33.5' }).provider
    const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')

    it('opens on the exchange type with the account currency as the source', async () => {
      renderRoute('/transactions/new?type=fx_convert', provider())
      expect(await screen.findByRole('button', { name: 'แลกเงิน' })).toHaveAttribute('aria-pressed', 'true')
      expect(pressed('ซื้อ')).toBe('false')
      expect(screen.getByLabelText('สกุลเงินต้นทาง')).toHaveValue('THB')
      expect(screen.getByLabelText('จำนวนเงินต้นทาง')).toBeInTheDocument()
    })

    it('opens on a type that sits behind the more menu', async () => {
      renderRoute('/transactions/new?type=opening', provider())
      expect(await screen.findByLabelText('ประเภทอื่นๆ')).toHaveValue('opening')
      expect(pressed('สินทรัพย์ที่ถืออยู่')).toBe('true')
      expect(screen.getByLabelText('ต้นทุนเฉลี่ยต่อหน่วย')).toBeInTheDocument()
    })

    it('picks the target account of a transfer as the type picker does', async () => {
      await db.accounts.add({ id: 'acc-2', name: 'IBKR', broker: 'IBKR', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
      renderRoute('/transactions/new?type=transfer', provider())
      expect(await screen.findByLabelText('บัญชีปลายทาง')).toHaveDisplayValue('IBKR')
    })

    it('stays on a buy when the type is not one of the types', async () => {
      renderRoute('/transactions/new?type=gift', provider())
      expect(await screen.findByRole('button', { name: 'ซื้อ' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('leaves a copy as it was when the link names a type as well', async () => {
      await db.transactions.add(makeTx({ id: 'aapl-buy', quantity: '2', price: '100', date: '2024-03-10' }))
      renderRoute('/transactions/new?from=aapl-buy&type=fx_convert', provider())
      expect(await screen.findByLabelText('สัญลักษณ์')).toHaveValue('AAPL')
      expect(pressed('ซื้อ')).toBe('true')
    })

    it('leaves a transaction being edited as it was', async () => {
      await db.transactions.add(makeTx({ id: 'buy-1' }))
      renderRoute('/transactions/buy-1?type=fx_convert', provider())
      expect(await screen.findByLabelText('สัญลักษณ์')).toHaveValue('AAPL')
      expect(pressed('ซื้อ')).toBe('true')
    })

    it('lets the type be changed from the picker afterwards', async () => {
      const user = userEvent.setup()
      renderRoute('/transactions/new?type=fx_convert', provider())
      await user.click(await screen.findByRole('button', { name: 'ซื้อ' }))
      expect(pressed('ซื้อ')).toBe('true')
      expect(pressed('แลกเงิน')).toBe('false')
      expect(screen.getByLabelText('สกุลเงิน')).toHaveValue('USD')
    })

    it('opens the other type when the link changes', async () => {
      const router = renderRoute('/transactions/new?type=fx_convert', provider())
      expect(await screen.findByRole('button', { name: 'แลกเงิน' })).toHaveAttribute('aria-pressed', 'true')
      await act(() => router.navigate('/transactions/new?type=deposit'))
      expect(await screen.findByRole('button', { name: 'ฝากเงิน' })).toHaveAttribute('aria-pressed', 'true')
    })
  })

  describe('a dollar-pegged coin', () => {
    async function pickCurrency(provider: FxProvider, currency: string) {
      const user = userEvent.setup()
      renderRoute('/transactions/new', provider)
      await user.selectOptions(await screen.findByLabelText('สกุลเงิน'), currency)
      return user
    }

    it('takes the dollar rate when it has none of its own', async () => {
      await pickCurrency(fakeFxProvider({ 'USD|THB': '33' }).provider, 'USDT')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('33'))
      expect(screen.getByText(/^ใช้เรท USD/)).toBeInTheDocument()
      expect(screen.getByText('ประมาณ')).toBeInTheDocument()
      expect(screen.queryByText('อัตโนมัติ')).not.toBeInTheDocument()
      expect(screen.queryByText(/ไม่มีเรทอัตโนมัติ/)).not.toBeInTheDocument()
    })

    it('names the day of the dollar rate when it is not the day picked', async () => {
      await pickCurrency(fakeFxProvider({ 'USD|THB': '33' }).provider, 'USDT')
      expect(await screen.findByText('ใช้เรท USD · ECB 15 ม.ค. 2024')).toBeInTheDocument()
    })

    it('leaves the day out when the dollar rate is the rate of the day picked', async () => {
      await pickCurrency(fakeFxProvider({ 'USD|THB': '33' }).provider, 'USDT')
      fireEvent.change(screen.getByLabelText('วันที่'), { target: { value: '2024-01-15' } })
      expect(await screen.findByText('ใช้เรท USD')).toBeInTheDocument()
      expect(screen.queryByText(/ECB 15 ม.ค. 2024/)).not.toBeInTheDocument()
    })

    it('saves a coin bought in it with the dollar rate as an estimate', async () => {
      const user = userEvent.setup()
      renderRoute('/transactions/new', fakeFxProvider({ 'USD|THB': '33' }).provider)
      await user.selectOptions(await screen.findByLabelText('ตลาด'), 'CRYPTO')
      await user.selectOptions(screen.getByLabelText('สกุลเงิน'), 'USDT')
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'btc')
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '0.01')
      await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '60000')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('33'))
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(async () => expect(await db.transactions.count()).toBe(1))
      expect((await db.transactions.toArray())[0]).toMatchObject({ instrumentId: 'CRYPTO:BTC', currency: 'USDT', fxRate: '33', fxSource: 'estimated' })
    })

    it('keeps a rate typed by hand over the dollar rate', async () => {
      const user = await pickCurrency(fakeFxProvider({ 'USD|THB': '33' }).provider, 'USDT')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('33'))
      await user.clear(screen.getByLabelText(/เรทแลกเปลี่ยน/))
      await user.type(screen.getByLabelText(/เรทแลกเปลี่ยน/), '34.1')
      expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('34.1')
      expect(screen.getByText('กรอกเอง')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'กลับไปใช้เรทกลาง 33' })).toBeInTheDocument()
    })

    it('saves a rate typed over the dollar rate as typed by hand, and the dollar rate again as an estimate', async () => {
      const user = userEvent.setup()
      renderRoute('/transactions/new', fakeFxProvider({ 'USD|THB': '33' }).provider)
      await user.selectOptions(await screen.findByLabelText('ตลาด'), 'CRYPTO')
      await user.selectOptions(screen.getByLabelText('สกุลเงิน'), 'USDT')
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'btc')
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '0.01')
      await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '60000')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('33'))
      await user.clear(screen.getByLabelText(/เรทแลกเปลี่ยน/))
      await user.type(screen.getByLabelText(/เรทแลกเปลี่ยน/), '34.1')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(async () => expect(await db.transactions.count()).toBe(1))
      expect((await db.transactions.toArray())[0]).toMatchObject({ fxRate: '34.1', fxSource: 'manual' })
    })

    it('goes back to the dollar rate as an estimate, not as an automatic rate', async () => {
      const user = await pickCurrency(fakeFxProvider({ 'USD|THB': '33' }).provider, 'USDT')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('33'))
      await user.clear(screen.getByLabelText(/เรทแลกเปลี่ยน/))
      await user.type(screen.getByLabelText(/เรทแลกเปลี่ยน/), '34.1')
      expect(screen.getByText('กรอกเอง')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'กลับไปใช้เรทกลาง 33' }))
      expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('33')
      expect(screen.getByText('ประมาณ')).toBeInTheDocument()
      expect(screen.queryByText('อัตโนมัติ')).not.toBeInTheDocument()
    })

    it('says why there is no rate when the dollar has none either', async () => {
      await pickCurrency(fakeFxProvider({}).provider, 'USDT')
      expect(await screen.findByText(/ไม่มีเรทอัตโนมัติสำหรับ USDT\/THB/)).toBeInTheDocument()
      expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('')
      expect(screen.queryByText('ใช้เรท USD')).not.toBeInTheDocument()
    })

    it('does not borrow the dollar for a currency that is not pegged to it', async () => {
      await pickCurrency(fakeFxProvider({ 'USD|THB': '33' }).provider, 'VND')
      expect(await screen.findByText(/ไม่มีเรทอัตโนมัติสำหรับ VND\/THB/)).toBeInTheDocument()
      expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('')
    })
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

    it('says the exchange is at the market rate when its spread rounds to nothing at the digits shown', async () => {
      const { user } = await openExchange(fakeFxProvider({ 'USD|THB': '33.5' }).provider)
      await user.type(screen.getByLabelText('จำนวนเงินต้นทาง'), '20000')
      await waitFor(() => expect(screen.getByLabelText('จำนวนที่ได้รับ')).toHaveValue('597.01'))
      expect(screen.getByText(/เรทตลาด 33\.50 · เท่าตลาด$/)).toBeInTheDocument()
      expect(screen.queryByText(/ตลาด 0%/)).not.toBeInTheDocument()
    })

    it('takes the dollar rate as the market rate when the exchange is into a dollar-pegged coin', async () => {
      const { user } = await openExchange(fakeFxProvider({ 'USD|THB': '33.5' }).provider)
      await user.selectOptions(screen.getByLabelText('สกุลเงินปลายทาง'), 'USDT')
      await user.type(screen.getByLabelText('จำนวนเงินต้นทาง'), '20000')
      await waitFor(() => expect(screen.getByLabelText('จำนวนที่ได้รับ')).toHaveValue('597.01'))
      expect(screen.getByText(/คำนวณจากเรทกลาง ECB 15 ม.ค. 2024 · ใช้เรท USD · 1 USDT = 33\.50 THB/)).toBeInTheDocument()
    })

    it('asks for the received amount by hand when the dollar has no rate either', async () => {
      const { user } = await openExchange(fakeFxProvider({}).provider)
      await user.selectOptions(screen.getByLabelText('สกุลเงินปลายทาง'), 'USDT')
      await user.type(screen.getByLabelText('จำนวนเงินต้นทาง'), '20000')
      expect(await screen.findByText('ไม่มีเรทกลางของวันนั้น กรอกจำนวนที่ได้รับเอง')).toBeInTheDocument()
      expect(screen.getByLabelText('จำนวนที่ได้รับ')).toHaveValue('')
    })

    it('does not mention the dollar when the exchange is not into a pegged coin', async () => {
      const { user } = await openExchange(fakeFxProvider({ 'USD|THB': '33.5' }).provider)
      await user.type(screen.getByLabelText('จำนวนเงินต้นทาง'), '20000')
      await waitFor(() => expect(screen.getByLabelText('จำนวนที่ได้รับ')).toHaveValue('597.01'))
      expect(screen.queryByText(/ใช้เรท USD/)).not.toBeInTheDocument()
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

    it('masks the computed amount on the link back to it, and still puts the real amount in the field', async () => {
      await saveSettings(db, { baseCurrency: 'THB', hideNumbersOnLaunch: true })
      const { user } = await openExchange(fakeFxProvider({ 'USD|THB': '33.5' }).provider)
      const received = screen.getByLabelText('จำนวนที่ได้รับ')
      await user.type(screen.getByLabelText('จำนวนเงินต้นทาง'), '20000')
      await waitFor(() => expect(received).toHaveValue('597.01'))
      await user.clear(received)
      await user.type(received, '590')
      await user.type(screen.getByLabelText(/ค่าธรรมเนียม/), '50')
      expect(received).toHaveValue('590')
      expect(screen.queryByRole('button', { name: /595\.52/ })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'ใช้ยอดคำนวณ •••' }))
      expect(received).toHaveValue('595.52')
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
      expect(await db.instruments.get('CRYPTO:ETH')).toMatchObject({
        symbol: 'ETH',
        currency: 'USD',
        assetType: 'crypto',
        name: 'ETH',
        unit: 'coin',
      })
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

    it('counts a new coin received in coins unless another unit is picked for it', async () => {
      const { user } = await openSwap()
      await fillSwap(user)
      expect(document.getElementById('tx-to-unit')).toHaveDisplayValue('เหรียญ')
      expect(document.getElementById('tx-unit')).toBeNull()
      await user.selectOptions(document.getElementById('tx-to-unit') as HTMLElement, 'หน่วย')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(async () => expect(await db.instruments.get('CRYPTO:ETH')).toMatchObject({ assetType: 'crypto', unit: 'unit' }))
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

    it('sets the groups apart with a hairline above every group that follows another, and reads the legends as titles', async () => {
      await openSwap()
      const given = screen.getByRole('group', { name: 'แลกออก' })
      const received = screen.getByRole('group', { name: 'ได้รับ' })
      for (const group of [given, received]) {
        expect(group.parentElement).toHaveClass('[&~&]:border-t', '[&~&]:pt-4')
        expect(within(group).getByText(group === given ? 'แลกออก' : 'ได้รับ', { selector: 'legend' })).toHaveClass('text-base')
      }
      expect(given.parentElement).not.toHaveClass('border-t')
      expect(received.parentElement).not.toHaveClass('border-t')
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
      expect(await screen.findByText('Bitcoin · ถืออยู่ 0.01 เหรียญ')).toBeInTheDocument()
      expect(screen.getByText('Ethereum · ถืออยู่ 2 เหรียญ')).toBeInTheDocument()
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

  describe('assets received as income', () => {
    const provider = () => fakeFxProvider({ 'USD|THB': '35' }).provider

    async function openReceive() {
      const user = userEvent.setup()
      const router = renderRoute('/transactions/new', provider())
      await user.selectOptions(await screen.findByLabelText('ประเภทอื่นๆ'), 'รับเป็นสินทรัพย์')
      return { user, router }
    }

    it('records staking income received as coins', async () => {
      const { user, router } = await openReceive()
      expect(screen.getByLabelText('ประเภท')).toHaveDisplayValue('ปันผลเป็นหุ้น')
      await user.selectOptions(screen.getByLabelText('ตลาด'), 'คริปโต')
      expect(screen.getByLabelText('ประเภท')).toHaveDisplayValue('Staking')
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'sol')
      await user.type(screen.getByLabelText('จำนวนที่ได้รับ'), '0.5')
      await user.type(screen.getByLabelText('มูลค่าต่อหน่วย ณ วันที่ได้รับ'), '150')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
      expect(screen.getByText('75.00 USD')).toBeInTheDocument()
      expect(screen.getByText('≈ 2,625.00 THB ที่เรท 35.00')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      const [saved] = await db.transactions.toArray()
      expect(saved).toMatchObject({
        type: 'receive_asset',
        receiveKind: 'staking',
        instrumentId: 'CRYPTO:SOL',
        quantity: '0.5',
        price: '150',
        tax: '0',
        currency: 'USD',
        fxRate: '35',
      })
      expect(saved.amount).toBeUndefined()
      expect(await db.instruments.get('CRYPTO:SOL')).toMatchObject({ symbol: 'SOL', currency: 'USD', assetType: 'crypto', unit: 'coin' })
    })

    it('starts on stock dividend and follows the market until the user picks a kind', async () => {
      const { user } = await openReceive()
      const kind = screen.getByLabelText('ประเภท')
      expect(Array.from((kind as HTMLSelectElement).options).map((o) => o.text)).toEqual([
        'ปันผลเป็นหุ้น',
        'Staking',
        'Airdrop',
        'ดอกเบี้ยเป็นเหรียญ',
        'อื่นๆ',
      ])
      await user.selectOptions(kind, 'Airdrop')
      await user.selectOptions(screen.getByLabelText('ตลาด'), 'คริปโต')
      expect(kind).toHaveDisplayValue('Airdrop')
    })

    it('asks for the value on the day and the tax withheld, and not for fees, an amount or a price', async () => {
      await openReceive()
      expect(screen.getByLabelText('จำนวนที่ได้รับ')).toHaveAttribute('id', 'tx-quantity')
      expect(screen.getByLabelText('มูลค่าต่อหน่วย ณ วันที่ได้รับ')).toHaveAttribute('id', 'tx-price')
      expect(screen.getByLabelText('ภาษีหัก ณ ที่จ่าย')).toHaveAttribute('id', 'tx-tax')
      expect(screen.getByLabelText('ประเภท')).toHaveAttribute('id', 'tx-receive-kind')
      expect(screen.queryByLabelText('ค่าธรรมเนียม')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('จำนวนเงิน')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('จำนวนหน่วย')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('ราคาต่อหน่วย')).not.toBeInTheDocument()
    })

    it('puts the tax beside the currency, the quantity beside the value, and lets the kind take the whole row', async () => {
      await openReceive()
      const rowOf = (id: string) => document.getElementById(id)!.parentElement!.parentElement!
      expect(rowOf('tx-tax')).toBe(rowOf('tx-currency'))
      expect(rowOf('tx-tax')).toHaveClass('grid', 'sm:grid-cols-2')
      expect(rowOf('tx-quantity')).toBe(rowOf('tx-price'))
      expect(rowOf('tx-quantity')).toHaveClass('grid', 'sm:grid-cols-2')
      expect(rowOf('tx-quantity')).not.toBe(rowOf('tx-tax'))
      expect(rowOf('tx-receive-kind')).not.toHaveClass('sm:grid-cols-2')
      expect(rowOf('tx-receive-kind')).not.toBe(rowOf('tx-market'))
    })

    it('records a stock dividend with tax withheld and shows the units after saving', async () => {
      await db.instruments.add({ id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'ปตท.', assetType: 'stock', currency: 'THB' })
      await db.transactions.add(
        makeTx({ id: 'ptt-buy', instrumentId: 'SET:PTT', currency: 'THB', fxRate: '1', fxSource: 'same', quantity: '1000', price: '35', date: '2024-01-10' }),
      )
      const { user, router } = await openReceive()
      await user.selectOptions(screen.getByLabelText('ตลาด'), 'ไทย (SET)')
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'ptt')
      expect(await screen.findByText('ปตท. · ถืออยู่ 1,000 หุ้น')).toBeInTheDocument()
      await user.type(screen.getByLabelText('จำนวนที่ได้รับ'), '100')
      await user.type(screen.getByLabelText('มูลค่าต่อหน่วย ณ วันที่ได้รับ'), '1')
      await user.type(screen.getByLabelText('ภาษีหัก ณ ที่จ่าย'), '10')
      expect(screen.getByText('100.00 THB')).toBeInTheDocument()
      expect(screen.getByText('PTT ที่ถือ').nextSibling).toHaveTextContent('1,000 → 1,100')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      expect((await db.transactions.toArray()).find((t) => t.type === 'receive_asset')).toMatchObject({
        receiveKind: 'stock_dividend',
        instrumentId: 'SET:PTT',
        quantity: '100',
        price: '1',
        tax: '10',
        fxRate: '1',
      })
    })

    it('lets an airdrop with no value yet be saved with a value of zero', async () => {
      const { user } = await openReceive()
      await user.selectOptions(screen.getByLabelText('ตลาด'), 'คริปโต')
      await user.selectOptions(screen.getByLabelText('ประเภท'), 'Airdrop')
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'arb')
      await user.type(screen.getByLabelText('จำนวนที่ได้รับ'), '100')
      await user.type(screen.getByLabelText('มูลค่าต่อหน่วย ณ วันที่ได้รับ'), '0')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(async () => expect(await db.transactions.count()).toBe(1))
      expect((await db.transactions.toArray())[0]).toMatchObject({ receiveKind: 'airdrop', quantity: '100', price: '0' })
    })

    it('asks for the missing parts when saved empty', async () => {
      const { user } = await openReceive()
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      expect(await screen.findByText('กรุณาระบุหุ้น/สินทรัพย์')).toBeInTheDocument()
      expect(screen.getByText('จำนวนที่ได้รับต้องเป็นตัวเลขมากกว่า 0')).toBeInTheDocument()
      expect(screen.getByText('มูลค่าต่อหน่วยต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป')).toBeInTheDocument()
      expect(await db.transactions.count()).toBe(0)
    })

    it('opens a saved asset received with its kind, quantity, value and tax', async () => {
      await db.transactions.add(
        makeTx({
          id: 'recv-1',
          type: 'receive_asset',
          receiveKind: 'coin_interest',
          instrumentId: 'CRYPTO:SOL',
          quantity: '0.5',
          price: '150',
          tax: '1',
          fxRate: '35',
          date: '2024-04-01',
        }),
      )
      renderRoute('/transactions/recv-1', provider())
      expect(await screen.findByLabelText('ประเภท')).toHaveDisplayValue('ดอกเบี้ยเป็นเหรียญ')
      expect(screen.getByLabelText('สัญลักษณ์')).toHaveValue('SOL')
      expect(screen.getByLabelText('จำนวนที่ได้รับ')).toHaveValue('0.5')
      expect(screen.getByLabelText('มูลค่าต่อหน่วย ณ วันที่ได้รับ')).toHaveValue('150')
      expect(screen.getByLabelText('ภาษีหัก ณ ที่จ่าย')).toHaveValue('1')
      expect(screen.getByLabelText('ประเภทอื่นๆ')).toHaveDisplayValue('รับเป็นสินทรัพย์')
    })

    it('shows the value on a phone too', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
      const { user } = await openReceive()
      await user.selectOptions(screen.getByLabelText('ตลาด'), 'คริปโต')
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'sol')
      await user.type(screen.getByLabelText('จำนวนที่ได้รับ'), '0.5')
      await user.type(screen.getByLabelText('มูลค่าต่อหน่วย ณ วันที่ได้รับ'), '150')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
      expect(screen.getByText('75.00 USD')).toBeInTheDocument()
    })
  })

  describe('what a fee is paid in', () => {
    const provider = () => fakeFxProvider({ 'USD|THB': '35' }).provider
    const heldBnb = () => makeTx({ id: 'bnb-buy', instrumentId: 'CRYPTO:BNB', quantity: '1', price: '500', fxRate: '34', date: '2024-01-10' })
    const optionsOf = (label: string) => Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.text)

    async function openEthBuy() {
      await db.transactions.add(heldBnb())
      const user = userEvent.setup()
      const router = renderRoute('/transactions/new', provider())
      await user.selectOptions(await screen.findByLabelText('ตลาด'), 'คริปโต')
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'eth')
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '1')
      await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '2000')
      return { user, router }
    }

    it('says how much of the fee asset is held in the unit of that asset', async () => {
      await db.instruments.add({ id: 'CRYPTO:BNB', market: 'CRYPTO', symbol: 'BNB', name: 'BNB', assetType: 'crypto', currency: 'USD' })
      const { user } = await openEthBuy()
      await user.selectOptions(screen.getByLabelText('จ่ายเป็น'), 'สินทรัพย์อื่น')
      await user.type(screen.getByLabelText('สินทรัพย์ที่ใช้จ่าย'), 'bnb')
      expect(await screen.findByText('BNB · ถืออยู่ 1 เหรียญ')).toBeInTheDocument()
    })

    it('records a buy whose fee was paid in BNB', async () => {
      const { user, router } = await openEthBuy()
      await user.selectOptions(screen.getByLabelText('จ่ายเป็น'), 'สินทรัพย์อื่น')
      await user.type(screen.getByLabelText('สินทรัพย์ที่ใช้จ่าย'), 'bnb')
      expect(await screen.findByText('ถืออยู่ 1 หน่วย')).toBeInTheDocument()
      await user.type(screen.getByLabelText('จำนวน'), '0.001')
      await user.type(screen.getByLabelText('มูลค่าค่าธรรมเนียม (USD)'), '0.6')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
      expect(screen.getByText('BNB ที่ถือ').nextSibling).toHaveTextContent('1 → 0.999')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      const saved = (await db.transactions.toArray()).find((t) => t.instrumentId === 'CRYPTO:ETH')
      expect(saved).toMatchObject({ feePaidIn: 'asset', feeInstrumentId: 'CRYPTO:BNB', feeQuantity: '0.001', fees: '0.6' })
      expect(await db.instruments.get('CRYPTO:BNB')).toBeUndefined()
    })

    it('shows what actually arrives when the fee is taken from the coins received', async () => {
      const { user, router } = await openEthBuy()
      await user.selectOptions(screen.getByLabelText('จ่ายเป็น'), 'หักจากที่ได้รับ')
      await user.type(screen.getByLabelText('จำนวนที่ถูกหัก (ETH)'), '0.001')
      expect(screen.getByText('ได้รับจริง 0.999 ETH')).toBeInTheDocument()
      expect(screen.queryByLabelText('ค่าธรรมเนียม')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('สินทรัพย์ที่ใช้จ่าย')).not.toBeInTheDocument()
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
      expect(screen.getByText('ETH ที่ถือ').nextSibling).toHaveTextContent('0 → 0.999')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      const saved = (await db.transactions.toArray()).find((t) => t.instrumentId === 'CRYPTO:ETH')
      expect(saved).toMatchObject({ feePaidIn: 'received', feeQuantity: '0.001', fees: '0' })
      expect(saved?.feeInstrumentId).toBeUndefined()
    })

    it('keeps the money fee out of the way, and out of the record, once the units are what is paid', async () => {
      const { user, router } = await openEthBuy()
      await user.type(screen.getByLabelText('ค่าธรรมเนียม'), '5')
      await user.selectOptions(screen.getByLabelText('จ่ายเป็น'), 'หักจากที่ได้รับ')
      await user.type(screen.getByLabelText('จำนวนที่ถูกหัก (ETH)'), '0.001')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      expect((await db.transactions.toArray()).find((t) => t.instrumentId === 'CRYPTO:ETH')).toMatchObject({ fees: '0' })
    })

    it('offers each type only the ways of paying that make sense', async () => {
      const user = userEvent.setup()
      renderRoute('/transactions/new', provider())
      await user.selectOptions(await screen.findByLabelText('ตลาด'), 'คริปโต')
      expect(optionsOf('จ่ายเป็น')).toEqual(['เงินสด', 'หักจากที่ได้รับ', 'สินทรัพย์อื่น'])
      await user.click(screen.getByRole('button', { name: 'ขาย' }))
      expect(optionsOf('จ่ายเป็น')).toEqual(['เงินสด', 'สินทรัพย์อื่น'])
      await user.selectOptions(screen.getByLabelText('ประเภทอื่นๆ'), 'แลกเหรียญ')
      expect(optionsOf('จ่ายเป็น')).toEqual(['เงินสด', 'หักจากที่ได้รับ', 'สินทรัพย์อื่น'])
      await user.click(screen.getByRole('button', { name: 'ปันผล' }))
      expect(screen.queryByLabelText('จ่ายเป็น')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'ฝากเงิน' }))
      expect(screen.queryByLabelText('จ่ายเป็น')).not.toBeInTheDocument()
    })

    it('starts on cash and puts the money fee beside it', async () => {
      const user = userEvent.setup()
      renderRoute('/transactions/new', provider())
      await user.selectOptions(await screen.findByLabelText('ตลาด'), 'คริปโต')
      expect(screen.getByLabelText('จ่ายเป็น')).toHaveDisplayValue('เงินสด')
      expect(screen.getByLabelText('ค่าธรรมเนียม')).toBeInTheDocument()
      expect(screen.getByLabelText('ภาษี / VAT')).toBeInTheDocument()
      expect(screen.queryByLabelText('จำนวนที่ถูกหัก (ETH)')).not.toBeInTheDocument()
      expect(screen.queryByRole('group', { name: 'ค่าธรรมเนียมที่จ่ายเป็นสินทรัพย์' })).not.toBeInTheDocument()
    })

    it.each(['สหรัฐ (US)', 'ไทย (SET)'])('leaves a %s share with the plain fee and tax row and no way of paying', async (market) => {
      const user = userEvent.setup()
      renderRoute('/transactions/new', provider())
      await user.selectOptions(await screen.findByLabelText('ตลาด'), market)
      expect(screen.queryByLabelText('จ่ายเป็น')).not.toBeInTheDocument()
      const row = screen.getByLabelText('ค่าธรรมเนียม').closest('div[class*="grid-cols-2"]')!
      expect(row).toHaveClass('grid', 'grid-cols-2')
      expect(row).not.toHaveClass('sm:grid-cols-3')
      expect(Array.from(row.children).map((cell) => cell.querySelector('label')?.textContent)).toEqual(['ค่าธรรมเนียม', 'ภาษี / VAT'])
      await user.click(screen.getByRole('button', { name: 'ขาย' }))
      expect(screen.queryByLabelText('จ่ายเป็น')).not.toBeInTheDocument()
    })

    it('offers the way of paying again as soon as the market becomes crypto', async () => {
      const user = userEvent.setup()
      renderRoute('/transactions/new', provider())
      await user.selectOptions(await screen.findByLabelText('ตลาด'), 'คริปโต')
      expect(screen.getByLabelText('จ่ายเป็น')).toBeInTheDocument()
      await user.selectOptions(screen.getByLabelText('ตลาด'), 'สหรัฐ (US)')
      expect(screen.queryByLabelText('จ่ายเป็น')).not.toBeInTheDocument()
    })

    it('keeps the way of paying visible when a saved share was paid for another way', async () => {
      await db.transactions.add(makeTx({ id: 'odd', quantity: '1', date: '2024-01-12', feePaidIn: 'received', feeQuantity: '0.1' }))
      renderRoute('/transactions/odd', provider())
      expect(await screen.findByLabelText('จ่ายเป็น')).toHaveDisplayValue('หักจากที่ได้รับ')
    })

    it('gives the way of paying a row of its own on a phone once the fee is not paid in cash, and lets the units field have one too', async () => {
      const { user } = await openEthBuy()
      const cell = (id: string) => document.getElementById(id)!.parentElement!
      const row = cell('tx-fee-paid-in').parentElement!
      expect(row).toHaveClass('grid-cols-2', 'sm:grid-cols-3')
      expect(cell('tx-fee-paid-in')).not.toHaveClass('col-span-2')
      await user.selectOptions(screen.getByLabelText('จ่ายเป็น'), 'หักจากที่ได้รับ')
      expect(cell('tx-fee-paid-in')).toHaveClass('col-span-2', 'sm:col-span-1')
      expect(cell('tx-fee-quantity')).toHaveClass('col-span-2', 'sm:col-span-1')
      expect(cell('tx-tax')).not.toHaveClass('col-span-2')
      await user.selectOptions(screen.getByLabelText('จ่ายเป็น'), 'สินทรัพย์อื่น')
      expect(cell('tx-fee-paid-in')).toHaveClass('col-span-2', 'sm:col-span-1')
      await user.selectOptions(screen.getByLabelText('จ่ายเป็น'), 'เงินสด')
      expect(cell('tx-fee-paid-in')).not.toHaveClass('col-span-2')
      expect(cell('tx-fees')).not.toHaveClass('col-span-2')
    })

    it('goes back to the currency when the new type cannot pay the way that was chosen', async () => {
      const { user } = await openEthBuy()
      await user.selectOptions(screen.getByLabelText('จ่ายเป็น'), 'หักจากที่ได้รับ')
      await user.click(screen.getByRole('button', { name: 'ขาย' }))
      expect(screen.getByLabelText('จ่ายเป็น')).toHaveDisplayValue('เงินสด')
      expect(screen.getByLabelText('ค่าธรรมเนียม')).toBeInTheDocument()
    })

    it('asks for the fee asset in a group of its own, only among what is already held', async () => {
      const { user } = await openEthBuy()
      await user.selectOptions(screen.getByLabelText('จ่ายเป็น'), 'สินทรัพย์อื่น')
      const group = screen.getByRole('group', { name: 'ค่าธรรมเนียมที่จ่ายเป็นสินทรัพย์' })
      expect(group.parentElement).toHaveClass('border-t', 'pt-4')
      expect(within(group).getByLabelText('ตลาด')).toHaveDisplayValue('คริปโต')
      expect(within(group).getByLabelText('สินทรัพย์ที่ใช้จ่าย')).toHaveAttribute('id', 'tx-fee-symbol')
      expect(within(group).getByLabelText('จำนวน')).toHaveAttribute('id', 'tx-fee-quantity')
      expect(within(group).getByLabelText('มูลค่าค่าธรรมเนียม (USD)')).toHaveAttribute('id', 'tx-fees')
      await user.type(within(group).getByLabelText('สินทรัพย์ที่ใช้จ่าย'), 'xyz')
      expect(document.getElementById('tx-fee-name')).toBeNull()
      expect(document.getElementById('tx-fee-asset-type')).toBeNull()
      expect(screen.queryByLabelText('ค่าธรรมเนียม')).not.toBeInTheDocument()
    })

    it('refuses a fee in an asset that is not held in that amount', async () => {
      const { user } = await openEthBuy()
      await user.selectOptions(screen.getByLabelText('จ่ายเป็น'), 'สินทรัพย์อื่น')
      await user.type(screen.getByLabelText('สินทรัพย์ที่ใช้จ่าย'), 'bnb')
      await user.type(screen.getByLabelText('จำนวน'), '2')
      await user.type(screen.getByLabelText('มูลค่าค่าธรรมเนียม (USD)'), '1200')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      expect(await screen.findByText('ค่าธรรมเนียม 2 BNB แต่ถืออยู่ 1 BNB')).toBeInTheDocument()
      expect(await db.transactions.count()).toBe(1)
    })

    it('asks for each missing part of a fee paid in an asset', async () => {
      const { user } = await openEthBuy()
      await user.selectOptions(screen.getByLabelText('จ่ายเป็น'), 'สินทรัพย์อื่น')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      expect(await screen.findByText('กรุณาระบุสินทรัพย์ที่ใช้จ่ายค่าธรรมเนียม')).toBeInTheDocument()
      expect(screen.getByText('จำนวนที่จ่ายค่าธรรมเนียมต้องเป็นตัวเลขมากกว่า 0')).toBeInTheDocument()
      expect(screen.getByText('มูลค่าค่าธรรมเนียมต้องเป็นตัวเลขมากกว่า 0')).toBeInTheDocument()
      expect(await db.transactions.count()).toBe(1)
    })

    it('takes the fee of a sell from BNB and leaves the gain to the sell', async () => {
      await db.transactions.bulkAdd([
        heldBnb(),
        makeTx({ id: 'eth-buy', instrumentId: 'CRYPTO:ETH', quantity: '1', price: '2000', fxRate: '34', date: '2024-01-09' }),
      ])
      const user = userEvent.setup()
      const router = renderRoute('/transactions/new', provider())
      await user.click(await screen.findByRole('button', { name: 'ขาย' }))
      await user.selectOptions(screen.getByLabelText('ตลาด'), 'คริปโต')
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'eth')
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '1')
      await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '2500')
      await user.selectOptions(screen.getByLabelText('จ่ายเป็น'), 'สินทรัพย์อื่น')
      await user.type(screen.getByLabelText('สินทรัพย์ที่ใช้จ่าย'), 'bnb')
      await user.type(screen.getByLabelText('จำนวน'), '0.001')
      await user.type(screen.getByLabelText('มูลค่าค่าธรรมเนียม (USD)'), '0.6')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
      expect(screen.getByText('2,500.00 USD')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      expect((await db.transactions.toArray()).find((t) => t.type === 'sell')).toMatchObject({
        feePaidIn: 'asset',
        feeInstrumentId: 'CRYPTO:BNB',
        feeQuantity: '0.001',
        fees: '0.6',
      })
    })

    it('takes the fee of a swap from the coin received, named in the field', async () => {
      await db.transactions.add(makeTx({ id: 'btc-buy', instrumentId: 'CRYPTO:BTC', quantity: '0.01', price: '58000', fxRate: '34', date: '2024-01-15' }))
      const user = userEvent.setup()
      renderRoute('/transactions/new', provider())
      await user.selectOptions(await screen.findByLabelText('ประเภทอื่นๆ'), 'แลกเหรียญ')
      await user.type(screen.getByLabelText('สินทรัพย์ที่แลกออก'), 'btc')
      await user.type(screen.getByLabelText('จำนวนที่แลกออก'), '0.01')
      await user.type(screen.getByLabelText('สินทรัพย์ที่ได้รับ'), 'eth')
      await user.type(screen.getByLabelText('จำนวนที่ได้รับ'), '0.25')
      await user.type(screen.getByLabelText('มูลค่ารวม ณ ตอนแลก'), '660')
      await user.selectOptions(screen.getByLabelText('จ่ายเป็น'), 'หักจากที่ได้รับ')
      await user.type(screen.getByLabelText('จำนวนที่ถูกหัก (ETH)'), '0.0025')
      expect(screen.getByText('ได้รับจริง 0.2475 ETH')).toBeInTheDocument()
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
      expect(screen.getByText('ETH ที่ถือ').nextSibling).toHaveTextContent('0 → 0.2475')
      expect(screen.getByText(/^ต้นทุน ETH 2,666\.6667 USD ต่อหน่วย/)).toBeInTheDocument()
    })

    it('takes the fee of a transfer of coins from the units that arrive, and then asks for no money at all', async () => {
      await db.accounts.add({ id: 'acc-2', name: 'IBKR', broker: 'IBKR', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
      await db.transactions.add(makeTx({ id: 'btc-buy', instrumentId: 'CRYPTO:BTC', quantity: '1', price: '58000', fxRate: '34', date: '2024-01-15' }))
      const user = userEvent.setup()
      const router = renderRoute('/transactions/new', provider())
      await user.selectOptions(await screen.findByLabelText('ประเภทอื่นๆ'), 'โอนระหว่างบัญชี')
      await user.selectOptions(screen.getByLabelText('ตลาด'), 'คริปโต')
      expect(optionsOf('จ่ายเป็น')).toEqual(['เงินสด', 'หักจากที่ได้รับ'])
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'btc')
      await user.type(screen.getByLabelText('จำนวนหน่วยที่โอน'), '0.4')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
      expect(screen.getByLabelText('สกุลเงินของค่าธรรมเนียม')).toHaveValue('USD')
      await user.selectOptions(screen.getByLabelText('จ่ายเป็น'), 'หักจากที่ได้รับ')
      await user.type(screen.getByLabelText('จำนวนที่ถูกหัก (BTC)'), '0.1')
      expect(screen.getByText('ได้รับจริง 0.3 BTC')).toBeInTheDocument()
      expect(screen.queryByLabelText('สกุลเงินของค่าธรรมเนียม')).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/เรทแลกเปลี่ยน/)).not.toBeInTheDocument()
      expect(screen.getByText('BTC · IBKR').nextSibling).toHaveTextContent('0 → 0.3')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      expect((await db.transactions.toArray()).find((t) => t.type === 'transfer')).toMatchObject({
        instrumentId: 'CRYPTO:BTC',
        quantity: '0.4',
        feePaidIn: 'received',
        feeQuantity: '0.1',
        fees: '0',
        currency: 'THB',
        fxRate: '1',
        fxSource: 'same',
      })
    })

    it('leaves the currency and the rate alone while the fee comes from the units, and shows them again when it goes back to cash', async () => {
      await db.accounts.add({ id: 'acc-2', name: 'IBKR', broker: 'IBKR', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
      const user = userEvent.setup()
      renderRoute('/transactions/new', provider())
      await user.selectOptions(await screen.findByLabelText('ประเภทอื่นๆ'), 'โอนระหว่างบัญชี')
      await user.selectOptions(screen.getByLabelText('ตลาด'), 'คริปโต')
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'btc')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
      await user.selectOptions(screen.getByLabelText('จ่ายเป็น'), 'หักจากที่ได้รับ')
      expect(screen.queryByLabelText(/เรทแลกเปลี่ยน/)).not.toBeInTheDocument()
      await user.selectOptions(screen.getByLabelText('จ่ายเป็น'), 'เงินสด')
      expect(screen.getByLabelText('สกุลเงินของค่าธรรมเนียม')).toHaveValue('USD')
      expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35')
    })

    it('turns into a buy in the currency of the coin, with its rate, when the type changes while the fee comes from the units', async () => {
      await db.accounts.add({ id: 'acc-2', name: 'IBKR', broker: 'IBKR', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
      const user = userEvent.setup()
      const router = renderRoute('/transactions/new', provider())
      await user.selectOptions(await screen.findByLabelText('ประเภทอื่นๆ'), 'โอนระหว่างบัญชี')
      await user.selectOptions(screen.getByLabelText('ตลาด'), 'คริปโต')
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'btc')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
      await user.selectOptions(screen.getByLabelText('จ่ายเป็น'), 'หักจากที่ได้รับ')
      expect(screen.queryByLabelText(/เรทแลกเปลี่ยน/)).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'ซื้อ' }))
      expect(screen.getByLabelText('สกุลเงิน')).toHaveValue('USD')
      expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35')
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '1')
      await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '58000')
      await user.clear(screen.getByLabelText('จำนวนที่ถูกหัก (BTC)'))
      await user.type(screen.getByLabelText('จำนวนที่ถูกหัก (BTC)'), '0.001')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      expect((await db.transactions.toArray())[0]).toMatchObject({ type: 'buy', currency: 'USD', fxRate: '35', fxSource: 'auto' })
    })

    it('keeps the currency and the rate when the transfer of coins turns into a transfer of cash', async () => {
      await db.accounts.add({ id: 'acc-2', name: 'IBKR', broker: 'IBKR', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
      const user = userEvent.setup()
      renderRoute('/transactions/new', provider())
      await user.selectOptions(await screen.findByLabelText('ประเภทอื่นๆ'), 'โอนระหว่างบัญชี')
      await user.selectOptions(screen.getByLabelText('ตลาด'), 'คริปโต')
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'btc')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
      await user.selectOptions(screen.getByLabelText('จ่ายเป็น'), 'หักจากที่ได้รับ')
      await user.click(screen.getByRole('button', { name: 'เงินสด' }))
      expect(screen.getByLabelText('สกุลเงิน')).toHaveValue('USD')
      expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35')
    })

    it('opens a saved transfer of VOO with 0.1 taken from the units, saves it in baht with no rate and shows no money fields', async () => {
      await db.accounts.add({ id: 'acc-2', name: 'IBKR', broker: 'IBKR', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
      await db.transactions.bulkAdd([
        makeTx({ id: 'voo-buy', instrumentId: 'US:VOO', quantity: '10', price: '400', fxRate: '35', date: '2024-01-10' }),
        makeTx({ id: 'voo-move', type: 'transfer', instrumentId: 'US:VOO', toAccountId: 'acc-2', quantity: '4', price: undefined, fxRate: '35', date: '2024-01-20', feePaidIn: 'received', feeQuantity: '0.1' }),
      ])
      const user = userEvent.setup()
      const router = renderRoute('/transactions/voo-move', provider())
      expect(await screen.findByLabelText('จ่ายเป็น')).toHaveDisplayValue('หักจากที่ได้รับ')
      expect(screen.getByLabelText('จำนวนที่ถูกหัก (VOO)')).toHaveValue('0.1')
      expect(screen.queryByLabelText('สกุลเงินของค่าธรรมเนียม')).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/เรทแลกเปลี่ยน/)).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      expect(await db.transactions.get('voo-move')).toMatchObject({
        feePaidIn: 'received',
        feeQuantity: '0.1',
        fees: '0',
        currency: 'THB',
        fxSource: 'same',
        fxRate: '1',
      })
    })

    it('has no way to pay a cash transfer in anything but cash', async () => {
      await db.accounts.add({ id: 'acc-2', name: 'IBKR', broker: 'IBKR', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
      const user = userEvent.setup()
      renderRoute('/transactions/new', provider())
      await user.selectOptions(await screen.findByLabelText('ประเภทอื่นๆ'), 'โอนระหว่างบัญชี')
      await user.click(screen.getByRole('button', { name: 'เงินสด' }))
      expect(screen.queryByLabelText('จ่ายเป็น')).not.toBeInTheDocument()
      expect(screen.getByLabelText('ค่าธรรมเนียมการโอน')).toBeInTheDocument()
    })

    it('keeps the way of paying and the fee asset for the next entry, and empties the units', async () => {
      const { user } = await openEthBuy()
      await user.selectOptions(screen.getByLabelText('จ่ายเป็น'), 'สินทรัพย์อื่น')
      await user.type(screen.getByLabelText('สินทรัพย์ที่ใช้จ่าย'), 'bnb')
      await user.type(screen.getByLabelText('จำนวน'), '0.001')
      await user.type(screen.getByLabelText('มูลค่าค่าธรรมเนียม (USD)'), '0.6')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
      await user.click(screen.getByRole('button', { name: 'บันทึกแล้วเพิ่มอีก' }))
      expect(await screen.findByRole('status')).toHaveTextContent('บันทึกแล้ว')
      expect(screen.getByLabelText('จ่ายเป็น')).toHaveDisplayValue('สินทรัพย์อื่น')
      expect(screen.getByLabelText('สินทรัพย์ที่ใช้จ่าย')).toHaveValue('bnb')
      expect(screen.getByLabelText('จำนวน')).toHaveValue('')
      expect(screen.getByLabelText('มูลค่าค่าธรรมเนียม (USD)')).toHaveValue('')
    })

    it('opens a saved fee paid in an asset', async () => {
      await db.transactions.bulkAdd([
        heldBnb(),
        makeTx({ id: 'paid', instrumentId: 'CRYPTO:ETH', quantity: '1', price: '2000', fxRate: '34', date: '2024-01-11', feePaidIn: 'asset', feeInstrumentId: 'CRYPTO:BNB', feeQuantity: '0.001', fees: '0.6' }),
      ])
      renderRoute('/transactions/paid', provider())
      expect(await screen.findByLabelText('จ่ายเป็น')).toHaveDisplayValue('สินทรัพย์อื่น')
      expect(screen.getByLabelText('สินทรัพย์ที่ใช้จ่าย')).toHaveValue('BNB')
      expect(screen.getByLabelText('จำนวน')).toHaveValue('0.001')
      expect(screen.getByLabelText('มูลค่าค่าธรรมเนียม (USD)')).toHaveValue('0.6')
      expect(await screen.findByText('BNB ที่ถือ')).toBeInTheDocument()
    })

    it('opens a saved fee taken from the coins received', async () => {
      await db.transactions.add(
        makeTx({ id: 'taken', instrumentId: 'CRYPTO:ETH', quantity: '1', price: '2000', fxRate: '34', date: '2024-01-12', feePaidIn: 'received', feeQuantity: '0.002' }),
      )
      renderRoute('/transactions/taken', provider())
      expect(await screen.findByLabelText('จ่ายเป็น')).toHaveDisplayValue('หักจากที่ได้รับ')
      expect(screen.getByLabelText('จำนวนที่ถูกหัก (ETH)')).toHaveValue('0.002')
      expect(screen.getByText('ได้รับจริง 0.998 ETH')).toBeInTheDocument()
    })

    it('shows the fields and what arrives on a phone too', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
      const { user } = await openEthBuy()
      await user.selectOptions(screen.getByLabelText('จ่ายเป็น'), 'หักจากที่ได้รับ')
      await user.type(screen.getByLabelText('จำนวนที่ถูกหัก (ETH)'), '0.001')
      expect(screen.getByText('ได้รับจริง 0.999 ETH')).toBeInTheDocument()
    })
  })

  describe('fees from the account formula', () => {
    const streaming = {
      id: 'acc-2',
      name: 'Streaming SET',
      broker: 'Streaming',
      note: '',
      createdAt: '2024-01-01T00:00:00.000Z',
      feeTemplate: { currency: 'THB', commissionPct: '0.157', minimum: '50', vatPct: '7', perOrder: '0' },
    }
    const summary = 'THB · 0.157% + VAT 7% · ขั้นต่ำ 50 บาท'
    const provider = () => fakeFxProvider({ 'USD|THB': '35' }).provider
    const autoHint = () => screen.getByText(/^คำนวณจากสูตรของ Streaming SET/)

    async function openSetBuy() {
      await db.accounts.add(streaming)
      const user = userEvent.setup()
      const router = renderRoute('/transactions/new', provider())
      await user.selectOptions(await screen.findByLabelText('บัญชี'), 'Streaming SET')
      await user.selectOptions(screen.getByLabelText('ตลาด'), 'ไทย (SET)')
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'PTT')
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '100')
      await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '35')
      return { user, router }
    }

    it('masks the fee from the formula on the link back to it, and still puts the real fee in the field', async () => {
      await saveSettings(db, { baseCurrency: 'THB', hideNumbersOnLaunch: true })
      const { user } = await openSetBuy()
      const fee = screen.getByLabelText('ค่าธรรมเนียม')
      await waitFor(() => expect(fee).toHaveValue('53.50'))
      await user.clear(fee)
      await user.type(fee, '60')
      expect(screen.queryByRole('button', { name: /53\.50/ })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'ใช้สูตรของบัญชี (•••)' }))
      expect(fee).toHaveValue('53.50')
    })

    it('fills the fee from the account formula and lets the user put it back after typing', async () => {
      const { user } = await openSetBuy()
      const fee = screen.getByLabelText('ค่าธรรมเนียม')
      expect(fee).toHaveValue('53.50')
      expect(autoHint()).toHaveTextContent(`คำนวณจากสูตรของ Streaming SET · ${summary}`)
      await user.clear(fee)
      await user.type(fee, '60')
      expect(screen.queryByText(/คำนวณจากสูตรของ/)).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'ใช้สูตรของบัญชี (53.50)' }))
      expect(fee).toHaveValue('53.50')
      expect(autoHint()).toHaveTextContent(`คำนวณจากสูตรของ Streaming SET · ${summary}`)
    })

    it('follows the order until a fee is typed, and keeps the typed one', async () => {
      const { user } = await openSetBuy()
      const fee = screen.getByLabelText('ค่าธรรมเนียม')
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '0')
      expect(fee).toHaveValue('58.80')
      await user.type(fee, '1')
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '0')
      expect(fee).toHaveValue('58.801')
    })

    it('saves the fee that was filled in', async () => {
      const { user, router } = await openSetBuy()
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      expect((await db.transactions.toArray())[0]).toMatchObject({ instrumentId: 'SET:PTT', accountId: 'acc-2', fees: '53.5' })
    })

    it('goes back to filling the fee for the next entry after save and add another', async () => {
      const { user } = await openSetBuy()
      await user.clear(screen.getByLabelText('ค่าธรรมเนียม'))
      await user.type(screen.getByLabelText('ค่าธรรมเนียม'), '60')
      await user.click(screen.getByRole('button', { name: 'บันทึกแล้วเพิ่มอีก' }))
      expect(await screen.findByRole('status')).toHaveTextContent('บันทึกแล้ว')
      expect(screen.getByLabelText('ค่าธรรมเนียม')).toHaveValue('')
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'AOT')
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '100')
      await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '35')
      expect(screen.getByLabelText('ค่าธรรมเนียม')).toHaveValue('53.50')
    })

    it('does not fill over a transaction that is opened for editing', async () => {
      await db.accounts.add(streaming)
      await db.transactions.add(
        makeTx({
          id: 'set-1',
          accountId: 'acc-2',
          instrumentId: 'SET:PTT',
          quantity: '100',
          price: '35',
          currency: 'THB',
          fees: '10',
          fxRate: '1',
          fxSource: 'same',
        }),
      )
      const user = userEvent.setup()
      renderRoute('/transactions/set-1', provider())
      const fee = await screen.findByLabelText('ค่าธรรมเนียม')
      expect(fee).toHaveValue('10')
      expect(screen.getByRole('button', { name: 'ใช้สูตรของบัญชี (53.50)' })).toBeInTheDocument()
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '0')
      expect(fee).toHaveValue('10')
    })

    it('says so when the formula is in another currency, and leaves the fee empty', async () => {
      const { user } = await openSetBuy()
      await user.selectOptions(screen.getByLabelText('ตลาด'), 'สหรัฐ (US)')
      expect(screen.getByLabelText('ค่าธรรมเนียม')).toHaveValue('')
      expect(screen.getByText('สูตรของ Streaming SET ใช้กับรายการสกุล THB')).toBeInTheDocument()
    })

    it('gives the hint a full-width line of its own on a phone, and the column it was in from sm up', async () => {
      await openSetBuy()
      const hint = autoHint()
      expect(hint).toHaveClass('col-span-2', 'sm:col-span-1', 'sm:row-start-2', 'sm:col-start-1', 'sm:-mt-2')
      expect(hint.tagName).toBe('P')
      expect(screen.getByLabelText('ค่าธรรมเนียม').parentElement).not.toContainElement(hint)
      expect(hint.parentElement).toContainElement(screen.getByLabelText('ภาษี / VAT'))
      expect(hint.previousElementSibling).toContainElement(screen.getByLabelText('ภาษี / VAT'))
      expect(within(hint).getByText('· ขั้นต่ำ 50 บาท')).toHaveClass('whitespace-nowrap')
    })

    it('puts the hint under the fee when the way of paying comes before it', async () => {
      await db.accounts.add(streaming)
      const user = userEvent.setup()
      renderRoute('/transactions/new', provider())
      await user.selectOptions(await screen.findByLabelText('บัญชี'), 'Streaming SET')
      await user.selectOptions(screen.getByLabelText('ตลาด'), 'คริปโต')
      await user.selectOptions(screen.getByLabelText('สกุลเงิน'), 'THB')
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'btc')
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '1')
      await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '3500')
      expect(screen.getByLabelText('ค่าธรรมเนียม')).toHaveValue('53.50')
      expect(autoHint()).toHaveClass('col-span-2', 'sm:col-start-2', 'sm:row-start-2')
      expect(autoHint()).not.toHaveClass('sm:col-start-1')
    })

    it('gives the note about another currency the same full-width line', async () => {
      const { user } = await openSetBuy()
      await user.selectOptions(screen.getByLabelText('ตลาด'), 'สหรัฐ (US)')
      const note = screen.getByText('สูตรของ Streaming SET ใช้กับรายการสกุล THB')
      expect(note).toHaveClass('col-span-2', 'sm:col-span-1')
      expect(screen.getByLabelText('ค่าธรรมเนียม').parentElement).not.toContainElement(note)
    })

    it('says nothing about a formula for an account without one', async () => {
      const user = userEvent.setup()
      renderRoute('/transactions/new', provider())
      await user.type(await screen.findByLabelText('สัญลักษณ์'), 'AAPL')
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '10')
      await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '100')
      expect(screen.getByLabelText('ค่าธรรมเนียม')).toHaveValue('')
      expect(screen.queryByText(/สูตรของ/)).not.toBeInTheDocument()
    })

    it('gives the way back to the formula a phone-sized target', async () => {
      const { user } = await openSetBuy()
      await user.type(screen.getByLabelText('ค่าธรรมเนียม'), '1')
      expect(screen.getByRole('button', { name: 'ใช้สูตรของบัญชี (53.50)' })).toHaveClass(
        'inline-flex',
        'min-h-11',
        'items-center',
        'text-left',
        'md:min-h-0',
      )
    })
  })

  describe('repeating a transaction and reinvesting a dividend', () => {
    const provider = () => fakeFxProvider({ 'USD|THB': '34' }).provider
    const phone = () =>
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    const earlierBuy = () =>
      makeTx({ id: 'aapl-buy', instrumentId: 'US:AAPL', quantity: '2', price: '512.3', fees: '1', fxRate: '33.8', date: '2024-03-10', note: 'monthly' })

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(2024, 5, 1, 9, 0))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    async function openDividend(path = '/transactions/new') {
      const user = userEvent.setup()
      const router = renderRoute(path, provider())
      await user.click(await screen.findByRole('button', { name: 'ปันผล' }))
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'VOO')
      await user.type(screen.getByLabelText('ปันผลก่อนหักภาษี'), '10')
      await user.type(screen.getByLabelText('ภาษีหัก ณ ที่จ่าย'), '1.5')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('34'))
      return { user, router }
    }

    const tick = () => screen.getByRole('checkbox', { name: 'นำปันผลไปซื้อหุ้นนี้ต่อ (บันทึก 2 รายการ)' })

    async function fillReinvest(user: ReturnType<typeof userEvent.setup>) {
      await user.click(tick())
      await user.type(screen.getByLabelText('จำนวนหน่วยที่ซื้อ'), '0.016')
      await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '500')
    }

    const reinvestSummary = () => screen.getByText(/^ซื้อ 0\.016 × 500\.00/)

    it('opens a copy of an earlier buy for today', async () => {
      await db.transactions.add(earlierBuy())
      renderRoute('/transactions/new?from=aapl-buy', provider())
      expect(await screen.findByLabelText('สัญลักษณ์')).toHaveValue('AAPL')
      expect(screen.getByLabelText('จำนวนหน่วย')).toHaveValue('2')
      expect(screen.getByLabelText('ค่าธรรมเนียม')).toHaveValue('1')
      expect(screen.getByLabelText('ราคาต่อหน่วย')).toHaveValue('')
      expect(screen.getByLabelText('วันที่')).toHaveValue('2024-06-01')
      expect(screen.getByLabelText('หมายเหตุ')).toHaveValue('monthly')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('34'))
      expect(screen.getByText('ทำซ้ำจากรายการวันที่ 10 มี.ค. 2024')).toBeInTheDocument()
    })

    it('saves the copy as a new transaction and leaves the first one alone', async () => {
      await db.transactions.add(earlierBuy())
      const user = userEvent.setup()
      const router = renderRoute('/transactions/new?from=aapl-buy', provider())
      await user.type(await screen.findByLabelText('ราคาต่อหน่วย'), '520')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('34'))
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      const saved = await db.transactions.toArray()
      expect(saved).toHaveLength(2)
      expect(saved.find((t) => t.id === 'aapl-buy')).toMatchObject({ date: '2024-03-10', price: '512.3', fxRate: '33.8' })
      expect(saved.find((t) => t.id !== 'aapl-buy')).toMatchObject({
        instrumentId: 'US:AAPL',
        quantity: '2',
        price: '520',
        fees: '1',
        date: '2024-06-01',
        fxRate: '34',
        fxSource: 'auto',
      })
    })

    it('drops the line about the original once the next entry starts', async () => {
      await db.transactions.add(earlierBuy())
      const user = userEvent.setup()
      renderRoute('/transactions/new?from=aapl-buy', provider())
      await user.type(await screen.findByLabelText('ราคาต่อหน่วย'), '520')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('34'))
      await user.click(screen.getByRole('button', { name: 'บันทึกแล้วเพิ่มอีก' }))
      expect(await screen.findByRole('status')).toHaveTextContent('บันทึกแล้ว')
      expect(screen.queryByText(/ทำซ้ำจากรายการวันที่/)).not.toBeInTheDocument()
    })

    it('opens an empty form when the transaction to copy is not there', async () => {
      renderRoute('/transactions/new?from=gone', provider())
      expect(await screen.findByLabelText('สัญลักษณ์')).toHaveValue('')
      expect(screen.queryByText(/ทำซ้ำจากรายการวันที่/)).not.toBeInTheDocument()
    })

    it('links to a copy from the edit page', async () => {
      await db.transactions.add(earlierBuy())
      renderRoute('/transactions/aapl-buy', provider())
      expect(await screen.findByRole('link', { name: 'ทำซ้ำ' })).toHaveAttribute('href', '/transactions/new?from=aapl-buy')
    })

    it('does not offer a copy while a new transaction is being written', async () => {
      renderRoute('/transactions/new', provider())
      await screen.findByLabelText('สัญลักษณ์')
      expect(screen.queryByRole('link', { name: 'ทำซ้ำ' })).not.toBeInTheDocument()
    })

    it('records a dividend and the buy it paid for in one go', async () => {
      const { user, router } = await openDividend()
      await fillReinvest(user)
      expect(reinvestSummary().textContent).toBe('ซื้อ 0.016 × 500.00 = 8.00 USD · เหลือเงินสด 0.50 USD')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      const saved = await db.transactions.toArray()
      expect(saved).toHaveLength(2)
      const dividend = saved.find((t) => t.type === 'dividend')!
      const buy = saved.find((t) => t.type === 'buy')!
      expect(dividend).toMatchObject({ instrumentId: 'US:VOO', amount: '10', tax: '1.5', date: '2024-06-01', fxRate: '34' })
      expect(buy).toMatchObject({
        instrumentId: 'US:VOO',
        quantity: '0.016',
        price: '500',
        fees: '0',
        tax: '0',
        date: '2024-06-01',
        currency: 'USD',
        fxRate: '34',
        fxSource: 'auto',
        accountId: dividend.accountId,
      })
      expect(new Date(buy.createdAt).getTime() - new Date(dividend.createdAt).getTime()).toBe(1)
      expect(await db.instruments.get('US:VOO')).toMatchObject({ symbol: 'VOO', currency: 'USD' })
    })

    it('only offers the choice for a new dividend that names an asset', async () => {
      const user = userEvent.setup()
      renderRoute('/transactions/new', provider())
      await screen.findByLabelText('สัญลักษณ์')
      expect(screen.queryByRole('checkbox', { name: /นำปันผลไปซื้อ/ })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'ปันผล' }))
      expect(screen.queryByRole('checkbox', { name: /นำปันผลไปซื้อ/ })).not.toBeInTheDocument()
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'VOO')
      expect(tick()).not.toBeChecked()
      expect(screen.queryByLabelText('จำนวนหน่วยที่ซื้อ')).not.toBeInTheDocument()
      await user.click(tick())
      expect(screen.getByLabelText('จำนวนหน่วยที่ซื้อ')).toBeInTheDocument()
      expect(screen.getByLabelText('ค่าธรรมเนียมซื้อ')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'ดอกเบี้ย/คูปอง' }))
      expect(screen.queryByRole('checkbox', { name: /นำปันผลไปซื้อ/ })).not.toBeInTheDocument()
    })

    it('does not offer the choice when a saved dividend is edited', async () => {
      await db.transactions.add(
        makeTx({ id: 'voo-div', type: 'dividend', instrumentId: 'US:VOO', quantity: undefined, price: undefined, amount: '10', tax: '1.5', fxRate: '34' }),
      )
      renderRoute('/transactions/voo-div', provider())
      expect(await screen.findByLabelText('ปันผลก่อนหักภาษี')).toHaveValue('10')
      expect(screen.queryByRole('checkbox', { name: /นำปันผลไปซื้อ/ })).not.toBeInTheDocument()
    })

    it('saves only the buy when the type is changed after the choice was ticked', async () => {
      const { user, router } = await openDividend()
      await fillReinvest(user)
      await user.click(screen.getByRole('button', { name: 'ซื้อ' }))
      expect(screen.queryByLabelText('จำนวนหน่วยที่ซื้อ')).not.toBeInTheDocument()
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '1')
      await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '500')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      expect(await db.transactions.toArray()).toMatchObject([{ type: 'buy', quantity: '1' }])
    })

    it('asks for the missing parts of the buy and saves neither transaction', async () => {
      const { user } = await openDividend()
      await user.click(tick())
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      expect(await screen.findByText('จำนวนหน่วยต้องเป็นตัวเลขมากกว่า 0')).toBeInTheDocument()
      expect(screen.getByText('ราคาต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป')).toBeInTheDocument()
      expect(await db.transactions.count()).toBe(0)
    })

    it('says a mistake shared by both transactions once', async () => {
      const { user } = await openDividend()
      await fillReinvest(user)
      fireEvent.change(screen.getByLabelText(/เรทแลกเปลี่ยน/), { target: { value: '' } })
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      expect(await screen.findAllByText('เรทแลกเปลี่ยนต้องเป็นตัวเลขมากกว่า 0')).toHaveLength(1)
      expect(await db.transactions.count()).toBe(0)
    })

    it('stops when the buy does not fit what is held, even though the dividend does', async () => {
      await db.transactions.add(
        makeTx({ instrumentId: 'US:VOO', currency: 'THB', fxRate: '1', fxSource: 'same', quantity: '1', price: '15000', date: '2024-01-10' }),
      )
      const { user } = await openDividend()
      await fillReinvest(user)
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      expect(await screen.findByText('สกุลเงิน USD ไม่ตรงกับที่ถืออยู่ (THB)')).toBeInTheDocument()
      expect(await db.transactions.count()).toBe(1)
    })

    it('says so and keeps the form when saving the pair fails', async () => {
      vi.spyOn(db.transactions, 'put').mockRejectedValueOnce(new Error('QuotaExceededError'))
      const { user, router } = await openDividend()
      await fillReinvest(user)
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      expect(await screen.findByText('บันทึกไม่สำเร็จ ข้อมูลยังไม่ถูกบันทึก ลองอีกครั้ง')).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/transactions/new')
      expect(await db.transactions.count()).toBe(0)
      expect(tick()).toBeChecked()
    })

    it('tells what was saved, and starts the next entry without the choice', async () => {
      const { user } = await openDividend()
      await fillReinvest(user)
      await user.click(screen.getByRole('button', { name: 'บันทึกแล้วเพิ่มอีก' }))
      expect(await screen.findByRole('status')).toHaveTextContent('บันทึกแล้ว · ปันผล + ซื้อ VOO')
      expect(await db.transactions.count()).toBe(2)
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'VTI')
      expect(tick()).not.toBeChecked()
      expect(screen.queryByLabelText('จำนวนหน่วยที่ซื้อ')).not.toBeInTheDocument()
    })

    it('shows the holding and the cash after both transactions', async () => {
      await db.transactions.add(
        makeTx({ type: 'deposit', instrumentId: undefined, quantity: undefined, price: undefined, amount: '100', date: '2024-01-02' }),
      )
      const { user } = await openDividend()
      await fillReinvest(user)
      expect(screen.getByText('VOO ที่ถือ').nextSibling).toHaveTextContent('0 → 0.016')
      expect(screen.getByText('เงินสด USD').nextSibling).toHaveTextContent('100.00 → 100.50')
    })

    it('adds the fee of the buy to what is spent, and says when more cash is needed than the dividend left', async () => {
      const { user } = await openDividend()
      await fillReinvest(user)
      await user.type(screen.getByLabelText('ค่าธรรมเนียมซื้อ'), '1')
      expect(reinvestSummary().textContent).toBe('ซื้อ 0.016 × 500.00 = 8.00 USD + ค่าธรรมเนียม 1.00 USD · ใช้เงินสดเพิ่ม 0.50 USD')
      expect(within(reinvestSummary()).getByText(/ใช้เงินสดเพิ่ม/)).toHaveClass('whitespace-nowrap')
    })

    it('keeps the cash left after the buy in one piece when the summary wraps', async () => {
      const { user } = await openDividend()
      await fillReinvest(user)
      const tail = within(reinvestSummary()).getByText(/เหลือเงินสด/)
      expect(tail).toHaveTextContent(/^· เหลือเงินสด 0\.50 USD$/)
      expect(tail).toHaveClass('whitespace-nowrap')
      expect(reinvestSummary()).not.toBe(tail)
    })

    it('puts the fee of the buy under the quantity and price on a phone, and in the same row from sm up', async () => {
      const { user } = await openDividend()
      await user.click(tick())
      const row = screen.getByLabelText('จำนวนหน่วยที่ซื้อ').closest('[class*="grid-cols"]')!
      expect(row).toHaveClass('grid-cols-2', 'sm:grid-cols-3')
      expect(row).toContainElement(screen.getByLabelText('ราคาต่อหน่วย'))
      expect(screen.getByLabelText('ค่าธรรมเนียมซื้อ').parentElement).toHaveClass('col-span-2', 'sm:col-span-1')
      expect(screen.getByLabelText('จำนวนหน่วยที่ซื้อ').parentElement).not.toHaveClass('col-span-2')
    })

    it('keeps the tick boxes at their size beside a long label', async () => {
      const { user } = await openDividend()
      expect(tick()).toHaveClass('size-5', 'shrink-0')
      await user.click(screen.getByRole('button', { name: 'ถอนเงิน' }))
      expect(screen.getByRole('checkbox', { name: /โอนกลับเข้าไทย/ })).toHaveClass('size-5', 'shrink-0')
    })

    it('shows the choice and its summary on a phone too', async () => {
      phone()
      const { user } = await openDividend()
      await fillReinvest(user)
      expect(reinvestSummary().textContent).toBe('ซื้อ 0.016 × 500.00 = 8.00 USD · เหลือเงินสด 0.50 USD')
      expect(tick().closest('label')).toHaveClass('min-h-11')
    })
  })

  describe('a coin held in another currency than the one stored for it', () => {
    const eth = { id: 'CRYPTO:ETH', market: 'CRYPTO', symbol: 'ETH', name: 'Ethereum', assetType: 'crypto', currency: 'THB' } as const

    beforeEach(async () => {
      await db.instruments.add(eth)
      await db.accounts.add({ id: 'acc-2', name: 'Bitkub', broker: 'Bitkub', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
    })

    it('opens in the currency the account holds it in', async () => {
      await db.transactions.add(makeTx({ instrumentId: 'CRYPTO:ETH', currency: 'USD', quantity: '1', price: '2000', fxRate: '35', date: '2024-01-10' }))
      const user = userEvent.setup()
      renderRoute('/transactions/new', fakeFxProvider({ 'USD|THB': '35' }).provider)
      await user.selectOptions(await screen.findByLabelText('บัญชี'), 'Dime US')
      await user.selectOptions(screen.getByLabelText('ตลาด'), 'CRYPTO')
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'eth')
      expect(screen.getByLabelText('สกุลเงิน')).toHaveValue('USD')
    })

    it('opens in the stored currency in an account that does not hold it', async () => {
      await db.transactions.add(makeTx({ instrumentId: 'CRYPTO:ETH', currency: 'USD', quantity: '1', price: '2000', fxRate: '35', date: '2024-01-10' }))
      const user = userEvent.setup()
      renderRoute('/transactions/new', fakeFxProvider({ 'USD|THB': '35' }).provider)
      await user.selectOptions(await screen.findByLabelText('บัญชี'), 'Bitkub')
      await user.selectOptions(screen.getByLabelText('ตลาด'), 'CRYPTO')
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'eth')
      expect(screen.getByLabelText('สกุลเงิน')).toHaveValue('THB')
    })
  })

  describe('the trade journal', () => {
    const provider = () => fakeFxProvider({ 'USD|THB': '35' }).provider
    const toggle = () => screen.getByRole('button', { name: 'บันทึกการเทรด (ไม่บังคับ)' })
    const group = (name: string) => screen.getByRole('group', { name })
    const pick = (name: string, option: string) => within(group(name)).getByRole('button', { name: option })
    const strategies = () => Array.from(document.querySelectorAll<HTMLOptionElement>('datalist#trade-strategies option')).map((o) => o.value)

    async function fillBuy(user: ReturnType<typeof userEvent.setup>) {
      await user.type(await screen.findByLabelText('สัญลักษณ์'), 'aapl')
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '2')
      await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '100')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
    }

    async function openBuy() {
      const user = userEvent.setup()
      const router = renderRoute('/transactions/new', provider())
      await fillBuy(user)
      return { user, router }
    }

    it('records a trade journal on a buy', async () => {
      const { user, router } = await openBuy()
      expect(toggle()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByLabelText('กลยุทธ์')).not.toBeInTheDocument()
      await user.click(toggle())
      expect(toggle()).toHaveAttribute('aria-expanded', 'true')
      await user.type(screen.getByLabelText('กลยุทธ์'), 'Breakout')
      await user.click(pick('อารมณ์ตอนเข้า', 'FOMO'))
      await user.click(pick('ความมั่นใจ', '4'))
      await user.type(screen.getByLabelText('Stop loss'), '95')
      await user.type(screen.getByLabelText('Target'), '130')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      const [saved] = await db.transactions.toArray()
      expect(saved.journal).toEqual({ strategy: 'Breakout', emotion: 'fomo', confidence: 4, stopLoss: '95', target: '130' })
    })

    it('saves tags, the reason and the price of a stop loss written the way the other prices are', async () => {
      const { user, router } = await openBuy()
      await user.click(toggle())
      await user.type(screen.getByLabelText('แท็ก'), 'earnings, gap ,')
      await user.type(screen.getByLabelText('เหตุผลที่เข้า'), 'new high on volume')
      await user.type(screen.getByLabelText('Stop loss'), '1,095.50')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      const [saved] = await db.transactions.toArray()
      expect(saved.journal).toEqual({ tags: ['earnings', 'gap'], reason: 'new high on volume', stopLoss: '1095.5' })
    })

    it('saves no journal when the section was opened and nothing was written', async () => {
      const { user, router } = await openBuy()
      await user.click(toggle())
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      const [saved] = await db.transactions.toArray()
      expect(saved.journal).toBeUndefined()
    })

    it('refuses a stop loss that is not a number and saves nothing', async () => {
      const { user } = await openBuy()
      await user.click(toggle())
      await user.type(screen.getByLabelText('Stop loss'), 'abc')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      expect(await screen.findByText('Stop loss ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป')).toBeInTheDocument()
      expect(await db.transactions.count()).toBe(0)
    })

    it('folds back up without losing what was written', async () => {
      const { user } = await openBuy()
      await user.click(toggle())
      await user.type(screen.getByLabelText('กลยุทธ์'), 'Breakout')
      await user.click(toggle())
      expect(toggle()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByLabelText('กลยุทธ์')).not.toBeInTheDocument()
      await user.click(toggle())
      expect(screen.getByLabelText('กลยุทธ์')).toHaveValue('Breakout')
    })

    it('sits after the exchange rate and before the note, as in the mock', async () => {
      await openBuy()
      const follows = (a: HTMLElement, b: HTMLElement) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
      expect(follows(screen.getByLabelText('ภาษี / VAT'), screen.getByLabelText(/เรทแลกเปลี่ยน/))).toBe(true)
      expect(follows(screen.getByLabelText(/เรทแลกเปลี่ยน/), toggle())).toBe(true)
      expect(follows(toggle(), screen.getByLabelText('หมายเหตุ'))).toBe(true)
    })

    it('asks for the review, the mistakes and the score on a sell and not on a buy', async () => {
      const user = userEvent.setup()
      renderRoute('/transactions/new', provider())
      await user.click(await screen.findByRole('button', { name: 'บันทึกการเทรด (ไม่บังคับ)' }))
      expect(screen.getByLabelText('เหตุผลที่เข้า')).toBeInTheDocument()
      expect(screen.queryByLabelText('รีวิวหลังปิด')).not.toBeInTheDocument()
      expect(screen.queryByRole('group', { name: 'ข้อผิดพลาดที่ทำ' })).not.toBeInTheDocument()
      expect(screen.queryByRole('group', { name: 'คะแนนการลงมือ' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'ขาย' }))
      expect(screen.getByLabelText('รีวิวหลังปิด')).toBeInTheDocument()
      expect(group('ข้อผิดพลาดที่ทำ')).toBeInTheDocument()
      expect(group('คะแนนการลงมือ')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'ซื้อ' }))
      expect(screen.queryByLabelText('รีวิวหลังปิด')).not.toBeInTheDocument()
    })

    it('records the review of a sell, with any number of mistakes', async () => {
      await db.transactions.add(makeTx({ quantity: '5', date: '2024-01-15' }))
      const user = userEvent.setup()
      const router = renderRoute('/transactions/new', provider())
      await user.click(await screen.findByRole('button', { name: 'ขาย' }))
      await user.type(screen.getByLabelText('สัญลักษณ์'), 'aapl')
      await user.type(screen.getByLabelText('จำนวนหน่วย'), '2')
      await user.type(screen.getByLabelText('ราคาต่อหน่วย'), '90')
      await waitFor(() => expect(screen.getByLabelText(/เรทแลกเปลี่ยน/)).toHaveValue('35'))
      await user.click(screen.getByRole('button', { name: 'บันทึกการเทรด (ไม่บังคับ)' }))
      await user.type(screen.getByLabelText('รีวิวหลังปิด'), 'sold in a panic')
      await user.click(pick('ข้อผิดพลาดที่ทำ', 'ขายเร็วเกิน'))
      await user.click(pick('ข้อผิดพลาดที่ทำ', 'ไม่ตั้ง Stop loss'))
      await user.click(pick('ข้อผิดพลาดที่ทำ', 'ขายเร็วเกิน'))
      await user.click(pick('ข้อผิดพลาดที่ทำ', 'เลื่อน Stop loss'))
      await user.click(pick('คะแนนการลงมือ', '2'))
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      const sell = (await db.transactions.toArray()).find((t) => t.type === 'sell')
      expect(sell?.journal).toEqual({ review: 'sold in a panic', mistakes: ['no_stop', 'moved_stop'], score: 2 })
    })

    it('shows the journal only for a buy or a sell, and finds it again when the type comes back', async () => {
      const { user } = await openBuy()
      await user.click(toggle())
      await user.type(screen.getByLabelText('กลยุทธ์'), 'Breakout')
      await user.click(screen.getByRole('button', { name: 'ปันผล' }))
      expect(screen.queryByRole('button', { name: 'บันทึกการเทรด (ไม่บังคับ)' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'ซื้อ' }))
      expect(toggle()).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByLabelText('กลยุทธ์')).toHaveValue('Breakout')
      await user.selectOptions(screen.getByLabelText('ประเภทอื่นๆ'), 'opening')
      expect(screen.queryByRole('button', { name: 'บันทึกการเทรด (ไม่บังคับ)' })).not.toBeInTheDocument()
    })

    it('saves nothing of the journal in a dividend that was a buy a moment ago', async () => {
      const { user, router } = await openBuy()
      await user.click(toggle())
      await user.type(screen.getByLabelText('กลยุทธ์'), 'Breakout')
      await user.click(screen.getByRole('button', { name: 'ปันผล' }))
      await user.type(screen.getByLabelText('ปันผลก่อนหักภาษี'), '10')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      const [saved] = await db.transactions.toArray()
      expect(saved).toMatchObject({ type: 'dividend' })
      expect(saved.journal).toBeUndefined()
    })

    it('takes the emotion back by pressing it again, and picks one at a time', async () => {
      const { user } = await openBuy()
      await user.click(toggle())
      await user.click(pick('อารมณ์ตอนเข้า', 'FOMO'))
      expect(pick('อารมณ์ตอนเข้า', 'FOMO')).toHaveAttribute('aria-pressed', 'true')
      await user.click(pick('อารมณ์ตอนเข้า', 'กลัว'))
      expect(pick('อารมณ์ตอนเข้า', 'FOMO')).toHaveAttribute('aria-pressed', 'false')
      expect(pick('อารมณ์ตอนเข้า', 'กลัว')).toHaveAttribute('aria-pressed', 'true')
      await user.click(pick('อารมณ์ตอนเข้า', 'กลัว'))
      expect(within(group('อารมณ์ตอนเข้า')).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(0)
    })

    it('offers all seven emotions in the words of the list', async () => {
      const { user } = await openBuy()
      await user.click(toggle())
      expect(within(group('อารมณ์ตอนเข้า')).getAllByRole('button').map((b) => b.textContent)).toEqual([
        'นิ่ง มีแผน',
        'มั่นใจ',
        'FOMO',
        'กลัว',
        'โลภ',
        'อยากเอาคืน',
        'เบื่อ',
      ])
    })

    it('clears the confidence with its own button, which shows only while one is chosen', async () => {
      const { user } = await openBuy()
      await user.click(toggle())
      expect(screen.queryByRole('button', { name: 'ล้าง' })).not.toBeInTheDocument()
      await user.click(pick('ความมั่นใจ', '3'))
      expect(pick('ความมั่นใจ', '3')).toHaveAttribute('aria-pressed', 'true')
      const clear = screen.getByRole('button', { name: 'ล้าง' })
      expect(clear).toHaveClass('min-h-11', 'min-w-11', 'justify-center')
      expect(clear).toHaveAccessibleDescription('ความมั่นใจ')
      await user.click(clear)
      expect(pick('ความมั่นใจ', '3')).toHaveAttribute('aria-pressed', 'false')
      expect(screen.queryByRole('button', { name: 'ล้าง' })).not.toBeInTheDocument()
    })

    it('clears the score of a sell the same way, apart from the confidence', async () => {
      const { user } = await openBuy()
      await user.click(screen.getByRole('button', { name: 'ขาย' }))
      await user.click(toggle())
      await user.click(pick('ความมั่นใจ', '5'))
      await user.click(pick('คะแนนการลงมือ', '1'))
      const clears = screen.getAllByRole('button', { name: 'ล้าง' })
      expect(clears).toHaveLength(2)
      expect(clears[1]).toHaveAccessibleDescription('คะแนนการลงมือ')
      await user.click(clears[1])
      expect(pick('คะแนนการลงมือ', '1')).toHaveAttribute('aria-pressed', 'false')
      expect(pick('ความมั่นใจ', '5')).toHaveAttribute('aria-pressed', 'true')
    })

    it('offers the strategies used before, the most used first', async () => {
      const used = (strategy: string) => makeTx({ journal: { strategy } })
      await db.transactions.bulkAdd([used('Pullback'), used('Breakout'), used('Breakout'), makeTx()])
      const { user } = await openBuy()
      await user.click(toggle())
      expect(screen.getByLabelText('กลยุทธ์')).toHaveAttribute('list', 'trade-strategies')
      expect(strategies()).toEqual(['Breakout', 'Pullback'])
    })

    it('opens an edit with the journal showing and its values in place', async () => {
      await db.transactions.add(
        makeTx({
          id: 'journaled',
          journal: { strategy: 'Breakout', tags: ['earnings', 'gap'], reason: 'new high', emotion: 'fomo', confidence: 4, stopLoss: '95', target: '130' },
        }),
      )
      renderRoute('/transactions/journaled', provider())
      expect(await screen.findByLabelText('กลยุทธ์')).toHaveValue('Breakout')
      expect(toggle()).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByLabelText('แท็ก')).toHaveValue('earnings, gap')
      expect(screen.getByLabelText('เหตุผลที่เข้า')).toHaveValue('new high')
      expect(pick('อารมณ์ตอนเข้า', 'FOMO')).toHaveAttribute('aria-pressed', 'true')
      expect(pick('ความมั่นใจ', '4')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByLabelText('Stop loss')).toHaveValue('95')
      expect(screen.getByLabelText('Target')).toHaveValue('130')
    })

    it('opens an edit of a sell with its review and score in place', async () => {
      await db.transactions.add(
        makeTx({ id: 'closed', type: 'sell', journal: { review: 'too early', mistakes: ['sold_early'], score: 2 } }),
      )
      renderRoute('/transactions/closed', provider())
      expect(await screen.findByLabelText('รีวิวหลังปิด')).toHaveValue('too early')
      expect(pick('ข้อผิดพลาดที่ทำ', 'ขายเร็วเกิน')).toHaveAttribute('aria-pressed', 'true')
      expect(pick('ข้อผิดพลาดที่ทำ', 'ไล่ราคา')).toHaveAttribute('aria-pressed', 'false')
      expect(pick('คะแนนการลงมือ', '2')).toHaveAttribute('aria-pressed', 'true')
    })

    it('keeps an edit of a trade without a journal folded', async () => {
      await db.transactions.add(makeTx({ id: 'plain' }))
      renderRoute('/transactions/plain', provider())
      expect(await screen.findByLabelText('สัญลักษณ์')).toHaveValue('AAPL')
      expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    })

    it('saves an edit with the journal changed and removes it when it is emptied', async () => {
      await db.transactions.add(makeTx({ id: 'journaled', date: '2024-01-15', journal: { strategy: 'Breakout', emotion: 'fomo' } }))
      const user = userEvent.setup()
      const router = renderRoute('/transactions/journaled', provider())
      await user.clear(await screen.findByLabelText('กลยุทธ์'))
      await user.type(screen.getByLabelText('กลยุทธ์'), 'Pullback')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      expect((await db.transactions.get('journaled'))?.journal).toEqual({ strategy: 'Pullback', emotion: 'fomo' })

      await screen.findByRole('heading', { name: 'รายการทั้งหมด' })
      await act(() => router.navigate('/transactions/journaled'))
      await user.clear(await screen.findByLabelText('กลยุทธ์'))
      await user.click(pick('อารมณ์ตอนเข้า', 'FOMO'))
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
      expect((await db.transactions.get('journaled'))?.journal).toBeUndefined()
    })

    it('repeats a buy with its strategy and tags only, and shows them', async () => {
      await db.transactions.add(
        makeTx({ id: 'aapl-buy', journal: { strategy: 'DCA', tags: ['monthly'], emotion: 'calm', confidence: 3, stopLoss: '90', reason: 'plan' } }),
      )
      renderRoute('/transactions/new?from=aapl-buy', provider())
      expect(await screen.findByLabelText('กลยุทธ์')).toHaveValue('DCA')
      expect(screen.getByLabelText('แท็ก')).toHaveValue('monthly')
      expect(screen.getByLabelText('เหตุผลที่เข้า')).toHaveValue('')
      expect(screen.getByLabelText('Stop loss')).toHaveValue('')
      expect(pick('อารมณ์ตอนเข้า', 'นิ่ง มีแผน')).toHaveAttribute('aria-pressed', 'false')
      expect(pick('ความมั่นใจ', '3')).toHaveAttribute('aria-pressed', 'false')
    })

    it('keeps the strategy for the next entry after save and add another, and starts the rest over', async () => {
      const { user } = await openBuy()
      await user.click(toggle())
      await user.type(screen.getByLabelText('กลยุทธ์'), 'Breakout')
      await user.type(screen.getByLabelText('เหตุผลที่เข้า'), 'gap up')
      await user.click(pick('อารมณ์ตอนเข้า', 'FOMO'))
      await user.click(pick('ความมั่นใจ', '4'))
      await user.type(screen.getByLabelText('Stop loss'), '95')
      await user.click(screen.getByRole('button', { name: 'บันทึกแล้วเพิ่มอีก' }))
      expect(await screen.findByRole('status')).toHaveTextContent('บันทึกแล้ว')
      expect(screen.getByLabelText('กลยุทธ์')).toHaveValue('Breakout')
      expect(screen.getByLabelText('เหตุผลที่เข้า')).toHaveValue('')
      expect(screen.getByLabelText('Stop loss')).toHaveValue('')
      expect(pick('อารมณ์ตอนเข้า', 'FOMO')).toHaveAttribute('aria-pressed', 'false')
      expect(pick('ความมั่นใจ', '4')).toHaveAttribute('aria-pressed', 'false')
      expect((await db.transactions.toArray())[0].journal).toMatchObject({ strategy: 'Breakout', reason: 'gap up', emotion: 'fomo', confidence: 4, stopLoss: '95' })
    })

    it('gives the row and the buttons of the section a phone-sized touch target', async () => {
      const { user } = await openBuy()
      expect(toggle()).toHaveClass('min-h-11', 'w-full')
      await user.click(toggle())
      await user.click(pick('ความมั่นใจ', '2'))
      expect(screen.getByRole('button', { name: 'ล้าง' })).toHaveClass('min-h-11', 'min-w-11')
      expect(within(group('อารมณ์ตอนเข้า')).getAllByRole('button')[0]).toHaveClass('h-11')
    })

    it('keeps the five numbers of a scale in one row on the narrowest phone, each 44px at least', async () => {
      const { user } = await openBuy()
      await user.click(screen.getByRole('button', { name: 'ขาย' }))
      await user.click(toggle())
      for (const name of ['ความมั่นใจ', 'คะแนนการลงมือ']) {
        const scale = group(name)
        expect(scale).not.toHaveClass('max-[380px]:grid', 'max-[380px]:grid-cols-2')
        expect(scale).toHaveClass('max-[359px]:gap-0', 'max-[359px]:p-0.5')
        const numbers = within(scale).getAllByRole('button')
        expect(numbers.map((n) => n.textContent)).toEqual(['1', '2', '3', '4', '5'])
        for (const number of numbers) expect(number).toHaveClass('h-11', 'min-w-11')
      }
      expect(toggle().nextElementSibling).toHaveClass('p-3', 'min-[360px]:p-4')
    })

    it('lets a scale be as wide as its numbers on a computer, with the clear button right after it', async () => {
      const { user } = await openBuy()
      await user.click(toggle())
      await user.click(pick('ความมั่นใจ', '3'))
      const scale = group('ความมั่นใจ')
      expect(scale).toHaveClass('md:w-fit', 'md:col-start-1', 'md:row-start-2')
      expect(screen.getByRole('button', { name: 'ล้าง' })).toHaveClass('md:col-start-2', 'md:row-start-2', 'md:min-h-0', 'md:min-w-0')
      expect(scale.parentElement).toHaveClass('grid', 'md:grid-cols-[auto_1fr]')
    })

    it('stacks Stop loss over Target below 360px', async () => {
      const { user } = await openBuy()
      await user.click(toggle())
      const row = screen.getByLabelText('Stop loss').parentElement!.parentElement!
      expect(row).toHaveClass('grid', 'grid-cols-1', 'min-[360px]:grid-cols-2')
      expect(row).toContainElement(screen.getByLabelText('Target'))
    })

    it('keeps the dot of the folded hint with the word after it, so a line never ends on the dot', async () => {
      await openBuy()
      expect(toggle().textContent).toContain('·\u00a0กลยุทธ์ เหตุผล อารมณ์ Stop loss')
    })
  })

  describe('the choices of the journal, pressed before the form has drawn the last one', () => {
    const applied = (changes: ((d: Draft) => Draft)[], draft: Draft) => changes.reduce((d, change) => change(d), draft).journal

    async function openJournal(type: 'buy' | 'sell') {
      const user = userEvent.setup()
      const changes: ((d: Draft) => Draft)[] = []
      const draft = { ...emptyDraft('acc-1', '2024-06-01'), type }
      render(<TradeJournalFields draft={draft} strategies={[]} setDraft={(change) => changes.push(change)} />)
      await user.click(screen.getByRole('button', { name: 'บันทึกการเทรด (ไม่บังคับ)' }))
      return { user, changes, draft }
    }

    it('takes an emotion back when it is pressed twice, whatever the draft held when they were pressed', async () => {
      const { user, changes, draft } = await openJournal('buy')
      const fomo = screen.getByRole('button', { name: 'FOMO' })
      await user.click(fomo)
      await user.click(fomo)
      expect(applied(changes, draft).emotion).toBe('')
    })

    it('moves from one emotion to the next', async () => {
      const { user, changes, draft } = await openJournal('buy')
      await user.click(screen.getByRole('button', { name: 'FOMO' }))
      await user.click(screen.getByRole('button', { name: 'กลัว' }))
      expect(applied(changes, draft).emotion).toBe('fear')
    })

    it('adds each mistake to the ones pressed before it, and takes one away when it is pressed again', async () => {
      const { user, changes, draft } = await openJournal('sell')
      await user.click(screen.getByRole('button', { name: 'ไล่ราคา' }))
      await user.click(screen.getByRole('button', { name: 'ซื้อเกินแผน' }))
      await user.click(screen.getByRole('button', { name: 'ไล่ราคา' }))
      expect(applied(changes.slice(0, 2), draft).mistakes).toEqual(['chased', 'oversized'])
      expect(applied(changes, draft).mistakes).toEqual(['oversized'])
    })
  })
})

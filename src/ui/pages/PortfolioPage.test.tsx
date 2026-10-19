import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { fakeFxProvider, lateFxProvider } from '../../test/fakeFx'
import { makeTx } from '../../test/fixtures'
import { renderRoute, resetDb } from '../../test/render'

beforeEach(async () => {
  await resetDb()
  await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('PortfolioPage', () => {
  it('shows no value and no missing-price alert until the rates arrive', async () => {
    await db.instruments.add({ id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD', lastPrice: '120' })
    await db.transactions.add(makeTx({ quantity: '10', price: '100', fxRate: '35' }))
    const { provider, release, requested } = lateFxProvider({ 'USD|THB': '33' })
    renderRoute('/portfolio', provider)
    await waitFor(() => expect(requested()).toBeGreaterThan(0))
    expect(screen.getByText('กำลังโหลด…')).toBeInTheDocument()
    expect(screen.queryByText('มูลค่าสินทรัพย์ · ไม่รวมเงินสด')).not.toBeInTheDocument()
    expect(screen.queryByText(/ยังไม่มีราคาล่าสุด/)).not.toBeInTheDocument()

    release()
    expect(await screen.findByText('฿39,600')).toBeInTheDocument()
    expect(screen.queryByText(/ยังไม่มีราคาล่าสุด/)).not.toBeInTheDocument()
  })

  it('values a holding from the typed price with its total return including dividends', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2024, 9, 16, 9, 0))
    await db.instruments.add({ id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD' })
    await db.transactions.bulkAdd([
      makeTx({ quantity: '10', price: '100', fxRate: '35', date: '2024-01-15' }),
      makeTx({ type: 'dividend', quantity: undefined, price: undefined, amount: '10', tax: '1.5', fxRate: '34', date: '2024-02-01' }),
    ])
    const user = userEvent.setup()
    renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
    await user.type(await screen.findByLabelText('ราคาล่าสุด AAPL'), '120')
    await user.tab()
    const row = (await screen.findByText('Apple')).closest('tr')!
    expect(await within(row).findByText('+4,600')).toBeInTheDocument()
    expect(within(row).getByText('+4,889')).toBeInTheDocument()
    expect(within(row).getByText('+14.0%')).toBeInTheDocument()
    expect(within(row).getByText('0.8%')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: /AAPL/ })).toHaveAttribute('href', '/assets/US%3AAAPL')
    expect((await db.instruments.get('US:AAPL'))?.lastPrice).toBe('120')
  })

  describe('a coin held in two currencies', () => {
    beforeEach(async () => {
      await db.accounts.bulkAdd([
        { id: 'bitkub', name: 'Bitkub', broker: 'Bitkub', note: '', createdAt: '2024-01-01T00:00:00.000Z' },
        { id: 'binance', name: 'Binance', broker: 'Binance', note: '', createdAt: '2024-01-01T00:00:00.000Z' },
      ])
      await db.instruments.add({ id: 'CRYPTO:ETH', market: 'CRYPTO', symbol: 'ETH', name: 'Ethereum', assetType: 'crypto', currency: 'THB', lastPrice: '120000' })
      await db.transactions.bulkAdd([
        makeTx({ accountId: 'bitkub', instrumentId: 'CRYPTO:ETH', currency: 'THB', fxRate: '1', fxSource: 'same', quantity: '0.1', price: '110000', date: '2024-01-10' }),
        makeTx({ accountId: 'binance', instrumentId: 'CRYPTO:ETH', currency: 'USD', fxRate: '33', quantity: '0.1', price: '3300', date: '2024-02-10' }),
      ])
    })

    it('values both holdings from the one stored price instead of reading the baht price as dollars', async () => {
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      expect(await screen.findByText('฿24,000', { selector: 'p' })).toBeInTheDocument()
      const binance = screen.getByText('Binance').closest('tr')!
      expect(within(binance).getByText('12,000')).toBeInTheDocument()
      expect(within(binance).getAllByText('+1,110')).toHaveLength(2)
    })

    it('counts a holding at cost, and says its price is missing, when the currency of the stored price has no rate', async () => {
      await db.instruments.update('CRYPTO:ETH', { currency: 'VND', lastPrice: '3000000' })
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      expect(await screen.findByText(/ยังไม่มีราคาล่าสุด 1 ตัว/)).toBeInTheDocument()
      const binance = screen.getByText('Binance').closest('tr')!
      expect(within(binance).queryByText('12,000')).not.toBeInTheDocument()
      expect(within(binance).queryByText('+1,110')).not.toBeInTheDocument()
    })

    it('keeps the label of the price whole on a phone, so only the input and its badges wrap', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
      await db.instruments.update('CRYPTO:ETH', { lastPriceAt: '2020-01-01T00:00:00.000Z' })
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      const holdings = await screen.findByRole('list', { name: 'สินทรัพย์ที่ถืออยู่' })
      const [label] = await within(holdings).findAllByText('ราคาล่าสุด')
      expect(label).toHaveClass('shrink-0', 'whitespace-nowrap')
      expect(label).not.toContainElement(within(holdings).getAllByLabelText('ราคาล่าสุด ETH')[0])
    })

    it('names the baht beside the price typed for the dollar holding only, and stores what is typed as it is', async () => {
      const user = userEvent.setup()
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      await screen.findByText('฿24,000', { selector: 'p' })
      const binance = screen.getByText('Binance').closest('tr')!
      const bitkub = screen.getByText('Bitkub').closest('tr')!
      expect(within(binance).getByText('THB')).toBeInTheDocument()
      expect(within(bitkub).getAllByText('THB')).toHaveLength(1)
      const input = within(binance).getByLabelText('ราคาล่าสุด ETH')
      expect(input).toHaveValue('120000')
      await user.clear(input)
      await user.type(input, '125000{Enter}')
      await waitFor(async () => expect((await db.instruments.get('CRYPTO:ETH'))?.lastPrice).toBe('125000'))
      expect(await screen.findByText('฿25,000', { selector: 'p' })).toBeInTheDocument()
    })
  })

  it('links the asset name to its page with a phone-sized touch target that paints above the line under it', async () => {
    await db.instruments.add({ id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD' })
    await db.transactions.add(makeTx({ quantity: '10', price: '100', fxRate: '35' }))
    const user = userEvent.setup()
    renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
    const link = await screen.findByRole('link', { name: /AAPL/ })
    expect(link).toHaveAttribute('href', '/assets/US%3AAAPL')
    expect(link).toHaveClass('min-h-11', 'max-md:relative', 'max-md:z-[1]')
    expect(link).not.toHaveClass('z-10')
    await user.click(link)
    expect(await screen.findByRole('heading', { name: 'AAPL' })).toBeInTheDocument()
  })

  it('keeps the hidden header text of a table inside its scrolling wrapper', async () => {
    await db.instruments.add({ id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD' })
    await db.transactions.add(makeTx({ quantity: '10', price: '100', fxRate: '35' }))
    renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
    const table = (await screen.findByText('Apple')).closest('table')!
    expect(table.parentElement).toHaveClass('relative', 'overflow-x-auto')
  })

  it('keeps every price input of the same instrument in sync', async () => {
    await db.accounts.add({ id: 'acc-2', name: 'Dime 2', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
    await db.instruments.add({
      id: 'US:AAPL',
      market: 'US',
      symbol: 'AAPL',
      name: 'Apple',
      assetType: 'stock',
      currency: 'USD',
      lastPrice: '100',
    })
    await db.transactions.bulkAdd([
      makeTx({ accountId: 'acc-1', quantity: '10', price: '100', fxRate: '35' }),
      makeTx({ accountId: 'acc-2', quantity: '5', price: '100', fxRate: '35' }),
    ])
    const user = userEvent.setup()
    renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
    const [first] = await screen.findAllByLabelText('ราคาล่าสุด AAPL')
    await user.clear(first)
    await user.type(first, '120')
    await user.click(document.body)
    await waitFor(async () => expect((await db.instruments.get('US:AAPL'))?.lastPrice).toBe('120'))

    const second = screen.getAllByLabelText('ราคาล่าสุด AAPL')[1]
    await user.click(second)
    await user.click(document.body)

    await waitFor(() => expect(screen.getAllByLabelText('ราคาล่าสุด AAPL')[1]).toHaveValue('120'))
    expect((await db.instruments.get('US:AAPL'))?.lastPrice).toBe('120')
  })

  it('flags a price that has not been updated for more than 7 days', async () => {
    await db.instruments.add({
      id: 'US:AAPL',
      market: 'US',
      symbol: 'AAPL',
      name: 'Apple',
      assetType: 'stock',
      currency: 'USD',
      lastPrice: '120',
      lastPriceAt: '2020-01-01T00:00:00.000Z',
    })
    await db.transactions.add(makeTx({ quantity: '10', price: '100', fxRate: '35' }))
    renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
    expect(await screen.findByText(/วันก่อน$/)).toBeInTheDocument()
  })

  it('gives up the long name and the rate date line, and tightens the cells, below 1366px so every column fits', async () => {
    await db.instruments.add({ id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD', lastPrice: '120' })
    await db.transactions.add(makeTx({ quantity: '10', price: '100', fxRate: '35' }))
    renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
    const name = await screen.findByText('Apple')
    expect(name).toHaveClass('md:max-[1366px]:hidden')
    expect(name.closest('table')).toHaveClass('max-[1366px]:[&_td]:px-1.5', 'max-[1366px]:[&_th]:px-1.5')
    expect(await screen.findByText('ECB 15 ม.ค. 2024')).toHaveClass('max-[1366px]:hidden')
  })

  it('stacks the old-price badge under the input so every price input ends at the same edge', async () => {
    await db.instruments.add({
      id: 'US:AAPL',
      market: 'US',
      symbol: 'AAPL',
      name: 'Apple',
      assetType: 'stock',
      currency: 'USD',
      lastPrice: '120',
      lastPriceAt: '2020-01-01T00:00:00.000Z',
    })
    await db.transactions.add(makeTx({ quantity: '10', price: '100', fxRate: '35' }))
    renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
    const badge = await screen.findByText(/วันก่อน$/)
    expect(badge.parentElement).toContainElement(screen.getByLabelText('ราคาล่าสุด AAPL'))
    expect(badge.parentElement).toHaveClass('md:flex-col', 'md:items-end')
  })

  describe('typing a price', () => {
    const OLD = '2020-01-01T00:00:00.000Z'

    beforeEach(async () => {
      await db.instruments.add({
        id: 'US:AAPL',
        market: 'US',
        symbol: 'AAPL',
        name: 'Apple',
        assetType: 'stock',
        currency: 'USD',
        lastPrice: '120',
        lastPriceAt: OLD,
      })
      await db.transactions.add(makeTx({ quantity: '10', price: '100', fxRate: '35' }))
    })

    it('refreshes the date when the same price is typed again, which clears the old-price badge', async () => {
      const user = userEvent.setup()
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      const input = await screen.findByLabelText('ราคาล่าสุด AAPL')
      expect(await screen.findByText(/วันก่อน$/)).toBeInTheDocument()
      await user.clear(input)
      await user.type(input, '120')
      await user.tab()
      await waitFor(async () => expect((await db.instruments.get('US:AAPL'))?.lastPriceAt).not.toBe(OLD))
      expect((await db.instruments.get('US:AAPL'))?.lastPrice).toBe('120')
      await waitFor(() => expect(screen.queryByText(/วันก่อน$/)).not.toBeInTheDocument())
    })

    it('saves the same price on Enter too', async () => {
      const user = userEvent.setup()
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      const input = await screen.findByLabelText('ราคาล่าสุด AAPL')
      await user.clear(input)
      await user.type(input, '120{Enter}')
      await waitFor(async () => expect((await db.instruments.get('US:AAPL'))?.lastPriceAt).not.toBe(OLD))
    })

    it('does not touch the date when the field is only tabbed through', async () => {
      const user = userEvent.setup()
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      const input = await screen.findByLabelText('ราคาล่าสุด AAPL')
      await user.click(input)
      await user.tab()
      await user.click(input)
      await user.keyboard('{Enter}')
      await user.tab()
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect((await db.instruments.get('US:AAPL'))?.lastPriceAt).toBe(OLD)
    })

    it('forgets the edit once it is saved, so tabbing through the same price later saves nothing', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(2024, 9, 16, 9, 0))
      const user = userEvent.setup()
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      const input = await screen.findByLabelText('ราคาล่าสุด AAPL')
      await user.clear(input)
      await user.type(input, '120{Enter}')
      const savedAt = new Date(2024, 9, 16, 9, 0).toISOString()
      await waitFor(async () => expect((await db.instruments.get('US:AAPL'))?.lastPriceAt).toBe(savedAt))

      vi.setSystemTime(new Date(2024, 9, 16, 10, 0))
      await user.tab()
      await user.click(input)
      await user.tab()
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect((await db.instruments.get('US:AAPL'))?.lastPriceAt).toBe(savedAt)
    })

    it('saves once when Enter is followed by leaving the field', async () => {
      const user = userEvent.setup()
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      const input = await screen.findByLabelText('ราคาล่าสุด AAPL')
      await user.clear(input)
      await user.type(input, '125{Enter}')
      await waitFor(async () => expect((await db.instruments.get('US:AAPL'))?.lastPrice).toBe('125'))
      const savedAt = (await db.instruments.get('US:AAPL'))?.lastPriceAt
      await user.tab()
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect((await db.instruments.get('US:AAPL'))?.lastPriceAt).toBe(savedAt)
    })
  })

  it('shows the account under the asset and no exchange rate for a baht holding', async () => {
    await db.instruments.add({
      id: 'SET:PTT',
      market: 'SET',
      symbol: 'PTT',
      name: 'ปตท.',
      assetType: 'stock',
      currency: 'THB',
      lastPrice: '35',
    })
    await db.transactions.add(
      makeTx({ instrumentId: 'SET:PTT', currency: 'THB', quantity: '100', price: '33', fxRate: '1', fxSource: 'same' }),
    )
    renderRoute('/portfolio')
    const row = (await screen.findByText('ปตท.')).closest('tr')!
    expect(within(row).getByText('Dime US')).toBeInTheDocument()
    expect(within(row.closest('table')!).getByRole('columnheader', { name: 'เรทซื้อ → วันนี้' })).toBeInTheDocument()
    expect(row.cells[4]).toHaveTextContent(/^—$/)
    expect(within(row.closest('table')!).queryByRole('columnheader', { name: 'บัญชี' })).not.toBeInTheDocument()
  })

  it('shows cash left in each account with its value in baht', async () => {
    await db.transactions.add(
      makeTx({ type: 'deposit', instrumentId: undefined, quantity: undefined, price: undefined, amount: '1000', fxRate: '35' }),
    )
    renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
    expect(await screen.findByText('1,000.00 USD')).toBeInTheDocument()
    expect(await screen.findByText('33,000')).toBeInTheDocument()
    expect(screen.getByText('รวม ≈ ฿33,000')).toBeInTheDocument()
  })

  it('names a currency that has no rate yet under the cash', async () => {
    await db.transactions.add(
      makeTx({
        type: 'deposit',
        instrumentId: undefined,
        quantity: undefined,
        price: undefined,
        amount: '1000000',
        currency: 'VND',
        fxRate: '0.0014',
        fxSource: 'same',
      }),
    )
    renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
    expect(await screen.findByText('ยังไม่มีเรทวันนี้ของ VND จึงยังไม่รวมในยอดรวม')).toBeInTheDocument()
  })

  it('asks for the rate, not the price, when a priced holding only lacks today’s rate', async () => {
    await db.instruments.add({ id: 'OTHER:PHO', market: 'OTHER', symbol: 'PHO', name: 'Pho', assetType: 'stock', currency: 'VND', lastPrice: '120000' })
    await db.transactions.add(makeTx({ instrumentId: 'OTHER:PHO', currency: 'VND', quantity: '1', price: '100000', fxRate: '0.0014', fxSource: 'same' }))
    renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
    const note = await screen.findByText('ยังไม่มีเรทวันนี้ของ VND · สินทรัพย์สกุลนี้นับที่ทุน และยังไม่รวมเงินสดสกุลนี้')
    expect(note.closest('[role="note"]')).toBeInTheDocument()
    expect(screen.queryByText(/ยังไม่มีราคาล่าสุด/)).not.toBeInTheDocument()
  })

  it('counts an instrument held in two accounts as one without a price', async () => {
    await db.accounts.add({ id: 'acc-2', name: 'Dime 2', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
    await db.instruments.add({ id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD' })
    await db.transactions.bulkAdd([
      makeTx({ accountId: 'acc-1', quantity: '10', price: '100', fxRate: '35' }),
      makeTx({ accountId: 'acc-2', quantity: '5', price: '100', fxRate: '35' }),
    ])
    renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
    expect(await screen.findByText(/ยังไม่มีราคาล่าสุด 1 ตัว/)).toBeInTheDocument()
  })

  it('lists the cash as two-line rows on a phone', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    await db.transactions.add(
      makeTx({ type: 'deposit', instrumentId: undefined, quantity: undefined, price: undefined, amount: '1000', fxRate: '35' }),
    )
    renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
    const cash = await screen.findByRole('list', { name: 'เงินสดคงเหลือ' })
    await waitFor(() => expect(within(cash).getAllByRole('listitem')[0]).toHaveTextContent('Dime US1,000.00 USD≈ ฿33,000'))
    expect(screen.queryByRole('columnheader', { name: /≈/ })).not.toBeInTheDocument()
  })

  it('marks Thai funds, bonds and gold on a phone with the colour of funds, whatever the unit they are counted in', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    await db.instruments.bulkAdd([
      { id: 'FUND:SCBS&P500', market: 'FUND', symbol: 'SCBS&P500', name: 'SCB S&P500', assetType: 'fund', currency: 'THB', lastPrice: '18.42' },
      { id: 'BOND:CPALL26NA', market: 'BOND', symbol: 'CPALL26NA', name: 'CPALL26NA', assetType: 'bond', currency: 'THB', lastPrice: '1010' },
      { id: 'GOLD:96.5', market: 'GOLD', symbol: '96.5', name: 'ทอง 96.5%', assetType: 'gold', currency: 'THB', unit: 'baht_gold', lastPrice: '42000' },
    ])
    const thb = { currency: 'THB', fxRate: '1', fxSource: 'same' as const }
    await db.transactions.bulkAdd([
      makeTx({ ...thb, instrumentId: 'FUND:SCBS&P500', quantity: '1200', price: '16.1' }),
      makeTx({ ...thb, instrumentId: 'BOND:CPALL26NA', quantity: '10', price: '1000' }),
      makeTx({ ...thb, instrumentId: 'GOLD:96.5', quantity: '2', price: '41000' }),
    ])
    renderRoute('/portfolio', fakeFxProvider({}).provider)
    const holdings = await screen.findByRole('list', { name: 'สินทรัพย์ที่ถืออยู่' })
    const rows = within(holdings).getAllByRole('listitem')
    for (const [symbol, pill, name] of [
      ['SCBS&P500', 'FUND', 'กองทุนรวม (FUND)'],
      ['CPALL26NA', 'BOND', 'หุ้นกู้/พันธบัตร (BOND)'],
      ['96.5', 'GOLD', 'ทองคำ (GOLD)'],
    ]) {
      const row = rows.find((r) => within(r).queryByText(symbol))!
      expect(within(row).getByText(pill)).toHaveClass('bg-market-fund')
      expect(within(row).getByText(pill)).toHaveAttribute('title', name)
    }
    await waitFor(() => expect(rows[0]).toHaveTextContent('ยังไม่ขาย'))
  })

  it('shows no price hint when nothing is held', async () => {
    await db.transactions.add(
      makeTx({ type: 'deposit', instrumentId: undefined, quantity: undefined, price: undefined, amount: '1000', fxRate: '35' }),
    )
    renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
    expect(await screen.findByText('1,000.00 USD')).toBeInTheDocument()
    expect(screen.queryByText(/แตะราคาเพื่อแก้/)).not.toBeInTheDocument()
  })

  it('shows the strip above the views in whole baht', async () => {
    await db.instruments.add({ id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD', lastPrice: '120.55' })
    await db.transactions.add(makeTx({ quantity: '10', price: '100', fxRate: '35' }))
    renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
    expect(await screen.findByText('+7,193')).toBeInTheDocument()
    expect(screen.getByText('−2,411')).toBeInTheDocument()
    expect(screen.getAllByText('+4,782')).toHaveLength(3)
    expect(screen.queryByText('+4,781.50')).not.toBeInTheDocument()
  })

  it('right-aligns the price column under its header', async () => {
    await db.instruments.add({ id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD', lastPrice: '120' })
    await db.transactions.add(makeTx({ quantity: '10', price: '100', fxRate: '35' }))
    renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
    const input = await screen.findByLabelText('ราคาล่าสุด AAPL')
    expect(screen.getByRole('columnheader', { name: 'ราคาล่าสุด' })).toHaveClass('text-right')
    expect(input.closest('td')).toHaveClass('text-right')
  })

  it('keeps the segmented control inside a phone screen, in a 2 by 2 grid on the narrowest', async () => {
    renderRoute('/portfolio', fakeFxProvider({}).provider)
    const group = await screen.findByRole('group', { name: 'มุมมอง' })
    expect(group).toHaveClass('max-md:w-full', 'max-[380px]:grid', 'max-[380px]:grid-cols-2')
    for (const button of within(group).getAllByRole('button')) {
      // Each segment starts from its text (basis auto, no shrinking) and only grows; 44px is just the floor.
      expect(button).toHaveClass('h-11', 'min-w-11', 'shrink-0', 'max-md:grow', 'max-md:px-2')
      expect(button).not.toHaveClass('max-md:flex-1')
    }
  })

  it('leaves out cash for an account that only records trades', async () => {
    await db.transactions.add(makeTx({ quantity: '1', price: '100', fxRate: '35' }))
    renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
    expect(
      await screen.findByText('บัญชีที่จดแค่ซื้อขาย ไม่นับเงินสด (ไม่มีรายการฝาก ถอน หรือแลกเงิน)'),
    ).toBeInTheDocument()
    expect(screen.getByText('ยังไม่มีเงินสดที่บันทึกไว้')).toBeInTheDocument()
    expect(screen.queryByText('−100.00 USD')).not.toBeInTheDocument()
  })

  it('explains the missing cash of an account that has only received a transfer', async () => {
    await db.accounts.add({ id: 'acc-2', name: 'Binance', broker: 'Binance', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
    const baht = { currency: 'THB', fxRate: '1', fxSource: 'same' as const, instrumentId: undefined, quantity: undefined, price: undefined }
    await db.transactions.bulkAdd([
      makeTx({ ...baht, type: 'deposit', amount: '50000', date: '2024-01-02' }),
      makeTx({ ...baht, type: 'transfer', toAccountId: 'acc-2', amount: '20000', date: '2024-01-03' }),
    ])
    renderRoute('/portfolio', fakeFxProvider({}).provider)
    expect(
      await screen.findByText('บัญชีที่จดแค่ซื้อขาย ไม่นับเงินสด (ไม่มีรายการฝาก ถอน หรือแลกเงิน)'),
    ).toBeInTheDocument()
  })

  it('does not explain missing cash when every account that appears in a transaction records its cash', async () => {
    await db.accounts.add({ id: 'acc-2', name: 'KBank', broker: 'KBank', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
    const baht = { currency: 'THB', fxRate: '1', fxSource: 'same' as const, instrumentId: undefined, quantity: undefined, price: undefined }
    await db.transactions.bulkAdd([
      makeTx({ ...baht, type: 'deposit', amount: '50000', date: '2024-01-02' }),
      makeTx({ ...baht, accountId: 'acc-2', type: 'deposit', amount: '1000', date: '2024-01-02' }),
      makeTx({ ...baht, type: 'transfer', toAccountId: 'acc-2', amount: '20000', date: '2024-01-03' }),
    ])
    renderRoute('/portfolio', fakeFxProvider({}).provider)
    expect(await screen.findByText('เงินสดคงเหลือ')).toBeInTheDocument()
    await screen.findByText('KBank')
    expect(screen.queryByText(/บัญชีที่จดแค่ซื้อขาย/)).not.toBeInTheDocument()
  })

  describe('views', () => {
    beforeEach(async () => {
      await db.accounts.add({ id: 'acc-2', name: 'Streaming SET', broker: 'Streaming', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
      await db.instruments.bulkAdd([
        { id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD', lastPrice: '120' },
        { id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'ปตท.', assetType: 'stock', currency: 'THB', lastPrice: '35' },
      ])
      const baht = { accountId: 'acc-2', currency: 'THB', fxRate: '1', fxSource: 'same' as const }
      await db.transactions.bulkAdd([
        makeTx({ quantity: '10', price: '100', fxRate: '35', date: '2024-01-10' }),
        makeTx({ ...baht, type: 'deposit', instrumentId: undefined, quantity: undefined, price: undefined, amount: '10000', date: '2024-01-11' }),
        makeTx({ ...baht, instrumentId: 'SET:PTT', quantity: '100', price: '33', date: '2024-01-12' }),
      ])
    })

    it('groups holdings under each account', async () => {
      const user = userEvent.setup()
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      await user.click(await screen.findByRole('button', { name: 'ตามบัญชี' }))
      const set = screen.getByRole('heading', { name: 'Streaming SET' }).closest('div')!.parentElement!
      expect(within(set).getByText('ปตท.')).toBeInTheDocument()
      expect(within(set).queryByText('Apple')).not.toBeInTheDocument()
      expect(await within(set).findByText('มูลค่า ฿3,500 · 1 ตัว')).toBeInTheDocument()
    })

    it('shares the assets out by market', async () => {
      const user = userEvent.setup()
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      await user.click(await screen.findByRole('button', { name: 'ตามตลาด' }))
      const us = (await screen.findByText('สหรัฐ (US)')).closest('tr')!
      await waitFor(() => expect(within(us).getByText('91.9%')).toBeInTheDocument())
      expect(within(us).getByText('39,600')).toBeInTheDocument()
      expect(within(us).getAllByText('+4,600')).toHaveLength(2)
      expect(within(screen.getByText('ไทย (SET)').closest('tr')!).getByText('8.1%')).toBeInTheDocument()
    })

    it('counts an instrument held in two accounts once in the market view', async () => {
      await db.transactions.add(makeTx({ accountId: 'acc-2', quantity: '5', price: '100', fxRate: '35', date: '2024-01-13' }))
      const user = userEvent.setup()
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      await user.click(await screen.findByRole('button', { name: 'ตามตลาด' }))
      const us = (await screen.findByText('สหรัฐ (US)')).closest('tr')!
      expect(within(us).getByText('1 ตัว')).toBeInTheDocument()
    })

    it('always gives a share one decimal and a fixed-width slot so the bars line up', async () => {
      await db.transactions.clear()
      await db.transactions.add(makeTx({ quantity: '10', price: '100', fxRate: '35', date: '2024-01-10' }))
      const user = userEvent.setup()
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      await user.click(await screen.findByRole('button', { name: 'ตามตลาด' }))
      const share = await screen.findByText('100.0%')
      expect(share).toHaveClass('w-14', 'text-right', 'tabular-nums')
    })

    it('says that holdings without a price count at cost, in the views that add them up', async () => {
      await db.instruments.update('US:AAPL', { lastPrice: '' })
      const user = userEvent.setup()
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      const note = 'ตัวที่ยังไม่มีราคานับตามต้นทุน'
      await screen.findByText('Apple')
      expect(screen.queryByText(note)).not.toBeInTheDocument()
      for (const view of ['ตามบัญชี', 'ตามตลาด', 'ตามสกุลเงิน']) {
        await user.click(screen.getByRole('button', { name: view }))
        expect(await screen.findByText(note)).toBeInTheDocument()
      }
    })

    it('does not say it when every holding has a price', async () => {
      const user = userEvent.setup()
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      await user.click(await screen.findByRole('button', { name: 'ตามตลาด' }))
      await screen.findByText('สหรัฐ (US)')
      expect(screen.queryByText('ตัวที่ยังไม่มีราคานับตามต้นทุน')).not.toBeInTheDocument()
    })

    it('shows the price hint only in the views that have a price input', async () => {
      const user = userEvent.setup()
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      const hint = /แตะราคาเพื่อแก้/
      expect(await screen.findByText(hint)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'ตามบัญชี' }))
      expect(screen.getByText(hint)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'ตามตลาด' }))
      expect(screen.queryByText(hint)).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'ตามสกุลเงิน' }))
      expect(screen.queryByText(hint)).not.toBeInTheDocument()
    })

    it('shows the total return and the market share as two-line rows on a phone', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
      const user = userEvent.setup()
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      const holdings = await screen.findByRole('list', { name: 'สินทรัพย์ที่ถืออยู่' })
      await waitFor(() => expect(within(holdings).getAllByRole('listitem')[0]).toHaveTextContent('ยังไม่ขาย +4,600 · รวมปันผล +4,600 · ค่าเงิน −2,400'))
      await user.click(screen.getByRole('button', { name: 'ตามตลาด' }))
      const markets = screen.getByRole('list', { name: 'สัดส่วนตามตลาด' })
      expect(within(markets).getAllByRole('listitem')[0]).toHaveTextContent('สหรัฐ (US)1 ตัว91.9%39,600 · ยังไม่ขาย +4,600')
      expect(within(markets).getAllByRole('listitem')[0]).not.toHaveTextContent('+4,600.00')
    })

    it('keeps each label with its value, and the dot before it, on the phone sub-line, so a wrap falls between the pairs', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      const holdings = await screen.findByRole('list', { name: 'สินทรัพย์ที่ถืออยู่' })
      const item = within(holdings).getAllByRole('listitem')[0]
      await waitFor(() => expect(item).toHaveTextContent('ค่าเงิน −2,400'))
      const pairs = [
        ['ยังไม่ขาย', 'ยังไม่ขาย +4,600'],
        ['รวมปันผล', '· รวมปันผล +4,600'],
        ['ค่าเงิน', '· ค่าเงิน −2,400'],
      ]
      for (const [label, text] of pairs) {
        const wrapper = within(item).getByText(new RegExp(label))
        expect(wrapper).toHaveTextContent(text)
        expect(wrapper).toHaveClass('whitespace-nowrap')
      }
      expect(within(item).getByText(/ยังไม่ขาย/)).not.toHaveTextContent(/·/)
    })

    it('keeps the currency pill at its own size on a phone', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
      const user = userEvent.setup()
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      await user.click(await screen.findByRole('button', { name: 'ตามสกุลเงิน' }))
      const currencies = await screen.findByRole('list', { name: 'สัดส่วนตามสกุลเงิน' })
      const row = within(currencies).getAllByRole('listitem')[0]
      const pill = within(row).getByText('USD')
      expect(pill.parentElement).not.toBe(row)
      expect(pill.parentElement).toHaveClass('flex')
      await waitFor(() => expect(row).toHaveTextContent('USD79.5%'))
    })

    it('adds the strip above the views up in whole baht', async () => {
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      expect(await screen.findByText('+4,800')).toBeInTheDocument()
      expect(screen.getByText('+7,200')).toBeInTheDocument()
      expect(screen.getByText('−2,400')).toBeInTheDocument()
    })

    it('shows the gains of a holding in whole baht', async () => {
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      const row = (await screen.findByText('Apple')).closest('tr')!
      await waitFor(() => expect(within(row).getAllByText('+4,600')).toHaveLength(2))
      expect(within(row).getByText('39,600')).toBeInTheDocument()
      expect(within(row).queryByText('+4,600.00')).not.toBeInTheDocument()
    })

    it('shares assets and cash out by currency', async () => {
      const user = userEvent.setup()
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      await user.click(await screen.findByRole('button', { name: 'ตามสกุลเงิน' }))
      const [allocation] = await screen.findAllByRole('table')
      const rows = within(allocation).getAllByRole('row')
      await waitFor(() => expect(rows[1]).toHaveTextContent('USD39,600039,60079.5%'))
      expect(rows[2]).toHaveTextContent('THB3,5006,70010,20020.5%')
    })

    it('shows the cash alone under the currency view when nothing is held', async () => {
      await db.transactions.clear()
      await db.transactions.add(
        makeTx({ type: 'deposit', instrumentId: undefined, quantity: undefined, price: undefined, amount: '1000', fxRate: '35' }),
      )
      const user = userEvent.setup()
      renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
      expect(await screen.findByText('ยังไม่มีสินทรัพย์ที่ถืออยู่')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'ตามสกุลเงิน' }))
      const allocation = (await screen.findByRole('columnheader', { name: 'สกุลเงิน' })).closest('table')!
      expect(within(allocation).getAllByRole('row')[1]).toHaveTextContent('USD033,00033,000100.0%')
      expect(screen.queryByText('ยังไม่มีสินทรัพย์ที่ถืออยู่')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'ตามตลาด' }))
      expect(screen.getByText('ยังไม่มีสินทรัพย์ที่ถืออยู่')).toBeInTheDocument()
    })
  })
})

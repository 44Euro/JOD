import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { fakeFxProvider, lateFxProvider } from '../../test/fakeFx'
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
    vi.unstubAllGlobals()
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
        '+2,021หุ้นขึ้น · ยังไม่ขาย',
        '−360ค่าเงิน · ยังไม่ขาย',
        '+413ขายแล้ว',
        '+289ปันผล ดอกเบี้ย',
        '−574ค่าธรรมเนียม · ค่าเงินเงินสด',
        '35,789วันนี้',
      ]),
    )
    const board = screen.getByRole('region', { name: 'กระดานเรทของคุณ' })
    expect(within(board).getByText('−2.94%')).toBeInTheDocument()
    expect(within(board).getByText('−360.00 THB')).toBeInTheDocument()
  })

  it('splits the gain of each holding into stock and currency in whole baht', async () => {
    setToday(2024, 6, 1)
    await seedDime()
    renderRoute('/', usd())
    const row = (await screen.findByText('Apple')).closest('tr')!
    expect(within(row.closest('table')!).getByRole('columnheader', { name: 'จากหุ้น' })).toBeInTheDocument()
    await waitFor(() => expect(within(row).getByText('+2,020')).toBeInTheDocument())
    expect(within(row).getByText('−360')).toBeInTheDocument()
    expect(within(row).getByText('+1,660')).toBeInTheDocument()
  })

  it('shows no currency effect for a baht holding', async () => {
    setToday(2024, 6, 1)
    await db.accounts.add(account)
    await db.instruments.add({ id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'ปตท.', assetType: 'stock', currency: 'THB', lastPrice: '35' })
    await db.transactions.add(makeTx({ instrumentId: 'SET:PTT', currency: 'THB', quantity: '100', price: '33', fxRate: '1', fxSource: 'same', date: '2024-01-04' }))
    renderRoute('/', usd())
    const row = (await screen.findByText('ปตท.')).closest('tr')!
    await waitFor(() => expect(within(row).getAllByText('+200')).toHaveLength(2))
    expect(row.cells[row.cells.length - 1]).toHaveTextContent(/^—$/)
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

  it('leaves out the short route of an asset held in two currencies, because its rate and cost have no single value', async () => {
    setToday(2024, 6, 1)
    await db.accounts.bulkAdd([
      { id: 'bitkub', name: 'Bitkub', broker: 'Bitkub', note: '', createdAt: '2024-01-01T00:00:00.000Z' },
      { id: 'binance', name: 'Binance', broker: 'Binance', note: '', createdAt: '2024-01-01T00:00:00.000Z' },
    ])
    await db.instruments.add({ id: 'CRYPTO:ETH', market: 'CRYPTO', symbol: 'ETH', name: 'Ethereum', assetType: 'crypto', currency: 'THB', lastPrice: '120000' })
    await db.transactions.bulkAdd([
      makeTx({ accountId: 'bitkub', instrumentId: 'CRYPTO:ETH', currency: 'THB', fxRate: '1', fxSource: 'same', quantity: '0.1', price: '110000', date: '2024-01-10' }),
      makeTx({ accountId: 'binance', instrumentId: 'CRYPTO:ETH', currency: 'USD', fxRate: '33', quantity: '0.1', price: '3300', date: '2024-02-10' }),
    ])
    renderRoute('/', usd())
    expect(await screen.findByText('฿24,000', { selector: 'p' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /เส้นทางเงิน · ETH/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/แลกที่/)).not.toBeInTheDocument()
  })

  it('gives the rate board the whole width when nothing is left for a right-hand column', async () => {
    setToday(2024, 6, 1)
    await db.accounts.bulkAdd([
      { id: 'bitkub', name: 'Bitkub', broker: 'Bitkub', note: '', createdAt: '2024-01-01T00:00:00.000Z' },
      { id: 'binance', name: 'Binance', broker: 'Binance', note: '', createdAt: '2024-01-01T00:00:00.000Z' },
    ])
    await db.instruments.add({ id: 'CRYPTO:ETH', market: 'CRYPTO', symbol: 'ETH', name: 'Ethereum', assetType: 'crypto', currency: 'THB', lastPrice: '120000' })
    await db.transactions.bulkAdd([
      makeTx({ accountId: 'bitkub', instrumentId: 'CRYPTO:ETH', currency: 'THB', fxRate: '1', fxSource: 'same', quantity: '0.1', price: '110000', date: '2024-01-10' }),
      makeTx({ accountId: 'binance', instrumentId: 'CRYPTO:ETH', currency: 'USD', fxRate: '33', quantity: '0.1', price: '3300', date: '2024-02-10' }),
    ])
    renderRoute('/', usd())
    const board = (await screen.findByRole('region', { name: 'กระดานเรทของคุณ' })).parentElement!
    expect(board.children).toHaveLength(1)
    expect(board).not.toHaveClass('xl:grid-cols-[minmax(0,1fr)_340px]')
  })

  it('keeps the two columns while the short route or a note has something to say', async () => {
    setToday(2024, 6, 1)
    await seedDime()
    renderRoute('/', usd())
    const board = (await screen.findByRole('region', { name: 'กระดานเรทของคุณ' })).parentElement!
    expect(board.children).toHaveLength(2)
    expect(board).toHaveClass('xl:grid-cols-[minmax(0,1fr)_340px]')
  })

  it('counts a holding without a price at cost and says so', async () => {
    setToday(2024, 6, 1)
    await seedDime({ lastPrice: '' })
    renderRoute('/', usd())
    expect(await screen.findByText(/ยังไม่มีราคาล่าสุด 1 ตัว \(นับที่ทุนไปก่อน\)/)).toBeInTheDocument()
  })

  it('counts an instrument held in two accounts as one without a price', async () => {
    setToday(2024, 6, 1)
    await seedDime({ lastPrice: '' })
    await db.accounts.add({ ...account, id: 'acc-2', name: 'Dime 2' })
    await db.transactions.add(makeTx({ accountId: 'acc-2', quantity: '3', price: '100', fxRate: '34', date: '2024-01-05' }))
    renderRoute('/', usd())
    expect(await screen.findByText(/ยังไม่มีราคาล่าสุด 1 ตัว \(นับที่ทุนไปก่อน\)/)).toBeInTheDocument()
  })

  it('asks for the rate, not the price, when a priced holding only lacks today’s rate', async () => {
    setToday(2024, 6, 1)
    await db.accounts.add(account)
    await db.instruments.add({ id: 'OTHER:PHO', market: 'OTHER', symbol: 'PHO', name: 'Pho', assetType: 'stock', currency: 'VND', lastPrice: '120000' })
    await db.transactions.bulkAdd([
      makeTx({ ...thb, type: 'deposit', amount: '3500', date: '2024-01-02' }),
      makeTx({ instrumentId: 'OTHER:PHO', currency: 'VND', quantity: '1', price: '100000', fxRate: '0.0014', fxSource: 'same', date: '2024-01-04' }),
    ])
    renderRoute('/', usd())
    expect(await screen.findByText(/ยังไม่มีเรทวันนี้ของ VND/)).toBeInTheDocument()
    expect(screen.queryByText(/ยังไม่มีราคาล่าสุด/)).not.toBeInTheDocument()
  })

  it('falls back to the first date when the return since the start cannot be worked out', async () => {
    setToday(2025, 6, 1)
    await db.accounts.add(account)
    await db.transactions.bulkAdd([
      makeTx({ ...thb, type: 'deposit', amount: '1000', date: '2024-01-02' }),
      makeTx({ ...thb, type: 'withdraw', amount: '1000', date: '2024-01-02' }),
    ])
    renderRoute('/', usd())
    expect(await screen.findByText('ผลตอบแทนต่อปี')).toBeInTheDocument()
    expect(screen.getByText('ตั้งแต่ 2 ม.ค. 2024')).toBeInTheDocument()
    expect(screen.queryByText(/ตั้งแต่เริ่ม/)).not.toBeInTheDocument()
  })

  describe('while the rates are on their way', () => {
    it('shows no money, route or rate alert until the rates arrive, then the right values', async () => {
      setToday(2024, 6, 1)
      await seedDime()
      const { provider, release, requested } = lateFxProvider({ 'USD|THB': '33' }, '2024-06-28')
      renderRoute('/', provider)
      await waitFor(() => expect(requested()).toBeGreaterThan(0))
      expect(screen.getByText('กำลังโหลด…')).toBeInTheDocument()
      expect(screen.queryByText('มูลค่าวันนี้ · สินทรัพย์ + เงินสด')).not.toBeInTheDocument()
      expect(screen.queryByRole('list', { name: 'จากเงินลงทุนถึงวันนี้' })).not.toBeInTheDocument()
      expect(screen.queryByText(/ยังไม่มีเรทวันนี้ของ/)).not.toBeInTheDocument()
      expect(screen.queryByText(/ยังไม่มีราคาล่าสุด/)).not.toBeInTheDocument()

      release()
      expect(await screen.findByText('฿35,789')).toBeInTheDocument()
      expect(screen.getByText('เรทวันนี้ ECB 28 มิ.ย. 2024')).toBeInTheDocument()
      expect(screen.queryByText(/ยังไม่มีเรทวันนี้ของ/)).not.toBeInTheDocument()
    })

    it('starts from the last rate on file whatever its age, names its day, then swaps in the fresh one', async () => {
      setToday(2024, 6, 1)
      await seedDime()
      await db.fxRates.put({ key: 'USD|THB|latest', rate: '31', rateDate: '2024-05-31', fetchedAt: new Date(2024, 4, 31, 18).toISOString() })
      const { provider, release } = lateFxProvider({ 'USD|THB': '33' }, '2024-06-28')
      renderRoute('/', provider)
      expect(await screen.findByText('เรทวันนี้ ECB 31 พ.ค. 2024')).toBeInTheDocument()
      // (360 + 724.5) USD x 31
      expect(screen.getByText('฿33,620')).toBeInTheDocument()
      expect(screen.queryByText(/ยังไม่มีเรทวันนี้ของ/)).not.toBeInTheDocument()

      release()
      expect(await screen.findByText('฿35,789')).toBeInTheDocument()
      expect(screen.getByText('เรทวันนี้ ECB 28 มิ.ย. 2024')).toBeInTheDocument()
    })

    it('needs no network at all for a portfolio held in the base currency', async () => {
      setToday(2024, 6, 1)
      await db.accounts.add(account)
      await db.instruments.add({ id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'ปตท.', assetType: 'stock', currency: 'THB', lastPrice: '35' })
      await db.transactions.bulkAdd([
        makeTx({ ...thb, type: 'deposit', amount: '5000', date: '2024-01-02' }),
        makeTx({ instrumentId: 'SET:PTT', currency: 'THB', quantity: '100', price: '33', fxRate: '1', fxSource: 'same', date: '2024-01-04' }),
      ])
      const { provider, requested } = lateFxProvider({})
      renderRoute('/', provider)
      expect(await screen.findByText('฿5,200')).toBeInTheDocument()
      expect(screen.queryByText(/ยังไม่มีเรทวันนี้ของ/)).not.toBeInTheDocument()
      expect(requested()).toBe(0)
    })

    it('abandons the request and writes nothing to the rate cache once the page is gone', async () => {
      setToday(2024, 6, 1)
      await seedDime()
      const { provider, release, requested, signals } = lateFxProvider({ 'USD|THB': '33' })
      renderRoute('/', provider)
      await waitFor(() => expect(requested()).toBeGreaterThan(0))
      expect(signals.every((signal) => signal?.aborted === false)).toBe(true)
      cleanup()
      expect(signals.every((signal) => signal?.aborted === true)).toBe(true)
      release()
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(await db.fxRates.count()).toBe(0)
    })
  })

  it('keeps the long name, the rate date and the roomy cells in its holdings table below 1366px', async () => {
    setToday(2024, 6, 1)
    await seedDime()
    renderRoute('/', usd())
    const name = await screen.findByText('Apple')
    expect(name).not.toHaveClass('md:max-[1366px]:hidden')
    const row = name.closest('tr')!
    expect(within(row).getByText('ECB 15 ม.ค. 2024')).not.toHaveClass('max-[1366px]:hidden')
    expect(name.closest('table')).not.toHaveClass('max-[1366px]:[&_td]:px-1.5')
    expect(name.closest('table')).not.toHaveClass('max-[1366px]:[&_th]:px-1.5')
  })

  it('keeps each label with its value, and the dot before it, on the phone sub-line of the holdings', async () => {
    setToday(2024, 6, 1)
    await seedDime()
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    renderRoute('/', usd())
    const holdings = await screen.findByRole('list', { name: 'สินทรัพย์ที่ถืออยู่' })
    const item = within(holdings).getAllByRole('listitem')[0]
    await waitFor(() => expect(item).toHaveTextContent('3 หุ้น · หุ้น +2,020 · ค่าเงิน −360'))
    for (const [label, text] of [
      ['· หุ้น', '· หุ้น +2,020'],
      ['ค่าเงิน', '· ค่าเงิน −360'],
    ]) {
      const wrapper = within(item).getByText(new RegExp(label))
      expect(wrapper).toHaveTextContent(text)
      expect(wrapper).toHaveClass('whitespace-nowrap')
    }
    expect(within(item).getByText('3 หุ้น')).toHaveClass('whitespace-nowrap')
    expect(within(item).getByText('3 หุ้น')).not.toHaveTextContent(/·/)
  })

  it('counts each holding on the phone in the unit of its own asset', async () => {
    setToday(2024, 6, 1)
    await db.accounts.add(account)
    await db.instruments.bulkAdd([
      { id: 'FUND:SCBS&P500', market: 'FUND', symbol: 'SCBS&P500', name: 'SCB S&P500', assetType: 'fund', currency: 'THB', lastPrice: '18.42' },
      { id: 'GOLD:96.5', market: 'GOLD', symbol: '96.5', name: 'ทอง 96.5%', assetType: 'gold', currency: 'THB', unit: 'baht_gold', lastPrice: '42000' },
      { id: 'GOLD:99.99', market: 'GOLD', symbol: '99.99', name: 'ทอง 99.99%', assetType: 'gold', currency: 'THB', unit: 'gram', lastPrice: '2700' },
    ])
    await db.transactions.bulkAdd([
      makeTx({ ...thb, instrumentId: 'FUND:SCBS&P500', quantity: '1200', price: '16.1' }),
      makeTx({ ...thb, instrumentId: 'GOLD:96.5', quantity: '2', price: '41000' }),
      makeTx({ ...thb, instrumentId: 'GOLD:99.99', quantity: '15', price: '2650' }),
      makeTx({ ...thb, instrumentId: 'SET:AAPL80', quantity: '3000', price: '8' }),
    ])
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    renderRoute('/', usd())
    const holdings = await screen.findByRole('list', { name: 'สินทรัพย์ที่ถืออยู่' })
    const rows = within(holdings).getAllByRole('listitem')
    const row = (symbol: string) => rows.find((r) => within(r).queryByText(symbol))!
    await waitFor(() => expect(row('SCBS&P500')).toHaveTextContent('1,200 หน่วย · หุ้น +2,784'))
    expect(row('96.5')).toHaveTextContent('2 บาททองคำ · หุ้น +2,000')
    expect(row('99.99')).toHaveTextContent('15 กรัม · หุ้น +750')
    expect(row('SET:AAPL80')).toHaveTextContent('3,000 หน่วย')
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
      expect(link.closest('[role="alert"]')).toHaveClass(
        'max-md:[&_a]:py-3',
        'max-md:[&_a]:-mx-2',
        'max-md:[&_a]:px-2',
        '[&_a]:whitespace-nowrap',
      )
    })

    it('does the same for the links inside the price and review notes', async () => {
      setToday(2024, 6, 1)
      await seedDime({ lastPrice: '', reviewDate: '2024-06-30' })
      renderRoute('/', usd())
      for (const name of ['กรอกราคา', 'เปิดดู']) {
        const link = await screen.findByRole('link', { name })
        expect(link.closest('[role="note"]')).toHaveClass('max-md:[&_a]:py-3', 'max-md:[&_a]:-mx-2', 'max-md:[&_a]:px-2')
      }
    })
  })

  describe('layout by container width', () => {
    it('lets the next row shrink below the two-column breakpoint', async () => {
      setToday(2024, 6, 1)
      await seedDime()
      renderRoute('/', usd())
      const board = await screen.findByRole('region', { name: 'กระดานเรทของคุณ' })
      expect(board.parentElement).toHaveClass('grid-cols-[minmax(0,1fr)]', 'xl:grid-cols-[minmax(0,1fr)_340px]')
    })

    it('switches the route and the rate board on their own width, not the screen’s', async () => {
      setToday(2024, 6, 1)
      await seedDime()
      renderRoute('/', usd())
      const route = await screen.findByRole('list', { name: 'จากเงินลงทุนถึงวันนี้' })
      expect(route.parentElement).toHaveClass('@container')
      expect(route).toHaveClass('@min-[768px]:grid-cols-[repeat(var(--n),minmax(0,1fr))]')
      const board = screen.getByRole('region', { name: 'กระดานเรทของคุณ' })
      expect(board).toHaveClass('@container')
      const [row] = within(board).getAllByRole('listitem')
      expect(row).toHaveClass('@min-[680px]:grid-cols-[120px_1fr_1fr_110px_170px]')
    })
  })
})

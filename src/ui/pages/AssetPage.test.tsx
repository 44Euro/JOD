import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { MarketError, marketClient } from '../../market/client'
import type { Transaction } from '../../domain/types'
import { fakeFxProvider, lateFxProvider } from '../../test/fakeFx'
import { makeTx } from '../../test/fixtures'
import { renderRoute, resetDb } from '../../test/render'

const voo = { id: 'US:VOO', market: 'US', symbol: 'VOO', name: 'Vanguard S&P 500', assetType: 'etf', currency: 'USD', lastPrice: '500' } as const
const usd = fakeFxProvider({ 'USD|THB': '33' }).provider

beforeEach(async () => {
  await resetDb()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2024, 9, 16, 9, 0))
  await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
  await db.transactions.bulkAdd([
    makeTx({ instrumentId: 'US:VOO', quantity: '10', price: '400', fees: '2', fxRate: '35', date: '2024-01-10', note: 'DCA' }),
    makeTx({ instrumentId: 'US:VOO', type: 'dividend', quantity: undefined, price: undefined, amount: '20', tax: '3', fxRate: '34', date: '2024-03-01' }),
    makeTx({ instrumentId: 'US:VOO', type: 'sell', quantity: '2', price: '450', fees: '1', fxRate: '34', date: '2024-04-01' }),
  ])
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AssetPage', () => {
  it('shows nothing about the asset’s value until the rates arrive', async () => {
    await db.instruments.add(voo)
    const { provider, release, requested } = lateFxProvider({ 'USD|THB': '33' })
    renderRoute('/assets/US%3AVOO', provider)
    await waitFor(() => expect(requested()).toBeGreaterThan(0))
    expect(screen.getByText('กำลังโหลด…')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'VOO' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'เส้นทางเงินของ VOO' })).not.toBeInTheDocument()

    release()
    expect(await screen.findByText('฿132,000', { selector: 'p' })).toBeInTheDocument()
  })

  it('sums the asset up with its total return including dividends', async () => {
    await db.instruments.add(voo)
    renderRoute('/assets/US%3AVOO', usd)
    expect(await screen.findByRole('heading', { name: 'VOO' })).toBeInTheDocument()
    expect(await screen.findByText('มูลค่าวันนี้ · 8 หน่วย × 500.00 USD')).toBeInTheDocument()
    expect(await screen.findByText('฿132,000', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('+23,074')).toBeInTheDocument()
    expect(screen.getByText('+20.6% รวมปันผล')).toBeInTheDocument()
    expect(screen.getByText('฿578')).toBeInTheDocument()
    expect(screen.getByText('ปันผล/ทุน 0.5%')).toBeInTheDocument()
    expect(screen.getByText('400.20', { selector: 'p' })).toBeInTheDocument()
  })

  it('counts the value of gold in the unit it is held in', async () => {
    await db.instruments.add({
      id: 'GOLD:96.5',
      market: 'GOLD',
      symbol: '96.5',
      name: 'ทอง 96.5%',
      assetType: 'gold',
      currency: 'THB',
      unit: 'baht_gold',
      lastPrice: '42000',
    })
    await db.transactions.add(
      makeTx({ instrumentId: 'GOLD:96.5', currency: 'THB', fxRate: '1', fxSource: 'same', quantity: '2', price: '41000', date: '2024-02-01' }),
    )
    renderRoute('/assets/GOLD%3A96.5', usd)
    expect(await screen.findByText('มูลค่าวันนี้ · 2 บาททองคำ × 42,000.00 THB')).toBeInTheDocument()
    expect(screen.getByText('ซื้อ 2 บาททองคำ · ทุนเฉลี่ย')).toBeInTheDocument()
  })

  it('counts a transfer of units on the asset page in the unit of the asset', async () => {
    await db.instruments.add({ id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'ปตท.', assetType: 'stock', currency: 'THB', lastPrice: '35' })
    await db.accounts.add({ id: 'acc-2', name: 'IBKR', broker: 'IBKR', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
    await db.transactions.bulkAdd([
      makeTx({ instrumentId: 'SET:PTT', currency: 'THB', fxRate: '1', fxSource: 'same', quantity: '10', price: '33', date: '2024-02-01' }),
      makeTx({
        instrumentId: 'SET:PTT',
        type: 'transfer',
        toAccountId: 'acc-2',
        currency: 'THB',
        fxRate: '1',
        fxSource: 'same',
        quantity: '3',
        price: undefined,
        date: '2024-05-01',
      }),
    ])
    renderRoute('/assets/SET%3APTT', usd)
    expect(await screen.findByText('ทั้งหมด 2 รายการ')).toBeInTheDocument()
    const rows = within(screen.getAllByRole('table').at(-1)!).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('1 พ.ค. 2024โอนระหว่างบัญชี3 หุ้น → IBKR')
  })

  it('draws the six-station route and the three badges under it', async () => {
    await db.instruments.add(voo)
    renderRoute('/assets/US%3AVOO', usd)
    const route = await screen.findByRole('list', { name: 'เส้นทางเงินของ VOO' })
    await waitFor(() => expect(within(route).getAllByRole('listitem')[4]).toHaveTextContent('33.00เรทวันนี้ · บาทแข็งขึ้น'))
    expect(within(route).getAllByRole('listitem')).toHaveLength(6)
    expect(screen.getByText('จากหุ้น +27,944')).toHaveClass('bg-gain-soft')
    expect(screen.getByText('จากค่าเงิน −8,000')).toBeInTheDocument()
    expect(screen.getByText('ปันผล +578')).toBeInTheDocument()
  })

  describe('a coin whose price is quoted in another currency than some of its holdings', () => {
    const eth = { id: 'CRYPTO:ETH', market: 'CRYPTO', symbol: 'ETH', name: 'Ethereum', assetType: 'crypto', currency: 'THB', lastPrice: '120000' } as const
    const bitkub = () =>
      makeTx({ accountId: 'bitkub', instrumentId: 'CRYPTO:ETH', currency: 'THB', fxRate: '1', fxSource: 'same', quantity: '0.1', price: '110000', date: '2024-01-10' })
    const binance = () =>
      makeTx({ accountId: 'binance', instrumentId: 'CRYPTO:ETH', currency: 'USD', fxRate: '33', quantity: '0.1', price: '3300', date: '2024-02-10' })

    beforeEach(async () => {
      await db.accounts.bulkAdd([
        { id: 'bitkub', name: 'Bitkub', broker: 'Bitkub', note: '', createdAt: '2024-01-01T00:00:00.000Z' },
        { id: 'binance', name: 'Binance', broker: 'Binance', note: '', createdAt: '2024-01-01T00:00:00.000Z' },
      ])
      await db.instruments.add(eth)
    })

    it('shows the price in its own currency, no average cost, and only the stations that are in baht when it is held in two currencies', async () => {
      await db.transactions.bulkAdd([bitkub(), binance()])
      renderRoute('/assets/CRYPTO%3AETH', usd)
      expect(await screen.findByText('฿24,000', { selector: 'p' })).toBeInTheDocument()
      expect(screen.getByText('มูลค่าวันนี้ · 0.2 เหรียญ × 120,000.00 THB')).toBeInTheDocument()
      const cost = screen.getByText('ทุนเฉลี่ย').parentElement!
      expect(cost).toHaveTextContent('—')
      expect(cost).not.toHaveTextContent('USD')
      const route = screen.getByRole('list', { name: 'เส้นทางเงินของ ETH' })
      expect(within(route).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['฿21,890บาทที่ลงไป', '฿24,000มูลค่าวันนี้'])
    })

    it('turns the stored price into the currency of the only holding there is', async () => {
      await db.transactions.add(binance())
      renderRoute('/assets/CRYPTO%3AETH', usd)
      expect(await screen.findByText('฿12,000', { selector: 'p' })).toBeInTheDocument()
      expect(screen.getByText('มูลค่าวันนี้ · 0.1 เหรียญ × 3,636.3636 USD')).toBeInTheDocument()
      const route = screen.getByRole('list', { name: 'เส้นทางเงินของ ETH' })
      expect(within(route).getByText('3,636.3636')).toBeInTheDocument()
      expect(within(route).getByText('ราคาวันนี้ · +10.2%')).toBeInTheDocument()
    })
  })

  it('lists every transaction of the asset and the summary of realized gain and fees', async () => {
    await db.instruments.add(voo)
    renderRoute('/assets/US%3AVOO', usd)
    expect(await screen.findByText('ทั้งหมด 3 รายการ')).toBeInTheDocument()
    const rows = within(screen.getAllByRole('table').at(-1)!).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('1 เม.ย. 2024ขาย')
    expect(rows[2]).toHaveTextContent('20 หัก ณ ที่จ่าย 3')
    expect(rows[3]).toHaveTextContent('10 × 400.00 · DCA')
    expect(screen.getByText('กำไรที่ขายแล้ว').nextSibling).toHaveTextContent('+2,552')
    expect(screen.getByText('ค่าธรรมเนียมรวม').nextSibling).toHaveTextContent('104')
  })

  describe('the journal line of a history row', () => {
    const phone = () =>
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    const journaled = (journal: Transaction['journal'], date = '2024-02-01') =>
      makeTx({ instrumentId: 'US:VOO', quantity: '1', price: '410', fxRate: '34', date, journal })

    beforeEach(async () => {
      await db.instruments.add(voo)
    })

    it('puts the strategy and the emotion in a dim line under the description of a row on a computer', async () => {
      await db.transactions.add(journaled({ strategy: 'Breakout', emotion: 'fomo', confidence: 4 }))
      renderRoute('/assets/US%3AVOO', usd)
      const line = (await screen.findByText('Breakout')).parentElement!
      expect(line).toHaveClass('flex', 'min-w-0', 'text-[12.5px]', 'text-muted-foreground')
      expect(line).toHaveTextContent(/^Breakout · FOMO$/)
      const [, , description] = within(line.closest('tr')!).getAllByRole('cell')
      expect(description).toHaveTextContent('1 × 410.00Breakout · FOMO')
      expect(line.parentElement).toBe(description)
    })

    it('shows what there is of it, and nothing for a row without a journal or with only a reason', async () => {
      await db.transactions.bulkAdd([
        journaled({ strategy: 'DCA' }, '2024-02-02'),
        journaled({ emotion: 'greed' }, '2024-02-03'),
        journaled({ reason: 'cheap', confidence: 2 }, '2024-02-04'),
      ])
      renderRoute('/assets/US%3AVOO', usd)
      expect((await screen.findByText('DCA')).parentElement).toHaveClass('text-muted-foreground')
      expect(screen.getByText('โลภ').parentElement).toHaveClass('text-muted-foreground')
      const rows = within(screen.getAllByRole('table').at(-1)!).getAllByRole('row')
      expect(rows).toHaveLength(7)
      expect(rows[3]).toHaveTextContent(/^4 ก\.พ\. 2024ซื้อ1 × 410\.00/)
      expect(rows[3]).not.toHaveTextContent('·')
      expect(rows[4]).toHaveTextContent('1 × 410.00โลภ')
      expect(rows[4]).not.toHaveTextContent('·')
      expect(rows[5]).toHaveTextContent('1 × 410.00DCA')
    })

    it('puts it under the second line of a row on a phone', async () => {
      phone()
      await db.transactions.add(journaled({ strategy: 'Breakout', emotion: 'fomo' }))
      renderRoute('/assets/US%3AVOO', usd)
      const list = await screen.findByRole('list', { name: 'ทุกรายการของ VOO' })
      const line = within(list).getByText('Breakout').parentElement!
      expect(line).toHaveClass('col-span-2', 'flex', 'min-w-0', 'text-[12.5px]', 'text-muted-foreground')
      expect(line).toHaveTextContent(/^Breakout · FOMO$/)
      expect(line.previousElementSibling).toHaveTextContent('ซื้อ 1 × 410.00 · เรท 34.00')
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })

    describe('a strategy too long for the row', () => {
      const long = 'Breakout from a long consolidation on rising volume after the earnings gap'

      const expectEmotionKept = (strategy: HTMLElement) => {
        expect(strategy).toHaveAttribute('title', long)
        expect(strategy).toHaveClass('min-w-0', 'truncate')
        expect(strategy.nextElementSibling).toHaveClass('shrink-0')
        expect(strategy.nextElementSibling).toHaveTextContent('· FOMO')
      }

      it('is cut short on a computer while the emotion stays whole', async () => {
        await db.transactions.add(journaled({ strategy: long, emotion: 'fomo' }))
        renderRoute('/assets/US%3AVOO', usd)
        expectEmotionKept(await screen.findByText(long))
      })

      it('is cut short on a phone too, and the line stays a single line', async () => {
        phone()
        await db.transactions.add(journaled({ strategy: long, emotion: 'fomo' }))
        renderRoute('/assets/US%3AVOO', usd)
        const strategy = within(await screen.findByRole('list', { name: 'ทุกรายการของ VOO' })).getByText(long)
        expectEmotionKept(strategy)
        expect(strategy.parentElement).toHaveClass('col-span-2', 'flex', 'min-w-0')
        expect(strategy.parentElement).not.toHaveClass('flex-wrap')
      })
    })

    it('is left off the row of the asset that only paid the fee of the trade', async () => {
      const bnb = { id: 'CRYPTO:BNB', market: 'CRYPTO', symbol: 'BNB', name: 'BNB', assetType: 'crypto', currency: 'USD' } as const
      await db.instruments.add(bnb)
      await db.transactions.add(
        makeTx({
          instrumentId: 'US:VOO',
          quantity: '1',
          price: '410',
          fxRate: '34',
          date: '2024-02-01',
          feePaidIn: 'asset',
          feeInstrumentId: 'CRYPTO:BNB',
          feeQuantity: '0.001',
          fees: '0.6',
          journal: { strategy: 'Breakout' },
        }),
      )
      renderRoute('/assets/CRYPTO%3ABNB', usd)
      expect(await screen.findByText('ทั้งหมด 1 รายการ')).toBeInTheDocument()
      expect(screen.getByText('ซื้อ VOO · 0.001 BNB')).toBeInTheDocument()
      expect(screen.queryByText('Breakout')).not.toBeInTheDocument()
    })
  })

  it('names the receiving account on a transfer row', async () => {
    await db.instruments.add(voo)
    await db.accounts.add({ id: 'acc-2', name: 'IBKR', broker: 'IBKR', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
    await db.transactions.add(
      makeTx({ instrumentId: 'US:VOO', type: 'transfer', toAccountId: 'acc-2', quantity: '3', price: undefined, fxRate: '34', date: '2024-05-01' }),
    )
    renderRoute('/assets/US%3AVOO', usd)
    expect(await screen.findByText('ทั้งหมด 4 รายการ')).toBeInTheDocument()
    const rows = within(screen.getAllByRole('table').at(-1)!).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('1 พ.ค. 2024โอนระหว่างบัญชี3 หน่วย → IBKR')
  })

  describe('the rate of a transfer', () => {
    const fx = { fxRate: '34.12', fxSource: 'manual' } as const
    const transfer = (fees: string) =>
      makeTx({ instrumentId: 'US:VOO', type: 'transfer', toAccountId: 'acc-2', quantity: '3', price: undefined, fees, ...fx, date: '2024-05-01' })

    beforeEach(async () => {
      await db.instruments.add(voo)
      await db.accounts.add({ id: 'acc-2', name: 'IBKR', broker: 'IBKR', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
    })

    it('is shown on the row only when the transfer has a fee to value with it', async () => {
      await db.transactions.add(transfer('2'))
      renderRoute('/assets/US%3AVOO', usd)
      await screen.findByText('ทั้งหมด 4 รายการ')
      const rows = within(screen.getAllByRole('table').at(-1)!).getAllByRole('row')
      expect(rows[1]).toHaveTextContent('34.12กรอกเอง')
    })

    it('is left out of a transfer without a fee, as on the list of every transaction', async () => {
      await db.transactions.add(transfer('0'))
      renderRoute('/assets/US%3AVOO', usd)
      await screen.findByText('ทั้งหมด 4 รายการ')
      const rows = within(screen.getAllByRole('table').at(-1)!).getAllByRole('row')
      expect(rows[1]).not.toHaveTextContent('34.12')
      expect(rows[1]).not.toHaveTextContent('กรอกเอง')
    })

    it('is left out of the phone row of a transfer without a fee too', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
      await db.transactions.bulkAdd([transfer('0'), { ...transfer('2'), id: 'with-fee', date: '2024-05-02' }])
      renderRoute('/assets/US%3AVOO', usd)
      await screen.findByText('ทั้งหมด 5 รายการ')
      const items = within(screen.getByRole('list', { name: 'ทุกรายการของ VOO' })).getAllByRole('listitem')
      expect(items[0]).toHaveTextContent('เรท 34.12')
      expect(items[1]).not.toHaveTextContent('เรท')
    })
  })

  it('saves the reason for holding, the target price and the review date', async () => {
    await db.instruments.add(voo)
    const user = userEvent.setup()
    renderRoute('/assets/US%3AVOO', usd)
    await user.click(await screen.findByRole('button', { name: 'แก้ไขเหตุผลที่ถือ' }))
    await user.type(screen.getByLabelText('ทำไมถึงซื้อ / ถือ'), 'ถือยาว ทยอยซื้อทุกเดือน')
    await user.type(screen.getByLabelText('ราคาเป้าหมาย (USD)'), 'abc')
    await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(screen.getByRole('alert')).toHaveTextContent('ราคาเป้าหมายต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป')

    await user.clear(screen.getByLabelText('ราคาเป้าหมาย (USD)'))
    await user.type(screen.getByLabelText('ราคาเป้าหมาย (USD)'), '1,200')
    await user.type(screen.getByLabelText('วันทบทวน'), '2024-10-01')
    await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(await screen.findByText('1,200.00 USD')).toBeInTheDocument()
    expect(screen.getByText('ถือยาว ทยอยซื้อทุกเดือน', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('ถึงวันทบทวนแล้ว')).toBeInTheDocument()
    expect(await db.instruments.get('US:VOO')).toMatchObject({ targetPrice: '1200', reviewDate: '2024-10-01' })
  })

  it('shows a falling stock price in the loss colour', async () => {
    await db.instruments.add({ ...voo, lastPrice: '300' })
    renderRoute('/assets/US%3AVOO', usd)
    expect(await screen.findByText('จากหุ้น −28,056')).toHaveClass('bg-loss-soft')
  })

  it('closes the editor when another asset opens', async () => {
    await db.instruments.bulkAdd([voo, { id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'AAPL', assetType: 'stock', currency: 'USD' }])
    const user = userEvent.setup()
    const router = renderRoute('/assets/US%3AVOO', usd)
    await user.click(await screen.findByRole('button', { name: 'แก้ไขเหตุผลที่ถือ' }))
    expect(screen.getByLabelText('ทำไมถึงซื้อ / ถือ')).toBeInTheDocument()
    await act(() => router.navigate('/assets/US%3AAAPL'))
    expect(await screen.findByRole('heading', { name: 'AAPL' })).toBeInTheDocument()
    expect(screen.queryByLabelText('ทำไมถึงซื้อ / ถือ')).not.toBeInTheDocument()
  })

  it('gives the back link a phone-sized touch target', async () => {
    await db.instruments.add(voo)
    renderRoute('/assets/US%3AVOO', usd)
    await screen.findByRole('heading', { name: 'VOO' })
    const back = within(screen.getByRole('main')).getByRole('link', { name: 'พอร์ต' })
    expect(back).toHaveAttribute('href', '/portfolio')
    expect(back).toHaveClass('min-h-11', 'w-fit')
  })

  it('shows the transactions as two-line rows on a phone and calls an estimated rate an estimate', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    await db.instruments.add(voo)
    await db.transactions.add(makeTx({ instrumentId: 'US:VOO', quantity: '1', price: '410', fxRate: '34.12', fxSource: 'estimated', date: '2024-02-01' }))
    renderRoute('/assets/US%3AVOO', usd)
    const list = await screen.findByRole('list', { name: 'ทุกรายการของ VOO' })
    expect(within(list).getByText('ซื้อ 1 × 410.00 · เรทประมาณ 34.12')).toBeInTheDocument()
    expect(within(list).getByText('ซื้อ 10 × 400.00 · เรท 35.00')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('lists a swap on the page of the coin received as well as the coin given up', async () => {
    const btc = { id: 'CRYPTO:BTC', market: 'CRYPTO', symbol: 'BTC', name: 'Bitcoin', assetType: 'crypto', currency: 'USD' } as const
    const eth = { id: 'CRYPTO:ETH', market: 'CRYPTO', symbol: 'ETH', name: 'Ethereum', assetType: 'crypto', currency: 'USD' } as const
    await db.instruments.bulkAdd([btc, eth])
    await db.transactions.bulkAdd([
      makeTx({ instrumentId: 'CRYPTO:BTC', quantity: '0.01', price: '58000', fxRate: '34', date: '2024-03-01' }),
      makeTx({
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
    ])
    const router = renderRoute('/assets/CRYPTO%3AETH', usd)
    expect(await screen.findByRole('heading', { name: 'ETH' })).toBeInTheDocument()
    const row = (await screen.findByText('0.01 BTC → 0.25 ETH')).closest('tr')!
    expect(row.cells[1]).toHaveTextContent('แลกเหรียญ')
    expect(row.cells[4]).toHaveTextContent('−52.50')
    expect(screen.getByText('ทั้งหมด 1 รายการ')).toBeInTheDocument()
    await act(() => router.navigate('/assets/CRYPTO%3ABTC'))
    expect(await screen.findByRole('heading', { name: 'BTC' })).toBeInTheDocument()
    expect(await screen.findByText('0.01 BTC → 0.25 ETH')).toBeInTheDocument()
    expect(screen.getByText('ทั้งหมด 2 รายการ')).toBeInTheDocument()
  })

  it('lists a trade on the page of the asset its fee was paid in, and counts only that fee there', async () => {
    const bnb = { id: 'CRYPTO:BNB', market: 'CRYPTO', symbol: 'BNB', name: 'BNB', assetType: 'crypto', currency: 'USD' } as const
    const eth = { id: 'CRYPTO:ETH', market: 'CRYPTO', symbol: 'ETH', name: 'Ethereum', assetType: 'crypto', currency: 'USD' } as const
    await db.instruments.bulkAdd([bnb, eth])
    await db.transactions.bulkAdd([
      makeTx({ instrumentId: 'CRYPTO:BNB', quantity: '1', price: '500', fxRate: '34', date: '2024-01-10' }),
      makeTx({
        instrumentId: 'CRYPTO:ETH',
        quantity: '1',
        price: '2000',
        tax: '1',
        fxRate: '34',
        date: '2024-01-11',
        feePaidIn: 'asset',
        feeInstrumentId: 'CRYPTO:BNB',
        feeQuantity: '0.001',
        fees: '0.6',
      }),
      makeTx({ instrumentId: 'CRYPTO:ETH', quantity: '1', price: '2100', fxRate: '34', date: '2024-01-12', feePaidIn: 'received', feeQuantity: '0.002' }),
    ])
    const router = renderRoute('/assets/CRYPTO%3ABNB', usd)
    expect(await screen.findByRole('heading', { name: 'BNB' })).toBeInTheDocument()
    const row = (await screen.findByText('ซื้อ ETH · 0.001 BNB')).closest('tr')!
    expect(row.cells[1]).toHaveTextContent(/^จ่ายค่าธรรมเนียม$/)
    expect(row.cells[4]).toHaveTextContent(/^−20\.40$/)
    expect(row.cells[4]).toHaveClass('text-loss')
    expect(screen.queryByText(/1 × 2,000\.00/)).not.toBeInTheDocument()
    expect(screen.getByText('ทั้งหมด 2 รายการ')).toBeInTheDocument()
    expect(screen.getByText('ค่าธรรมเนียมรวม').nextSibling).toHaveTextContent('20')
    await act(() => router.navigate('/assets/CRYPTO%3AETH'))
    expect(await screen.findByRole('heading', { name: 'ETH' })).toBeInTheDocument()
    expect(await screen.findByText('1 × 2,100.00 · หัก 0.002 ETH')).toBeInTheDocument()
    expect(screen.getByText('ทั้งหมด 2 รายการ')).toBeInTheDocument()
  })

  it('describes the payment of a fee the same way on a phone, in the loss colour', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    await db.instruments.add({ id: 'CRYPTO:BNB', market: 'CRYPTO', symbol: 'BNB', name: 'BNB', assetType: 'crypto', currency: 'USD' })
    await db.transactions.bulkAdd([
      makeTx({ instrumentId: 'CRYPTO:BNB', quantity: '1', price: '500', fxRate: '34', date: '2024-01-10' }),
      makeTx({ instrumentId: 'CRYPTO:ETH', quantity: '1', price: '2000', fxRate: '34', date: '2024-01-11', feePaidIn: 'asset', feeInstrumentId: 'CRYPTO:BNB', feeQuantity: '0.001', fees: '0.6' }),
    ])
    renderRoute('/assets/CRYPTO%3ABNB', usd)
    const list = await screen.findByRole('list', { name: 'ทุกรายการของ BNB' })
    const item = within(list).getByText(/^จ่ายค่าธรรมเนียม ซื้อ ETH · 0\.001 BNB/).closest('li')!
    expect(within(item).getByText('−20.40')).toHaveClass('text-loss')
    expect(within(list).getByText(/^ซื้อ 1 × 500\.00/)).toBeInTheDocument()
  })

  it('repeats the latest buy of this asset from its page', async () => {
    await db.instruments.add(voo)
    await db.transactions.bulkAdd([
      makeTx({ id: 'voo-latest', instrumentId: 'US:VOO', quantity: '1', price: '470', date: '2024-05-01' }),
      makeTx({ id: 'voo-elsewhere', accountId: 'acc-2', instrumentId: 'US:VOO', quantity: '1', price: '460', date: '2024-02-01' }),
      makeTx({ id: 'paid-in-voo', instrumentId: 'CRYPTO:ETH', quantity: '1', price: '500', date: '2024-06-01', feePaidIn: 'asset', feeInstrumentId: 'US:VOO', feeQuantity: '0.001' }),
    ])
    renderRoute('/assets/US%3AVOO', usd)
    await screen.findByRole('heading', { name: 'VOO' })
    const link = screen.getByRole('link', { name: 'ทำซ้ำรายการซื้อ' })
    expect(link).toHaveAttribute('href', '/transactions/new?from=voo-latest')
    expect(link).toHaveClass('h-11', 'md:h-[34px]')
    expect(link.compareDocumentPosition(screen.getByRole('region', { name: 'VOO' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('picks the latest buy among every account', async () => {
    await db.instruments.add(voo)
    await db.transactions.add(makeTx({ id: 'voo-other-account', accountId: 'acc-2', instrumentId: 'US:VOO', quantity: '1', price: '470', date: '2024-05-01' }))
    renderRoute('/assets/US%3AVOO', usd)
    expect(await screen.findByRole('link', { name: 'ทำซ้ำรายการซื้อ' })).toHaveAttribute('href', '/transactions/new?from=voo-other-account')
  })

  it('offers no repeat when the asset was never bought', async () => {
    await db.transactions.clear()
    await db.instruments.add(voo)
    await db.transactions.add(makeTx({ instrumentId: 'US:VOO', type: 'dividend', quantity: undefined, price: undefined, amount: '20', fxRate: '34', date: '2024-03-01' }))
    renderRoute('/assets/US%3AVOO', usd)
    await screen.findByRole('heading', { name: 'VOO' })
    expect(screen.queryByRole('link', { name: 'ทำซ้ำรายการซื้อ' })).not.toBeInTheDocument()
  })

  describe('rename', () => {
    const fb = { id: 'US:FB', market: 'US', symbol: 'FB', name: 'Facebook', assetType: 'stock', currency: 'USD', lastPrice: '300' } as const
    const rename = async (user: ReturnType<typeof userEvent.setup>, symbol: string, name: string) => {
      await user.click(await screen.findByRole('button', { name: 'เปลี่ยนชื่อ/สัญลักษณ์' }))
      await user.clear(screen.getByLabelText('สัญลักษณ์'))
      await user.type(screen.getByLabelText('สัญลักษณ์'), symbol)
      await user.clear(screen.getByLabelText('ชื่อ'))
      await user.type(screen.getByLabelText('ชื่อ'), name)
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    }

    beforeEach(async () => {
      await db.instruments.add(fb)
      await db.transactions.bulkAdd([
        makeTx({ instrumentId: 'US:FB', quantity: '5', price: '280', fxRate: '35', date: '2024-02-01' }),
        makeTx({ instrumentId: 'US:FB', type: 'dividend', quantity: undefined, price: undefined, amount: '4', fxRate: '34', date: '2024-03-01' }),
      ])
    })

    it('renames an asset and lands on its new page with the history', async () => {
      const user = userEvent.setup()
      const router = renderRoute('/assets/US%3AFB', usd)
      await rename(user, 'META', 'Meta Platforms')
      expect(await screen.findByRole('heading', { name: 'META' })).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/assets/US%3AMETA')
      expect(router.state.historyAction).toBe('REPLACE')
      // A well-formed id opens at once, so the renamed record may arrive a moment after the new address.
      expect(await screen.findByText('เดิม: FB')).toBeInTheDocument()
      expect(screen.getByText('Meta Platforms')).toBeInTheDocument()
      expect(screen.queryByLabelText('สัญลักษณ์')).not.toBeInTheDocument()
      expect(await screen.findByText('ทั้งหมด 2 รายการ')).toBeInTheDocument()
      const rows = within(screen.getAllByRole('table').at(-1)!).getAllByRole('row')
      expect(rows[2]).toHaveTextContent('5 × 280.00')
      expect(await db.instruments.get('US:FB')).toBeUndefined()
    })

    it('shows the problem under the form and stays on the page when the symbol is taken', async () => {
      await db.instruments.add({ ...fb, id: 'US:META', symbol: 'META', name: 'Meta' })
      const user = userEvent.setup()
      const router = renderRoute('/assets/US%3AFB', usd)
      await rename(user, 'meta', 'Meta Platforms')
      expect(await screen.findByRole('alert')).toHaveTextContent('มี META อยู่แล้ว · รวมสินทรัพย์สองตัวยังทำไม่ได้')
      expect(router.state.location.pathname).toBe('/assets/US%3AFB')
      expect(screen.getByRole('heading', { name: 'FB' })).toBeInTheDocument()
      expect(screen.getByLabelText('สัญลักษณ์')).toHaveValue('meta')
      expect((await db.transactions.toArray()).filter((t) => t.instrumentId === 'US:FB')).toHaveLength(2)
    })

    it('reports a symbol with a space without leaving the page', async () => {
      const user = userEvent.setup()
      const router = renderRoute('/assets/US%3AFB', usd)
      await rename(user, 'ME TA', 'Meta')
      expect(await screen.findByRole('alert')).toHaveTextContent('สัญลักษณ์ห้ามมีช่องว่างหรือเครื่องหมาย :')
      expect(router.state.location.pathname).toBe('/assets/US%3AFB')
    })

    it('starts from the current symbol, name and unit, and closes on cancel', async () => {
      const user = userEvent.setup()
      renderRoute('/assets/US%3AFB', usd)
      await user.click(await screen.findByRole('button', { name: 'เปลี่ยนชื่อ/สัญลักษณ์' }))
      expect(screen.getByLabelText('สัญลักษณ์')).toHaveValue('FB')
      expect(screen.getByLabelText('สัญลักษณ์')).toHaveAttribute('autocapitalize', 'characters')
      expect(screen.getByLabelText('ชื่อ')).toHaveValue('Facebook')
      expect(screen.getByLabelText('หน่วยนับ')).toHaveDisplayValue('หุ้น')
      await user.click(screen.getByRole('button', { name: 'ยกเลิก' }))
      expect(screen.queryByLabelText('สัญลักษณ์')).not.toBeInTheDocument()
      expect(screen.queryByText(/^เดิม:/)).not.toBeInTheDocument()
    })

    it('changes the unit in place, on the same page', async () => {
      const user = userEvent.setup()
      const router = renderRoute('/assets/US%3AFB', usd)
      await user.click(await screen.findByRole('button', { name: 'เปลี่ยนชื่อ/สัญลักษณ์' }))
      await user.selectOptions(screen.getByLabelText('หน่วยนับ'), 'หน่วย')
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      expect(await screen.findByText(/^มูลค่าวันนี้ · 5 หน่วย ×/)).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/assets/US%3AFB')
      expect(screen.queryByLabelText('หน่วยนับ')).not.toBeInTheDocument()
      expect(await db.instruments.get('US:FB')).toMatchObject({ unit: 'unit', name: 'Facebook' })
      expect((await db.instruments.get('US:FB'))?.previousSymbols).toBeUndefined()
    })

    it('does not show a line for old symbols when there are none', async () => {
      renderRoute('/assets/US%3AFB', usd)
      await screen.findByRole('heading', { name: 'FB' })
      expect(screen.queryByText(/^เดิม:/)).not.toBeInTheDocument()
    })

    it('lists every old symbol, oldest first', async () => {
      await db.instruments.update('US:FB', { previousSymbols: ['TFB', 'FB0'] })
      renderRoute('/assets/US%3AFB', usd)
      expect(await screen.findByText('เดิม: TFB, FB0')).toBeInTheDocument()
    })

    it('keeps the rename button next to the repeat button, each phone-sized, and offers it without a buy', async () => {
      renderRoute('/assets/US%3AFB', usd)
      const button = await screen.findByRole('button', { name: 'เปลี่ยนชื่อ/สัญลักษณ์' })
      const repeat = screen.getByRole('link', { name: 'ทำซ้ำรายการซื้อ' })
      expect(button.parentElement).toBe(repeat.parentElement)
      expect(button).toHaveClass('h-11', 'max-md:w-11')
      expect(repeat).toHaveClass('h-11')

      await db.transactions.clear()
      await db.transactions.add(makeTx({ instrumentId: 'US:FB', type: 'dividend', quantity: undefined, price: undefined, amount: '4', fxRate: '34' }))
      await waitFor(() => expect(screen.queryByRole('link', { name: 'ทำซ้ำรายการซื้อ' })).not.toBeInTheDocument())
      expect(screen.getByRole('button', { name: 'เปลี่ยนชื่อ/สัญลักษณ์' })).toBeInTheDocument()
    })

    it('never clips the symbol: only the name shrinks, and the actions wrap when they do not fit', async () => {
      renderRoute('/assets/US%3AFB', usd)
      const title = await screen.findByRole('heading', { name: 'FB' })
      expect(title).toHaveClass('shrink-0')
      expect(title).not.toHaveClass('truncate')
      expect(title.closest('div')).toHaveClass('flex-nowrap', 'min-w-0')
      expect(screen.getByText('Facebook')).toHaveClass('truncate')
      const actions = screen.getByRole('button', { name: 'เปลี่ยนชื่อ/สัญลักษณ์' }).parentElement!
      expect(actions).toHaveClass('ml-auto')
      expect(actions.parentElement).toHaveClass('flex-wrap')
    })

    it('turns the repeat link into a 44px icon below 360px without losing its name', async () => {
      renderRoute('/assets/US%3AFB', usd)
      const repeat = await screen.findByRole('link', { name: 'ทำซ้ำรายการซื้อ' })
      expect(repeat).toHaveClass('h-11', 'max-[360px]:w-11', 'max-[360px]:px-0')
      expect(within(repeat).getByText('ทำซ้ำรายการซื้อ')).toHaveClass('max-[360px]:sr-only')
    })

    it('opens and closes the form from the same button and shows it pressed while open', async () => {
      const user = userEvent.setup()
      renderRoute('/assets/US%3AFB', usd)
      const button = await screen.findByRole('button', { name: 'เปลี่ยนชื่อ/สัญลักษณ์' })
      expect(button).toHaveAttribute('aria-expanded', 'false')
      expect(button).toHaveClass('aria-expanded:bg-muted')
      await user.click(button)
      expect(button).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByLabelText('สัญลักษณ์')).toBeInTheDocument()
      await user.click(button)
      expect(button).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByLabelText('สัญลักษณ์')).not.toBeInTheDocument()
    })

    it('shows no line for old symbols when the list is empty', async () => {
      await db.instruments.update('US:FB', { previousSymbols: [] })
      renderRoute('/assets/US%3AFB', usd)
      const header = await screen.findByRole('region', { name: 'FB' })
      expect(screen.queryByText(/^เดิม:/)).not.toBeInTheDocument()
      expect(within(header).queryByText('0')).not.toBeInTheDocument()
    })

    it('closes the form when another asset opens', async () => {
      await db.instruments.add(voo)
      const user = userEvent.setup()
      const router = renderRoute('/assets/US%3AFB', usd)
      await user.click(await screen.findByRole('button', { name: 'เปลี่ยนชื่อ/สัญลักษณ์' }))
      expect(screen.getByLabelText('สัญลักษณ์')).toBeInTheDocument()
      await act(() => router.navigate('/assets/US%3AVOO'))
      expect(await screen.findByRole('heading', { name: 'VOO' })).toBeInTheDocument()
      expect(screen.queryByLabelText('สัญลักษณ์')).not.toBeInTheDocument()
      await act(() => router.navigate('/assets/US%3AFB'))
      expect(await screen.findByRole('heading', { name: 'FB' })).toBeInTheDocument()
      expect(screen.queryByLabelText('สัญลักษณ์')).not.toBeInTheDocument()
    })
  })

  it('says so for a malformed id', async () => {
    renderRoute('/assets/NOPE')
    expect(await screen.findByText('ไม่พบสินทรัพย์นี้')).toBeInTheDocument()
  })

  describe('research sections', () => {
    const filings = {
      symbol: 'AAPL',
      name: 'Apple Inc.',
      currency: 'USD' as const,
      shares: '15000000000',
      annual: [{ period: 'CY2025', end: '2025-09-27', revenue: '416000000000', netIncome: '112000000000', freeCashFlow: '98000000000' }],
      quarterly: [],
    }

    it('offers only the sections a Thai share has', async () => {
      await db.instruments.add({ id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'PTT', assetType: 'stock', currency: 'THB', lastPrice: '42' })
      await db.transactions.add(makeTx({ instrumentId: 'SET:PTT', currency: 'THB', fxRate: '1', fxSource: 'same', quantity: '100', price: '40' }))
      renderRoute('/assets/SET%3APTT', usd)
      await screen.findByRole('region', { name: 'PTT' })
      expect(screen.queryByRole('navigation', { name: 'ส่วนของหน้า' })).not.toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'งบการเงิน' })).not.toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'ข่าว' })).not.toBeInTheDocument()
    })

    it('jumps to a section from its chip', async () => {
      vi.spyOn(marketClient, 'financials').mockResolvedValue(filings)
      vi.spyOn(marketClient, 'news').mockResolvedValue([])
      const scrolled: string[] = []
      // jsdom does not lay pages out, so it has no scrollIntoView to watch.
      Element.prototype.scrollIntoView ??= () => {}
      vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
        scrolled.push(this.id)
      })
      await db.instruments.add({ id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD', lastPrice: '346' })
      await db.transactions.add(makeTx({ instrumentId: 'US:AAPL', quantity: '2', price: '300' }))
      const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
      renderRoute('/assets/US%3AAAPL', usd)
      const chips = await screen.findByRole('navigation', { name: 'ส่วนของหน้า' })
      expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['ของฉัน', 'งบ', 'มูลค่า', 'ข่าว'])
      expect(await screen.findByRole('region', { name: 'งบการเงิน' })).toBeInTheDocument()
      await user.click(within(chips).getByRole('button', { name: 'มูลค่า' }))
      expect(scrolled).toEqual(['stock-value'])
      expect(within(chips).getByRole('button', { name: 'มูลค่า' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('hides the filings of a fund with none at SEC', async () => {
      vi.spyOn(marketClient, 'financials').mockRejectedValue(new MarketError(404))
      vi.spyOn(marketClient, 'news').mockResolvedValue([])
      renderRoute('/assets/US%3AQQQ', usd)
      await screen.findByRole('region', { name: 'QQQ' })
      expect(await screen.findByRole('region', { name: 'ข่าว' })).toBeInTheDocument()
      await waitFor(() => expect(screen.queryByRole('region', { name: 'งบการเงิน' })).not.toBeInTheDocument())
    })
  })

  describe('an asset the app does not know', () => {
    const nvidia = { id: 'US:NVDA', name: 'NVIDIA Corporation', exchange: 'NasdaqGS', assetType: 'stock' as const, currency: 'USD', points: [] }

    it('opens a well-formed asset the app does not know, with a way to record a buy', async () => {
      vi.spyOn(marketClient, 'chart').mockResolvedValue(nvidia)
      vi.spyOn(marketClient, 'quotes').mockResolvedValue([
        { id: 'US:NVDA', price: '140', currency: 'USD', at: '2024-10-16T01:00:00.000Z', previousClose: '137', previousCloseAt: '2024-10-15T13:30:00.000Z', source: 'Yahoo' },
      ])
      renderRoute('/assets/US%3ANVDA', usd)
      const board = await screen.findByRole('region', { name: 'NVDA' })
      expect(await within(board).findByText('NVIDIA Corporation · NasdaqGS')).toBeInTheDocument()
      expect(board).toHaveTextContent('140.00')
      expect(screen.getByRole('link', { name: 'บันทึกการซื้อ' })).toHaveAttribute(
        'href',
        '/transactions/new?type=buy&market=US&symbol=NVDA&name=NVIDIA+Corporation&assetType=stock',
      )
      expect(within(screen.getByRole('main')).getByRole('link', { name: 'ตลาด' })).toHaveAttribute('href', '/market')
      expect(screen.queryByText('ไม่พบสินทรัพย์นี้')).not.toBeInTheDocument()
    })

    it('still opens a coin with no market data, with the market’s own asset type in the buy', async () => {
      renderRoute('/assets/CRYPTO%3ASOL', usd)
      expect(await screen.findByRole('heading', { level: 1, name: 'SOL' })).toBeInTheDocument()
      expect(screen.getByText('ยังไม่มีราคา')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'บันทึกการซื้อ' }).getAttribute('href')).toContain('market=CRYPTO&symbol=SOL&name=SOL&assetType=crypto')
    })

    it('watches and unwatches from the star', async () => {
      const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
      renderRoute('/assets/US%3ANVDA', usd)
      const star = await screen.findByRole('button', { name: 'จับตา' })
      expect(star).toHaveAttribute('aria-pressed', 'false')
      await user.click(star)
      await waitFor(() => expect(star).toHaveAttribute('aria-pressed', 'true'))
      expect((await db.watchlist.toArray()).map((w) => [w.market, w.symbol])).toEqual([['US', 'NVDA']])
      await user.click(star)
      await waitFor(() => expect(star).toHaveAttribute('aria-pressed', 'false'))
      expect(await db.watchlist.count()).toBe(0)
    })
  })
})

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import type { Instrument } from '../../domain/types'
import { fakeFxProvider } from '../../test/fakeFx'
import { makeTx } from '../../test/fixtures'
import { renderRoute, resetDb } from '../../test/render'

const account = { id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2025-01-01T00:00:00.000Z' }
const baht = { currency: 'THB', fxRate: '1', fxSource: 'same' as const, instrumentId: undefined, quantity: undefined, price: undefined }
const usd = (rate = '33') => fakeFxProvider({ 'USD|THB': rate }).provider

const aapl = (overrides: Partial<Instrument> = {}): Instrument => ({
  id: 'US:AAPL',
  market: 'US',
  symbol: 'AAPL',
  name: 'Apple',
  assetType: 'stock',
  currency: 'USD',
  lastPrice: '120',
  ...overrides,
})

const exchange = (amount: string, marketRate: string | undefined, date: string, toAmount = '1000') =>
  makeTx({ ...baht, type: 'fx_convert', amount, toCurrency: 'USD', toAmount, marketRate, date })

// 100,000 baht in, two exchanges into 2,000 USD, 5 AAPL bought for 501 USD at 34 and 20,000 baht sent home.
// The USD left in cash is 1,499 at a cost of 50,741.15, and AAPL at 120 is 600 USD.
async function seedFx() {
  await db.accounts.add(account)
  await db.instruments.add(aapl())
  await db.transactions.bulkAdd([
    makeTx({ ...baht, type: 'deposit', amount: '100000', date: '2026-08-01' }),
    exchange('33700', '33.52', '2026-09-02'),
    exchange('34000', '33.5', '2026-10-16'),
    makeTx({ type: 'buy', quantity: '5', price: '100', fees: '1', fxRate: '34', date: '2026-10-17' }),
    makeTx({ ...baht, type: 'withdraw', amount: '20000', remitToThailand: true, taxYear: 2026, date: '2026-10-18' }),
  ])
}

const stubWidth = (px: number) =>
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: Number(/\d+/.exec(query)?.[0]) <= px,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
const phone = () => stubWidth(0)

const board = () => screen.findByRole('region', { name: 'กระดานเรทของคุณ' })
const card = (name: string) => screen.findByRole('region', { name })
// The sentence is several no-wrap parts, so it is found by the text of the line that holds them.
const sentence = (scope: HTMLElement, text: string) =>
  within(scope).getByText((_, el) => el?.tagName === 'P' && el.textContent?.replaceAll('\u00A0', ' ') === text)
// A summary line is a label and the figure beside it.
const figure = (scope: HTMLElement, label: string) => within(scope).getByText(label).nextElementSibling

beforeEach(resetDb)
afterEach(() => vi.unstubAllGlobals())

describe('FxPage', () => {
  it('names the mid rate the board is read against beside the title', async () => {
    await seedFx()
    renderRoute('/fx', usd())
    expect(await screen.findByRole('heading', { level: 1, name: 'ค่าเงิน' })).toBeInTheDocument()
    expect(await screen.findByText('เรทกลาง ECB 15 ม.ค. 2024')).toBeInTheDocument()
  })

  describe('the rate board', () => {
    it('says what the currency did to the portfolio, from the assets and from the cash held', async () => {
      await seedFx()
      renderRoute('/fx', usd())
      expect(
        sentence(await board(), 'ค่าเงินทำให้พอร์ตลดลง −600 ฿ จากสินทรัพย์ และ −1,274 ฿ จากเงินสดที่ถืออยู่'),
      ).toBeInTheDocument()
    })

    it('lists each currency with the Thai name, what is held, both rates, the gap and the effect in whole baht', async () => {
      await seedFx()
      renderRoute('/fx', usd())
      const [row] = within(await board()).getAllByRole('listitem')
      const text = within(row)
      expect(text.getByText('USD')).toBeInTheDocument()
      expect(text.getByText('ดอลลาร์สหรัฐ')).toBeInTheDocument()
      expect(text.getByText('600 USD')).toBeInTheDocument()
      expect(text.getByText('34.00')).toBeInTheDocument()
      expect(text.getByText(/33\.00/)).toBeInTheDocument()
      expect(text.getByText('ECB 15 ม.ค. 2024')).toBeInTheDocument()
      expect(text.getByText('−2.94%')).toBeInTheDocument()
      expect(text.getByText('−600 ฿')).toBeInTheDocument()
    })

    it('has the column named for what is held between the currency and the average rate', async () => {
      await seedFx()
      renderRoute('/fx', usd())
      const heads = within(await board()).getByText('สกุลที่ถือ').parentElement!
      expect([...heads.children].map((cell) => cell.textContent)).toEqual([
        'สกุลที่ถือ',
        'ถืออยู่',
        'เรทเฉลี่ยของคุณ',
        'เรทวันนี้',
        'ส่วนต่าง',
        'ผลต่อพอร์ต',
      ])
    })

    it('puts six columns on a board that is wide enough and stacks the rows below that', async () => {
      await seedFx()
      renderRoute('/fx', usd())
      const wide = await board()
      expect(wide).toHaveClass('@container')
      expect(within(wide).getAllByRole('listitem')[0]).toHaveClass('@min-[800px]:grid-cols-[176px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_100px_132px]')
    })

    it('says "increased" when the sum of both parts is a gain, and leads with whichever part it has', async () => {
      await seedFx()
      renderRoute('/fx', usd('36'))
      expect(
        sentence(await board(), 'ค่าเงินทำให้พอร์ตเพิ่มขึ้น +1,200 ฿ จากสินทรัพย์ และ +3,223 ฿ จากเงินสดที่ถืออยู่'),
      ).toBeInTheDocument()
    })

    it('picks the direction from the sum of the two parts', async () => {
      await db.accounts.add(account)
      await db.instruments.add(aapl())
      await db.transactions.bulkAdd([
        makeTx({ ...baht, type: 'deposit', amount: '100000', date: '2026-08-01' }),
        exchange('30000', '30', '2026-09-02'),
        makeTx({ type: 'buy', quantity: '5', price: '100', fees: '1', fxRate: '34', date: '2026-10-17' }),
      ])
      renderRoute('/fx', usd())
      expect(
        sentence(await board(), 'ค่าเงินทำให้พอร์ตเพิ่มขึ้น −600 ฿ จากสินทรัพย์ และ +1,497 ฿ จากเงินสดที่ถืออยู่'),
      ).toBeInTheDocument()
    })

    it('drops the part that has no priced asset and counts an unpriced holding at its cost', async () => {
      await seedFx()
      await db.instruments.put(aapl({ lastPrice: undefined }))
      renderRoute('/fx', usd())
      const wide = await board()
      expect(sentence(wide, 'ค่าเงินทำให้พอร์ตลดลง −1,274 ฿ จากเงินสดที่ถืออยู่')).toBeInTheDocument()
      expect(within(within(wide).getAllByRole('listitem')[0]).getByText('501 USD')).toBeInTheDocument()
    })

    it('drops the part that is exactly nothing', async () => {
      await db.accounts.add(account)
      await db.instruments.add(aapl())
      await db.transactions.bulkAdd([
        makeTx({ ...baht, type: 'deposit', amount: '100000', date: '2026-08-01' }),
        exchange('33000', '33', '2026-09-02'),
        makeTx({ type: 'buy', quantity: '5', price: '100', fees: '1', fxRate: '34', date: '2026-10-17' }),
      ])
      renderRoute('/fx', usd())
      expect(sentence(await board(), 'ค่าเงินทำให้พอร์ตลดลง −600 ฿ จากสินทรัพย์')).toBeInTheDocument()
    })

    it('keeps no board when no foreign asset is held and puts the sentence at the top of the cash card instead', async () => {
      await db.accounts.add(account)
      await db.transactions.bulkAdd([
        makeTx({ ...baht, type: 'deposit', amount: '100000', date: '2026-08-01' }),
        exchange('34000', '33.5', '2026-10-16'),
      ])
      renderRoute('/fx', usd())
      const cash = await card('เงินสดต่างประเทศ')
      expect(screen.queryByRole('region', { name: 'กระดานเรทของคุณ' })).not.toBeInTheDocument()
      const line = sentence(cash, 'ค่าเงินทำให้พอร์ตลดลง −1,000 ฿ จากเงินสดที่ถืออยู่')
      expect(line).toHaveClass('text-muted-foreground')
      expect(cash.firstElementChild?.nextElementSibling).toBe(line)
    })

    it('keeps each part of the sentence whole, so no word is left alone at the end of a line', async () => {
      await seedFx()
      renderRoute('/fx', usd())
      const line = sentence(await board(), 'ค่าเงินทำให้พอร์ตลดลง −600 ฿ จากสินทรัพย์ และ −1,274 ฿ จากเงินสดที่ถืออยู่')
      const parts = [...line.querySelectorAll('.whitespace-nowrap')].map((part) => part.textContent)
      expect(parts).toEqual(['ค่าเงินทำให้พอร์ตลดลง', '−600\u00A0฿\u00A0จากสินทรัพย์', '−1,274\u00A0฿\u00A0จากเงินสดที่ถืออยู่'])
    })

    it('shows the cash sentence only on the board when there is a board', async () => {
      await seedFx()
      renderRoute('/fx', usd())
      const cash = await card('เงินสดต่างประเทศ')
      expect(within(cash).queryByText((_, el) => el?.tagName === 'P' && el.textContent?.includes('ค่าเงินทำให้พอร์ต') === true)).not.toBeInTheDocument()
    })

    it('stacks a row as the currency on one line and the rates with the effect on the next', async () => {
      await seedFx()
      renderRoute('/fx', usd())
      const [row] = within(await board()).getAllByRole('listitem')
      expect(row).toHaveClass('flex', 'flex-col', '@min-[800px]:grid')
      const [first, second] = [...row.children]
      expect(first).toHaveClass('flex', '@min-[800px]:contents')
      expect(second).toHaveClass('flex', 'flex-wrap', '@min-[800px]:contents')
      const [currency, held, gap] = [...first.children]
      const [rates, effect] = [...second.children]
      expect(currency).toHaveClass('flex-1', 'min-w-0')
      expect(held).toHaveClass('hidden', '@min-[320px]:block')
      expect(gap).toHaveClass('text-right', '@min-[800px]:order-1')
      expect(rates).toHaveClass('whitespace-nowrap')
      expect(effect).toHaveClass('ml-auto', 'text-right', '@min-[800px]:order-2')
    })

    it('keeps the rate pair on one line and lets the effect drop below it instead', async () => {
      await seedFx()
      renderRoute('/fx', usd())
      const [row] = within(await board()).getAllByRole('listitem')
      const [rates, effect] = [...row.children[1].children]
      expect(rates).toHaveClass('whitespace-nowrap')
      expect(rates.parentElement).toHaveClass('flex-wrap')
      expect(effect).toHaveTextContent('−600 ฿')
    })

    it('sets a rate below one at base size when stacked and 24px in the columns, and keeps the line height', async () => {
      await seedFx()
      await db.instruments.add({ id: 'JP:7203', market: 'JP', symbol: '7203', name: 'Toyota', assetType: 'stock', currency: 'JPY', lastPrice: '3000' })
      await db.transactions.add(
        makeTx({ instrumentId: 'JP:7203', currency: 'JPY', quantity: '100', price: '2900', fxRate: '0.22', date: '2026-10-17' }),
      )
      renderRoute('/fx', fakeFxProvider({ 'USD|THB': '33', 'JPY|THB': '0.216348' }).provider)
      const rows = within(await board()).getAllByRole('listitem')
      const rateOf = (row: HTMLElement) => row.children[1].children[0]
      expect(within(rows[0]).getByText('0.216348')).toBeInTheDocument()
      expect(rateOf(rows[0])).toHaveClass('text-base', '@min-[800px]:text-2xl', 'leading-tight')
      expect(rateOf(rows[0])).not.toHaveClass('text-lg')
      expect(rateOf(rows[0])).not.toHaveClass('text-[22px]')
      expect(rateOf(rows[0])).not.toHaveClass('@min-[800px]:text-[34px]')
      expect(rateOf(rows[1])).toHaveClass('text-[22px]', '@min-[800px]:text-[34px]', 'leading-tight')
    })
  })

  describe('foreign cash', () => {
    it('shows each account and currency with its amount, cost, value today and currency effect', async () => {
      await seedFx()
      renderRoute('/fx', usd())
      const cash = await card('เงินสดต่างประเทศ')
      const [, row] = within(cash).getAllByRole('row')
      const cells = within(row).getAllByRole('cell')
      expect(cells.map((cell) => cell.textContent)).toEqual(['USDDime US', '1,499 USD', '50,741', '49,467', '−1,274'])
      expect(cells[4]).toHaveClass('text-fx')
      expect(within(cash).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
        'บัญชี',
        'จำนวน',
        'ต้นทุน (฿)',
        'มูลค่าวันนี้ (฿)',
        'ผลค่าเงิน (฿)',
      ])
    })

    it('lets a long account name wrap to two lines beside its pill instead of cutting it off', async () => {
      await seedFx()
      await db.accounts.put({ ...account, name: 'Interactive Brokers (Thailand) Securities Company' })
      renderRoute('/fx', usd())
      const cash = await card('เงินสดต่างประเทศ')
      const [label] = within(cash).getAllByRole('cell')
      const name = within(label).getByText('Interactive Brokers (Thailand) Securities Company')
      expect(name).toHaveClass('line-clamp-2', 'break-words', 'whitespace-normal')
      expect(name).not.toHaveClass('truncate')
      expect(name.parentElement).toHaveClass('flex-wrap')
      expect(label).not.toHaveClass('max-w-56')
    })

    it('does the same for the list on a phone', async () => {
      phone()
      await seedFx()
      await db.accounts.put({ ...account, name: 'Interactive Brokers (Thailand) Securities Company' })
      renderRoute('/fx', usd())
      const [row] = within(await card('เงินสดต่างประเทศ')).getAllByRole('listitem')
      const name = within(row).getByText('Interactive Brokers (Thailand) Securities Company')
      expect(name).toHaveClass('line-clamp-2', 'break-words')
      expect(name.parentElement).toHaveClass('flex-wrap')
    })

    it('says under the heading that only the cash still held is counted', async () => {
      await seedFx()
      renderRoute('/fx', usd())
      const cash = await card('เงินสดต่างประเทศ')
      const hint = within(cash).getByText('เฉพาะเงินสดที่ยังถืออยู่ · ไม่รวมส่วนที่ใช้ไปแล้ว')
      expect(hint).toHaveClass('text-muted-foreground')
      expect(hint.previousElementSibling).toContainElement(within(cash).getByRole('heading', { name: 'เงินสดต่างประเทศ' }))
    })

    it('is left out when the only cash is in baht', async () => {
      await db.accounts.add(account)
      await db.transactions.add(makeTx({ ...baht, type: 'deposit', amount: '1000', date: '2026-08-01' }))
      await db.instruments.add(aapl())
      await db.transactions.add(makeTx({ type: 'buy', quantity: '1', price: '100', fxRate: '34', date: '2026-08-02' }))
      renderRoute('/fx', usd())
      await board()
      expect(screen.queryByRole('region', { name: 'เงินสดต่างประเทศ' })).not.toBeInTheDocument()
    })
  })

  describe('amounts with decimals', () => {
    async function seedFractional() {
      await db.accounts.add(account)
      await db.transactions.bulkAdd([
        makeTx({ ...baht, type: 'deposit', amount: '100000', date: '2026-08-01' }),
        exchange('50000', '33.39', '2026-08-05', '1491.2'),
      ])
    }

    it('writes an exchanged amount with both decimals unless it is whole', async () => {
      await seedFractional()
      renderRoute('/fx', usd())
      const history = await card('ประวัติการแลกเงิน')
      expect(within(history).getAllByRole('cell')[1]).toHaveTextContent('50,000 THB → 1,491.20 USD')
      const summary = await card('สรุปการแลกเงิน')
      expect(figure(summary, 'THB → USD')).toHaveTextContent('1 ครั้ง · 50,000 → 1,491.20')
      const cash = await card('เงินสดต่างประเทศ')
      expect(within(cash).getAllByRole('cell')[1]).toHaveTextContent('1,491.20 USD')
    })

    it('writes the same amounts the same way on a phone', async () => {
      phone()
      await seedFractional()
      renderRoute('/fx', usd())
      expect(within(await card('ประวัติการแลกเงิน')).getByRole('listitem')).toHaveTextContent('50,000 → 1,491.20 USD')
      expect(within(await card('เงินสดต่างประเทศ')).getByRole('listitem')).toHaveTextContent('1,491.20 USD · ต้นทุน')
    })
  })

  describe('exchange summary', () => {
    it('totals each pair with the average rate, the average spread over the mid rate and the baht lost to it', async () => {
      await seedFx()
      renderRoute('/fx', usd())
      const summary = await card('สรุปการแลกเงิน')
      expect(within(summary).getByText('THB → USD')).toBeInTheDocument()
      expect(figure(summary, 'THB → USD')).toHaveTextContent('2 ครั้ง · 67,700 → 2,000')
      expect(figure(summary, 'เรทเฉลี่ยที่ได้')).toHaveTextContent('33.85')
      expect(figure(summary, 'แพงกว่าเรทกลางเฉลี่ย')).toHaveTextContent('+1.01%')
      expect(figure(summary, 'spread ที่เสียไปรวม')).toHaveTextContent('≈ 680 บาท')
      expect(within(summary).getByText('≈ 680 บาท')).toHaveClass('text-loss')
    })

    it('puts the rule and the room between one pair and the next, and none above the first', async () => {
      await seedFx()
      await db.transactions.add(makeTx({ ...baht, type: 'fx_convert', amount: '10000', toCurrency: 'JPY', toAmount: '45000', date: '2026-09-10' }))
      renderRoute('/fx', usd())
      const summary = await card('สรุปการแลกเงิน')
      const pairs = summary.querySelectorAll('dl')
      expect(pairs).toHaveLength(2)
      const wrapper = pairs[0].parentElement!
      expect(pairs[1].parentElement).toBe(wrapper)
      expect(wrapper.firstElementChild).toBe(pairs[0])
      expect(wrapper).toHaveClass('[&>dl+dl]:mt-3', '[&>dl+dl]:border-t', '[&>dl+dl]:border-muted')
      expect([...wrapper.querySelectorAll(':scope > dl + dl')]).toEqual([pairs[1]])
      expect(pairs[0]).not.toHaveClass('mt-3')
      expect(pairs[0]).not.toHaveClass('border-t')
    })

    it('says cheaper than the mid rate, with the size of it, when the average spread is negative', async () => {
      await db.accounts.add(account)
      await db.transactions.bulkAdd([
        makeTx({ ...baht, type: 'deposit', amount: '100000', date: '2026-08-01' }),
        exchange('33000', '33.5', '2026-10-16'),
      ])
      renderRoute('/fx', usd())
      const summary = await card('สรุปการแลกเงิน')
      expect(figure(summary, 'ถูกกว่าเรทกลางเฉลี่ย')).toHaveTextContent(/^1\.49%$/)
      expect(within(summary).queryByText('แพงกว่าเรทกลางเฉลี่ย')).not.toBeInTheDocument()
    })

    it('shows a dash for the spread when no exchange had a market rate', async () => {
      await db.accounts.add(account)
      await db.transactions.bulkAdd([
        makeTx({ ...baht, type: 'deposit', amount: '100000', date: '2026-08-01' }),
        exchange('34000', undefined, '2026-10-16'),
      ])
      renderRoute('/fx', usd())
      const summary = await card('สรุปการแลกเงิน')
      expect(figure(summary, 'THB → USD')).toHaveTextContent('1 ครั้ง · 34,000 → 1,000')
      expect(figure(summary, 'เรทเฉลี่ยที่ได้')).toHaveTextContent('34.00')
      expect(figure(summary, 'แพงกว่าเรทกลางเฉลี่ย')).toHaveTextContent(/^—$/)
      expect(figure(summary, 'spread ที่เสียไปรวม')).toHaveTextContent(/^—$/)
    })
  })

  describe('remittances', () => {
    it('adds up what was sent home per tax year in both calendars', async () => {
      await seedFx()
      renderRoute('/fx', usd())
      const remit = await card('เงินโอนกลับเข้าไทย')
      expect(within(remit).getByText('ปีภาษี 2569 (2026)')).toBeInTheDocument()
      expect(figure(remit, 'ปีภาษี 2569 (2026)')).toHaveTextContent('฿20,000 · 1 ครั้ง')
      expect(within(remit).getByText('ใช้เตรียมข้อมูลเงินได้จากต่างประเทศที่นำเข้าไทย ไม่ใช่คำแนะนำภาษี')).toBeInTheDocument()
    })

    it('is left out when nothing was marked as sent home', async () => {
      await seedFx()
      await db.transactions.update((await db.transactions.filter((tx) => tx.type === 'withdraw').first())!.id, { remitToThailand: false })
      renderRoute('/fx', usd())
      await board()
      expect(screen.queryByRole('region', { name: 'เงินโอนกลับเข้าไทย' })).not.toBeInTheDocument()
    })
  })

  describe('exchange history', () => {
    it('lists the exchanges newest first with the rate got, the market rate and the gap', async () => {
      await seedFx()
      renderRoute('/fx', usd())
      const history = await card('ประวัติการแลกเงิน')
      const rows = within(history).getAllByRole('row').slice(1)
      expect(rows.map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))).toEqual([
        ['16 ต.ค. 2026', '34,000 THB → 1,000 USD', '34.00', '33.50', '+1.49%'],
        ['2 ก.ย. 2026', '33,700 THB → 1,000 USD', '33.70', '33.52', '+0.54%'],
      ])
    })

    it('turns the gap yellow above one percent only', async () => {
      await seedFx()
      renderRoute('/fx', usd())
      const history = await card('ประวัติการแลกเงิน')
      expect(within(history).getByText('+1.49%')).toHaveClass('bg-warning-bg')
      expect(within(history).getByText('+0.54%')).not.toHaveClass('bg-warning-bg')
    })

    it('keeps the badge on a small gap in the table', async () => {
      await seedFx()
      renderRoute('/fx', usd())
      const small = within(await card('ประวัติการแลกเงิน')).getByText('+0.54%')
      expect(small).toHaveClass('bg-fx-soft')
    })

    it('leaves the market rate and the gap empty for an exchange without one', async () => {
      await db.accounts.add(account)
      await db.transactions.bulkAdd([
        makeTx({ ...baht, type: 'deposit', amount: '100000', date: '2026-08-01' }),
        exchange('34000', undefined, '2026-10-16'),
      ])
      renderRoute('/fx', usd())
      const [, row] = within(await card('ประวัติการแลกเงิน')).getAllByRole('row')
      expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['16 ต.ค. 2026', '34,000 THB → 1,000 USD', '34.00', '—', '—'])
    })

    it('opens the form on the exchange type from the button', async () => {
      const user = userEvent.setup()
      await seedFx()
      const router = renderRoute('/fx', usd())
      const link = within(await card('ประวัติการแลกเงิน')).getByRole('link', { name: 'บันทึกการแลกเงิน' })
      expect(link).toHaveAttribute('href', '/transactions/new?type=fx_convert')
      await user.click(link)
      expect(router.state.location.pathname).toBe('/transactions/new')
      expect(await screen.findByRole('button', { name: 'แลกเงิน' })).toHaveAttribute('aria-pressed', 'true')
    })
  })

  describe('on a phone', () => {
    beforeEach(phone)

    it('writes every exchange on two lines, with the market rate and the gap on the second', async () => {
      await seedFx()
      renderRoute('/fx', usd())
      const history = await card('ประวัติการแลกเงิน')
      expect(within(history).queryByRole('table')).not.toBeInTheDocument()
      const rows = within(history).getAllByRole('listitem')
      expect(rows.map((row) => row.textContent)).toEqual([
        '16 ต.ค. 202634.0034,000 → 1,000 USD · ตลาด 33.50 · +1.49%',
        '2 ก.ย. 202633.7033,700 → 1,000 USD · ตลาด 33.52 · +0.54%',
      ])
      expect(within(rows[0]).getByText('+1.49%')).toHaveClass('bg-warning-bg')
    })

    it('shows a gap of one percent or less as plain text and only a larger one as a badge', async () => {
      await seedFx()
      renderRoute('/fx', usd())
      const rows = within(await card('ประวัติการแลกเงิน')).getAllByRole('listitem')
      expect(rows[1].querySelector('span.rounded-md')).toBeNull()
      expect(rows[1].lastElementChild).toHaveTextContent(/ · \+0\.54%$/)
      expect(rows[0].querySelectorAll('span.rounded-md')).toHaveLength(1)
    })

    it('writes the foreign cash on two lines with the effect beside the account', async () => {
      await seedFx()
      renderRoute('/fx', usd())
      const cash = await card('เงินสดต่างประเทศ')
      expect(within(cash).queryByRole('table')).not.toBeInTheDocument()
      const [row] = within(cash).getAllByRole('listitem')
      expect(row).toHaveTextContent('USDDime US−1,2741,499 USD · ต้นทุน 50,741 · วันนี้ 49,467')
      expect(within(row).getByText('−1,274')).toHaveClass('text-fx')
    })
  })

  describe('with nothing in a foreign currency', () => {
    it('says so instead of showing empty cards', async () => {
      await db.accounts.add(account)
      await db.instruments.add({ id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'ปตท.', assetType: 'stock', currency: 'THB', lastPrice: '35' })
      await db.transactions.bulkAdd([
        makeTx({ ...baht, type: 'deposit', amount: '10000', date: '2026-08-01' }),
        makeTx({ ...baht, instrumentId: 'SET:PTT', type: 'buy', quantity: '100', price: '33', date: '2026-08-02' }),
      ])
      renderRoute('/fx', usd())
      expect(await screen.findByText('ยังไม่มีเงินหรือสินทรัพย์ต่างประเทศ')).toBeInTheDocument()
      expect(screen.queryByRole('region')).not.toBeInTheDocument()
    })

    it('does not call it empty while an exchange has been recorded', async () => {
      await db.accounts.add(account)
      await db.transactions.add(exchange('34000', '33.5', '2026-10-16'))
      renderRoute('/fx', usd())
      await card('ประวัติการแลกเงิน')
      expect(screen.queryByText('ยังไม่มีเงินหรือสินทรัพย์ต่างประเทศ')).not.toBeInTheDocument()
    })
  })
})

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import type { Market, TradeJournal } from '../../domain/types'
import { makeTx } from '../../test/fixtures'
import { renderRoute, resetDb } from '../../test/render'

const baht = { currency: 'THB', fxRate: '1', fxSource: 'same' as const }

beforeEach(async () => {
  await resetDb()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2024, 9, 16, 9, 0))
  await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// 10 units bought at 100 and sold at sellPrice, so a sell at 200 makes exactly 1,000 baht.
async function seedTrade(
  symbol: string,
  open: string,
  close: string | null,
  sellPrice = '100',
  journal: { buy?: TradeJournal; sell?: TradeJournal } = {},
  market: Market = 'SET',
) {
  const instrumentId = `${market}:${symbol}`
  await db.instruments.put({ id: instrumentId, market, symbol, name: symbol, assetType: 'stock', currency: 'THB' })
  await db.transactions.add(
    makeTx({ ...baht, id: `buy-${symbol}`, instrumentId, quantity: '10', price: '100', date: open, journal: journal.buy }),
  )
  if (close) {
    await db.transactions.add(
      makeTx({ ...baht, id: `sell-${symbol}`, type: 'sell', instrumentId, quantity: '10', price: sellPrice, date: close, journal: journal.sell }),
    )
  }
}

// Results 1,000 / -500 / 2,000 / -300 / -200 baht, closed in that order, and one trade still open.
async function seedFive() {
  await seedTrade('KBANK', '2024-01-01', '2024-01-05', '200', { buy: { strategy: 'Breakout', emotion: 'calm' } })
  await seedTrade('TSLA', '2024-01-01', '2024-01-08', '50', { buy: { strategy: 'Breakout', emotion: 'calm' } }, 'US')
  await seedTrade('ETH', '2024-01-01', '2024-01-11', '300', { buy: { strategy: 'Pullback' } }, 'CRYPTO')
  await seedTrade('PTT', '2024-01-01', '2024-01-21', '70')
  await seedTrade('NVDA', '2024-01-01', '2024-01-31', '80', {}, 'US')
  await seedTrade('AOT', '2024-10-10', null, '100', { buy: { strategy: 'Pullback' } })
}

const stat = (label: string) => screen.getByText(label).parentElement as HTMLElement

const stubWidth = (px: number) =>
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: Number(/\d+/.exec(query)?.[0]) <= px,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
const phone = () => stubWidth(0)
// Wide enough for the sidebar layout but not for the tables.
const tablet = () => stubWidth(900)

const reviewButtons = () => screen.getAllByRole('button', { name: /^รีวิว / })

describe('TradesPage', () => {
  it('invites the user to record a first trade when there is none', async () => {
    renderRoute('/trades')
    expect(await screen.findByText('ยังไม่มีเทรด')).toBeInTheDocument()
    expect(screen.getByText('บันทึกการซื้อและขายแล้วสถิติจะขึ้นที่นี่')).toBeInTheDocument()
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'บันทึกรายการ' })).toHaveAttribute('href', '/transactions/new')
  })

  it('sums the trades closed this year, with the open ones noted beside the count', async () => {
    await seedFive()
    renderRoute('/trades')
    expect(await screen.findByText('เทรดที่ปิดแล้ว')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ปีนี้' })).toHaveAttribute('aria-pressed', 'true')
    const closed = within(stat('เทรดที่ปิดแล้ว'))
    expect(closed.getByText('5')).toBeInTheDocument()
    expect(closed.getByText('เปิดอยู่ 1')).toBeInTheDocument()
    const winRate = within(stat('Win rate'))
    expect(winRate.getByText('40%')).toBeInTheDocument()
    expect(winRate.getByText('ชนะ 2 · แพ้ 3')).toBeInTheDocument()
    const factor = within(stat('Profit factor'))
    expect(factor.getByText('3.00')).toBeInTheDocument()
    expect(factor.getByText('ชนะเฉลี่ย 1,500 ·')).toHaveClass('whitespace-nowrap')
    expect(factor.getByText('แพ้เฉลี่ย 333')).toHaveClass('whitespace-nowrap')
    expect(factor.getByText('แพ้เฉลี่ย 333').parentElement).toHaveTextContent('ชนะเฉลี่ย 1,500 · แพ้เฉลี่ย 333')
    const perTrade = within(stat('ได้ต่อเทรด'))
    expect(perTrade.getByText('+400')).toHaveClass('text-gain')
    expect(perTrade.getByText('รวม +2,000')).toBeInTheDocument()
    const held = within(stat('ถือเฉลี่ย'))
    expect(held.getByText('14 วัน')).toBeInTheDocument()
    expect(held.getByText('ชนะ 7 วัน ·')).toHaveClass('whitespace-nowrap')
    expect(held.getByText('แพ้ 19 วัน')).toHaveClass('whitespace-nowrap')
    expect(held.getByText('แพ้ 19 วัน').parentElement).toHaveTextContent('ชนะ 7 วัน · แพ้ 19 วัน')
  })

  it('steps the strip values down at tablet width so a seven-figure result stays inside its tile', async () => {
    await seedFive()
    renderRoute('/trades')
    await screen.findByText('เทรดที่ปิดแล้ว')
    for (const label of ['เทรดที่ปิดแล้ว', 'Win rate', 'Profit factor', 'ได้ต่อเทรด', 'ถือเฉลี่ย']) {
      const value = within(stat(label)).getAllByText(/./)[1]
      expect(value).toHaveClass('md:text-[20px]', 'lg:text-[28px]')
      expect(value).not.toHaveClass('md:text-[28px]')
    }
  })

  it('shows last year too when everything is chosen', async () => {
    await seedFive()
    await seedTrade('SCB', '2023-11-01', '2023-11-10', '150')
    const user = userEvent.setup()
    renderRoute('/trades')
    await screen.findByText('เทรดที่ปิดแล้ว')
    expect(screen.queryByText('SCB', { selector: 'b' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'ทั้งหมด' }))
    expect(within(stat('เทรดที่ปิดแล้ว')).getByText('6')).toBeInTheDocument()
    expect(within(stat('ได้ต่อเทรด')).getByText('รวม +2,500')).toBeInTheDocument()
    expect(screen.getByText('SCB', { selector: 'b' })).toBeInTheDocument()
    expect(screen.getByText('พ.ย. 2023')).toBeInTheDocument()
  })

  it('shows dashes for what cannot be worked out in a month with no closed trade', async () => {
    await seedFive()
    const user = userEvent.setup()
    renderRoute('/trades')
    await user.click(await screen.findByRole('button', { name: 'เดือนนี้' }))
    expect(within(stat('เทรดที่ปิดแล้ว')).getByText('0')).toBeInTheDocument()
    expect(within(stat('เทรดที่ปิดแล้ว')).getByText('เปิดอยู่ 1')).toBeInTheDocument()
    expect(within(stat('Win rate')).getByText('—')).toBeInTheDocument()
    expect(within(stat('Profit factor')).getByText('—')).toBeInTheDocument()
    expect(within(stat('ได้ต่อเทรด')).getByText('—')).toBeInTheDocument()
    expect(within(stat('ถือเฉลี่ย')).getByText('—')).toBeInTheDocument()
    expect(screen.getByText('ไม่มีเทรดที่ปิดในช่วงนี้')).toBeInTheDocument()
    expect(screen.queryByText('กลยุทธ์ไหนทำเงิน')).not.toBeInTheDocument()
    expect(screen.getByText('AOT', { selector: 'b' })).toBeInTheDocument()
  })

  it('sums only the trades closed this month when that is chosen', async () => {
    await seedFive()
    await seedTrade('SCB', '2024-10-01', '2024-10-12', '150')
    const user = userEvent.setup()
    renderRoute('/trades')
    await user.click(await screen.findByRole('button', { name: 'เดือนนี้' }))
    expect(within(stat('เทรดที่ปิดแล้ว')).getByText('1')).toBeInTheDocument()
    expect(within(stat('Win rate')).getByText('100%')).toBeInTheDocument()
    expect(within(stat('ได้ต่อเทรด')).getByText('+500')).toBeInTheDocument()
    expect(within(stat('ถือเฉลี่ย')).getByText('11 วัน')).toBeInTheDocument()
    const recent = screen.getByRole('heading', { name: 'เทรดที่ปิดล่าสุด' }).closest('div')!.parentElement!
    expect(within(recent).getAllByRole('row').slice(1).map((r) => r.querySelector('b')?.textContent)).toEqual(['SCB'])
    expect(screen.queryByText('KBANK', { selector: 'b' })).not.toBeInTheDocument()
  })

  it('ranks strategies, feelings and months by what they made', async () => {
    await seedFive()
    renderRoute('/trades')
    const strategies = (await screen.findByRole('heading', { name: 'กลยุทธ์ไหนทำเงิน' })).closest('div')!
    const rows = within(strategies).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.textContent)).toEqual(['Pullback1100%+2,000', 'Breakout250%+500', 'ไม่ระบุ20%−500'])
    const feelings = screen.getByRole('heading', { name: 'อารมณ์ตอนเข้า' }).closest('div')!
    const feelingRows = within(feelings).getAllByRole('row').slice(1)
    expect(feelingRows.map((r) => r.textContent)).toEqual(['ไม่ระบุ333%+1,500', 'นิ่ง มีแผน250%+500'])
    expect(strategies.parentElement).toHaveClass('items-stretch')
    const months = screen.getByRole('heading', { name: 'แยกตามเดือน' }).closest('div')!
    expect(within(months).getAllByRole('row')[1]).toHaveTextContent('ม.ค. 2024540%+2,000')
    expect(within(months).getByText('+2,000')).toHaveClass('text-gain')
  })

  it('lists the ten latest closed trades, the newest first, with what each made', async () => {
    await seedFive()
    renderRoute('/trades')
    const recent = (await screen.findByRole('heading', { name: 'เทรดที่ปิดล่าสุด' })).closest('div')!.parentElement!
    const rows = within(recent).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.querySelector('b')?.textContent)).toEqual(['NVDA', 'PTT', 'ETH', 'TSLA', 'KBANK'])
    expect(rows[0]).toHaveTextContent('US')
    expect(rows[0]).toHaveTextContent('30 วัน')
    expect(rows[0]).toHaveTextContent('−200')
    expect(rows[2]).toHaveTextContent('Pullback')
    expect(rows[2]).toHaveTextContent('+2,000')
    expect(rows[3]).toHaveTextContent('Breakout')
    expect(rows[0]).toHaveTextContent('—')
    expect(screen.getByRole('button', { name: 'ยังไม่ได้รีวิว 5' })).toHaveAttribute('aria-pressed', 'false')
  })

  describe('with more than ten closed trades', () => {
    async function seedTwelve() {
      for (let i = 1; i <= 12; i++) {
        const day = String(i).padStart(2, '0')
        await seedTrade(`T${day}`, '2024-01-15', `2024-02-${day}`, '120', i === 12 ? { sell: { score: 5 } } : {})
      }
    }
    const symbols = (rows: HTMLElement[]) => rows.map((r) => r.querySelector('b')?.textContent)

    it('lists the ten latest, the newest first', async () => {
      await seedTwelve()
      renderRoute('/trades')
      const recent = (await screen.findByRole('heading', { name: 'เทรดที่ปิดล่าสุด' })).closest('div')!.parentElement!
      expect(symbols(within(recent).getAllByRole('row').slice(1))).toEqual(
        ['T12', 'T11', 'T10', 'T09', 'T08', 'T07', 'T06', 'T05', 'T04', 'T03'],
      )
    })

    it('lists every trade still to review, past the ten, when the count is pressed', async () => {
      await seedTwelve()
      const user = userEvent.setup()
      renderRoute('/trades')
      const toggle = await screen.findByRole('button', { name: 'ยังไม่ได้รีวิว 11' })
      await user.click(toggle)
      expect(toggle).toHaveAttribute('aria-pressed', 'true')
      expect(screen.queryByRole('heading', { name: 'เทรดที่ปิดล่าสุด' })).not.toBeInTheDocument()
      const recent = screen.getByRole('heading', { name: 'ยังไม่ได้รีวิว' }).closest('div')!.parentElement!
      const rows = within(recent).getAllByRole('row').slice(1)
      expect(symbols(rows)).toEqual(['T11', 'T10', 'T09', 'T08', 'T07', 'T06', 'T05', 'T04', 'T03', 'T02', 'T01'])
      expect(within(recent).getAllByRole('button', { name: /^รีวิว / })).toHaveLength(11)
      expect(within(recent).queryByRole('button', { name: /^แก้รีวิว/ })).not.toBeInTheDocument()

      await user.click(toggle)
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByRole('heading', { name: 'เทรดที่ปิดล่าสุด' })).toBeInTheDocument()
    })

    it('goes back to the latest trades once none is left to review, and leaves the filter off', async () => {
      await seedTrade('KBANK', '2024-01-01', '2024-01-05', '200')
      const user = userEvent.setup()
      renderRoute('/trades')
      await user.click(await screen.findByRole('button', { name: 'ยังไม่ได้รีวิว 1' }))
      await user.click(screen.getByRole('button', { name: 'รีวิว KBANK ปิด 5 ม.ค. 2024' }))
      await user.click(screen.getByRole('button', { name: '5' }))
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      const heading = await screen.findByRole('heading', { name: 'เทรดที่ปิดล่าสุด' })
      expect(screen.getByRole('button', { name: 'แก้รีวิว KBANK ปิด 5 ม.ค. 2024' })).toBeInTheDocument()
      expect(screen.queryByText(/ยังไม่ได้รีวิว/)).not.toBeInTheDocument()
      expect(heading).toHaveFocus()
      expect(heading).toHaveAttribute('tabindex', '-1')

      await seedTrade('PTT', '2024-01-01', '2024-01-21', '70')
      expect(await screen.findByRole('button', { name: 'ยังไม่ได้รีวิว 1' })).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByRole('heading', { name: 'เทรดที่ปิดล่าสุด' })).toBeInTheDocument()
    })

    describe('after a review leaves the list of trades still to review', () => {
      async function saveScore(user: ReturnType<typeof userEvent.setup>, buttonName: string) {
        await user.click(await screen.findByRole('button', { name: buttonName }))
        await user.click(screen.getByRole('button', { name: '4' }))
        await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      }

      async function seedThree() {
        for (const i of [1, 2, 3]) await seedTrade(`T${i}`, '2024-01-15', `2024-02-0${i}`, '120')
      }

      it('moves focus to the review button of the next row', async () => {
        await seedThree()
        const user = userEvent.setup()
        renderRoute('/trades')
        await user.click(await screen.findByRole('button', { name: 'ยังไม่ได้รีวิว 3' }))
        await saveScore(user, 'รีวิว T3 ปิด 3 ก.พ. 2024')
        await waitFor(() => expect(screen.queryByRole('button', { name: /^รีวิว T3/ })).not.toBeInTheDocument())
        expect(screen.getByRole('button', { name: 'รีวิว T2 ปิด 2 ก.พ. 2024' })).toHaveFocus()
      })

      it('moves focus to the toggle when the saved row was the last one', async () => {
        await seedThree()
        const user = userEvent.setup()
        renderRoute('/trades')
        await user.click(await screen.findByRole('button', { name: 'ยังไม่ได้รีวิว 3' }))
        await saveScore(user, 'รีวิว T1 ปิด 1 ก.พ. 2024')
        const toggle = await screen.findByRole('button', { name: 'ยังไม่ได้รีวิว 2' })
        await waitFor(() => expect(toggle).toHaveFocus())
        expect(toggle).toHaveAttribute('aria-pressed', 'true')
      })

      it('leaves focus on the row that was saved when it is still to review', async () => {
        await seedThree()
        const user = userEvent.setup()
        renderRoute('/trades')
        await user.click(await screen.findByRole('button', { name: 'ยังไม่ได้รีวิว 3' }))
        const button = screen.getByRole('button', { name: 'รีวิว T3 ปิด 3 ก.พ. 2024' })
        await user.click(button)
        await user.click(screen.getByRole('button', { name: 'บันทึก' }))
        await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument())
        expect(button).toHaveFocus()
      })
    })
  })

  it('names the longest losing run and the best and worst trade', async () => {
    await seedFive()
    renderRoute('/trades')
    const line = (await screen.findByText('เทรดดีสุด +2,000 (ETH) ·')).parentElement
    expect(line).toHaveTextContent('แพ้ติดกันมากสุด 2 ครั้ง · เทรดดีสุด +2,000 (ETH) · แย่สุด −500 (TSLA)')
    // The dot stays with the part before it and every part is kept whole, so a line can end on a dot but never start with one.
    for (const part of ['แพ้ติดกันมากสุด 2 ครั้ง ·', 'เทรดดีสุด +2,000 (ETH) ·', 'แย่สุด −500 (TSLA)']) {
      expect(within(line!).getByText(part)).toHaveClass('whitespace-nowrap')
    }
    expect(screen.getByText('ยังไม่มีข้อผิดพลาดที่บันทึกไว้')).toBeInTheDocument()
  })

  it('names a lone winning trade as the best only, with no losing run', async () => {
    await seedTrade('KBANK', '2024-01-01', '2024-01-05', '200')
    renderRoute('/trades')
    expect(await screen.findByText('เทรดดีสุด +1,000 (KBANK)')).toBeInTheDocument()
    expect(screen.queryByText(/แย่สุด/)).not.toBeInTheDocument()
    expect(screen.queryByText(/แพ้ติดกัน/)).not.toBeInTheDocument()
  })

  it('does not call a trade that made money the worst when every trade did', async () => {
    await seedTrade('KBANK', '2024-01-01', '2024-01-05', '200')
    await seedTrade('PTT', '2024-01-01', '2024-01-06', '150')
    renderRoute('/trades')
    expect(await screen.findByText('เทรดดีสุด +1,000 (KBANK)')).toBeInTheDocument()
    expect(screen.queryByText(/แย่สุด/)).not.toBeInTheDocument()
  })

  it('does not call a trade that lost money the best when every trade did', async () => {
    await seedTrade('KBANK', '2024-01-01', '2024-01-05', '90')
    await seedTrade('PTT', '2024-01-01', '2024-01-06', '70')
    renderRoute('/trades')
    expect((await screen.findByText('แย่สุด −300 (PTT)')).parentElement).toHaveTextContent('แพ้ติดกันมากสุด 2 ครั้ง · แย่สุด −300 (PTT)')
    expect(screen.queryByText(/เทรดดีสุด/)).not.toBeInTheDocument()
  })

  it('lists the open trades whatever the period', async () => {
    await seedFive()
    const user = userEvent.setup()
    renderRoute('/trades')
    await user.click(await screen.findByRole('button', { name: 'เดือนนี้' }))
    const open = screen.getByRole('heading', { name: 'เทรดที่เปิดอยู่' }).closest('div')!
    const row = within(open).getAllByRole('row')[1]
    expect(row).toHaveTextContent('SET')
    expect(row).toHaveTextContent('AOT')
    expect(row).toHaveTextContent('10 ต.ค. 2024')
    expect(within(open).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['สินทรัพย์', 'เปิดเมื่อ', 'กลยุทธ์', 'ถือมา'])
    expect(row).toHaveTextContent('6 วัน')
    expect(row).toHaveTextContent('Pullback')
  })

  it('gives a cut-off strategy its full name as a title', async () => {
    const long = 'Breakout หลังประกาศงบไตรมาสที่สามของบริษัท'
    await seedTrade('KBANK', '2024-01-01', '2024-01-05', '200', { buy: { strategy: long } })
    renderRoute('/trades')
    const recent = (await screen.findByRole('heading', { name: 'เทรดที่ปิดล่าสุด' })).closest('div')!.parentElement!
    expect(within(recent).getByTitle(long)).toBeInTheDocument()
    expect(within(screen.getByRole('heading', { name: 'กลยุทธ์ไหนทำเงิน' }).closest('div')!).getByTitle(long)).toBeInTheDocument()
  })

  it('gives the strategy of an open trade its full name as a title', async () => {
    const long = 'Breakout หลังประกาศงบไตรมาสที่สามของบริษัท'
    await seedTrade('AOT', '2024-10-10', null, '100', { buy: { strategy: long } })
    renderRoute('/trades')
    const open = (await screen.findByRole('heading', { name: 'เทรดที่เปิดอยู่' })).closest('div')!
    expect(within(open).getByTitle(long)).toHaveTextContent(long)
  })

  describe('observations', () => {
    it('warns about a feeling that loses money and how often no stop loss was set', async () => {
      const prices = ['130', '10', '20', '30', '40']
      for (const [i, price] of prices.entries()) {
        await seedTrade(`F${i}`, '2024-03-01', `2024-03-0${i + 5}`, price, { buy: { emotion: 'fomo', ...(i === 1 && { stopLoss: '90' }) } })
      }
      renderRoute('/trades')
      const note = await screen.findByRole('note')
      expect(note).toHaveTextContent('เทรดตอน FOMO ชนะแค่ 20% และขาดทุนรวม −2,700 · 4 ใน 5 ครั้งไม่ได้ตั้ง Stop loss')
    })

    it('names a strategy the same way and leaves the stop loss part out when every trade had one', async () => {
      for (const i of [0, 1, 2, 3, 4]) {
        await seedTrade(`S${i}`, '2024-03-01', `2024-03-0${i + 5}`, '90', { buy: { strategy: 'Scalp', stopLoss: '85' } })
      }
      renderRoute('/trades')
      const note = await screen.findByRole('note')
      expect(note).toHaveTextContent('กลยุทธ์ Scalp ชนะแค่ 0% และขาดทุนรวม −500')
      expect(note).not.toHaveTextContent('Stop loss')
    })

    it('stays quiet when no group of five trades loses money', async () => {
      await seedFive()
      renderRoute('/trades')
      await screen.findByText('เทรดที่ปิดแล้ว')
      expect(screen.queryByRole('note')).not.toBeInTheDocument()
    })
  })

  describe('review', () => {
    it('saves the review on the sell that closed the trade and counts one less to review', async () => {
      await seedFive()
      const user = userEvent.setup()
      renderRoute('/trades')
      expect(await screen.findByText('ยังไม่ได้รีวิว 5')).toBeInTheDocument()
      const [first] = reviewButtons()
      expect(first).toHaveAccessibleName('รีวิว NVDA ปิด 31 ม.ค. 2024')
      expect(first.closest('tr')).toHaveTextContent('NVDA')
      await user.click(first)
      expect(first).toHaveAttribute('aria-expanded', 'true')
      expect(within(first).getByText('รีวิว')).toHaveClass('bg-warning-fg')

      const form = screen.getByRole('form', { name: 'รีวิวเทรด NVDA' })
      await user.type(within(form).getByLabelText('รีวิวหลังปิด'), 'เข้าเร็วเกินไป')
      await user.click(within(form).getByRole('button', { name: 'ไล่ราคา' }))
      await user.click(within(form).getByRole('button', { name: '3' }))
      await user.click(within(form).getByRole('button', { name: 'บันทึก' }))

      expect(await screen.findByText('ยังไม่ได้รีวิว 4')).toBeInTheDocument()
      expect(screen.queryByRole('form')).not.toBeInTheDocument()
      const nvda = screen.getByText('NVDA', { selector: 'b' }).closest('tr')!
      const edit = within(nvda).getByRole('button', { name: 'แก้รีวิว NVDA ปิด 31 ม.ค. 2024' })
      expect(edit).toHaveTextContent('รีวิวแล้ว')
      expect(edit).toHaveFocus()
      expect((await db.transactions.get('sell-NVDA'))?.journal).toEqual({ review: 'เข้าเร็วเกินไป', mistakes: ['chased'], score: 3 })
      const mistakes = screen.getByRole('heading', { name: 'ข้อผิดพลาดที่ทำบ่อย' }).closest('div')!
      expect(within(mistakes).getByText('ไล่ราคา').parentElement).toHaveTextContent('ไล่ราคา1 ครั้ง')
    })

    it('opens a reviewed trade again with what was written', async () => {
      await seedTrade('KBANK', '2024-01-01', '2024-01-05', '200', {
        buy: { strategy: 'Breakout' },
        sell: { review: 'ดีแล้ว', mistakes: ['sold_early'], score: 4 },
      })
      const user = userEvent.setup()
      renderRoute('/trades')
      await user.click(await screen.findByRole('button', { name: 'แก้รีวิว KBANK ปิด 5 ม.ค. 2024' }))
      const form = screen.getByRole('form', { name: 'รีวิวเทรด KBANK' })
      expect(within(form).getByLabelText('รีวิวหลังปิด')).toHaveValue('ดีแล้ว')
      expect(within(form).getByRole('button', { name: 'ขายเร็วเกิน' })).toHaveAttribute('aria-pressed', 'true')
      expect(within(form).getByRole('button', { name: 'ไล่ราคา' })).toHaveAttribute('aria-pressed', 'false')
      expect(within(form).getByRole('button', { name: '4' })).toHaveAttribute('aria-pressed', 'true')

      await user.click(within(form).getByRole('button', { name: '4' }))
      expect(within(form).getByRole('button', { name: '4' })).toHaveAttribute('aria-pressed', 'false')
      await user.click(within(form).getByRole('button', { name: 'บันทึก' }))
      await waitFor(async () => expect((await db.transactions.get('sell-KBANK'))?.journal).toEqual({ review: 'ดีแล้ว', mistakes: ['sold_early'] }))
    })

    it('closes the form without writing when it is cancelled', async () => {
      await seedFive()
      const user = userEvent.setup()
      renderRoute('/trades')
      const button = await screen.findByRole('button', { name: 'รีวิว NVDA ปิด 31 ม.ค. 2024' })
      await user.click(button)
      await user.type(screen.getByLabelText('รีวิวหลังปิด'), 'ไม่เก็บ')
      await user.click(screen.getByRole('button', { name: 'ยกเลิก' }))
      expect(screen.queryByRole('form')).not.toBeInTheDocument()
      expect(button).toHaveFocus()
      expect(button).toHaveAttribute('aria-expanded', 'false')
      expect((await db.transactions.get('sell-NVDA'))?.journal).toBeUndefined()
    })

    it('keeps one form open at a time', async () => {
      await seedFive()
      const user = userEvent.setup()
      renderRoute('/trades')
      await user.click(await screen.findByRole('button', { name: 'รีวิว NVDA ปิด 31 ม.ค. 2024' }))
      await user.click(screen.getByRole('button', { name: 'รีวิว PTT ปิด 21 ม.ค. 2024' }))
      expect(screen.getAllByRole('form')).toHaveLength(1)
      expect(screen.getByRole('form', { name: 'รีวิวเทรด PTT' })).toBeInTheDocument()
    })

    it('closes the form when another period is chosen', async () => {
      await seedFive()
      const user = userEvent.setup()
      renderRoute('/trades')
      await user.click(await screen.findByRole('button', { name: 'รีวิว NVDA ปิด 31 ม.ค. 2024' }))
      await user.click(screen.getByRole('button', { name: 'ทั้งหมด' }))
      expect(screen.queryByRole('form')).not.toBeInTheDocument()
    })

    it('shows what went wrong when the review cannot be saved', async () => {
      await seedFive()
      await db.transactions.update('sell-NVDA', { journal: { score: 9 } })
      const user = userEvent.setup()
      renderRoute('/trades')
      await user.click(await screen.findByRole('button', { name: 'แก้รีวิว NVDA ปิด 31 ม.ค. 2024' }))
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('คะแนนการลงมือต้องเป็น 1–5')
      expect(screen.getByRole('form')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'บันทึก' })).toBeEnabled()
    })

    it('holds the save button while the review is being written', async () => {
      await seedFive()
      const user = userEvent.setup()
      renderRoute('/trades')
      await user.click(await screen.findByRole('button', { name: 'รีวิว NVDA ปิด 31 ม.ค. 2024' }))
      const form = screen.getByRole('form')
      fireEvent.submit(form)
      expect(within(form).getByRole('button', { name: 'บันทึก' })).toBeDisabled()
      await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument())
    })

    it('offers no review for a trade that a swap closed, because a swap holds no journal', async () => {
      await db.transactions.bulkAdd([
        makeTx({ ...baht, instrumentId: 'CRYPTO:BTC', quantity: '1', price: '600', date: '2024-02-01' }),
        makeTx({
          ...baht,
          type: 'swap',
          instrumentId: 'CRYPTO:BTC',
          toInstrumentId: 'CRYPTO:ETH',
          quantity: '1',
          toQuantity: '10',
          amount: '660',
          price: undefined,
          date: '2024-02-05',
        }),
      ])
      renderRoute('/trades')
      expect(await screen.findByText('BTC', { selector: 'b' })).toBeInTheDocument()
      expect(within(stat('Win rate')).getByText('100%')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /รีวิว/ })).not.toBeInTheDocument()
    })
  })

  describe('on a phone', () => {
    it('keeps three tiles in the strip and writes each table row on two lines', async () => {
      phone()
      await seedFive()
      renderRoute('/trades')
      const list = await screen.findByRole('list', { name: 'กลยุทธ์ไหนทำเงิน' })
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      const items = within(list).getAllByRole('listitem')
      expect(items.map((li) => li.textContent)).toEqual(['Pullback+2,0001 เทรด · ชนะ 100%', 'Breakout+5002 เทรด · ชนะ 50%', 'ไม่ระบุ−5002 เทรด · ชนะ 0%'])
      expect(within(screen.getByRole('list', { name: 'แยกตามเดือน' })).getByText('5 เทรด · ชนะ 40%')).toBeInTheDocument()

      const strip = stat('เทรดที่ปิดแล้ว').parentElement!
      expect(strip).toHaveClass('grid-cols-2', 'max-md:[&>:first-child]:col-span-2')
      for (const label of ['เทรดที่ปิดแล้ว', 'Win rate', 'Profit factor']) {
        expect(stat(label).parentElement).toBe(strip)
      }
      for (const label of ['ได้ต่อเทรด', 'ถือเฉลี่ย']) {
        expect(stat(label).parentElement).toHaveClass('max-md:hidden')
      }
    })

    it('puts the strategy, the time held and the feeling under the asset, with a 44px review button', async () => {
      phone()
      await seedFive()
      const user = userEvent.setup()
      renderRoute('/trades')
      const list = await screen.findByRole('list', { name: 'เทรดที่ปิดล่าสุด' })
      const items = within(list).getAllByRole('listitem')
      expect(items).toHaveLength(5)
      expect(items[2]).toHaveTextContent('ETH')
      expect(within(items[2]).getByText('Pullback')).toBeInTheDocument()
      expect(within(items[2]).getByText('· 10 วัน')).toBeInTheDocument()
      expect(within(items[4]).getByText('Breakout')).toBeInTheDocument()
      expect(within(items[4]).getByText('· 4 วัน · นิ่ง มีแผน')).toBeInTheDocument()
      expect(within(items[0]).getByText('—')).toBeInTheDocument()
      expect(within(items[0]).getByText('· 30 วัน')).toBeInTheDocument()
      expect(within(items[2]).getByText('+2,000')).toHaveClass('justify-self-end')
      const button = within(items[2]).getByRole('button', { name: 'รีวิว ETH ปิด 11 ม.ค. 2024' })
      expect(button).toHaveClass('min-h-11', 'min-w-11', 'justify-end')
      expect(screen.getByRole('button', { name: 'ยังไม่ได้รีวิว 5' })).toHaveClass('min-h-11', 'min-w-11')
      await user.click(button)
      expect(within(items[2]).getByRole('form', { name: 'รีวิวเทรด ETH' })).toBeInTheDocument()
      const open = within(screen.getByRole('list', { name: 'เทรดที่เปิดอยู่' })).getAllByRole('listitem')
      expect(open[0]).toHaveTextContent('AOT')
      expect(open[0]).toHaveTextContent('ถือมา 6 วัน')
      expect(open[0]).toHaveTextContent('เปิดเมื่อ 10 ต.ค. 2024 · Pullback')
    })
  })

  describe('on a phone, with a strategy too long for the line', () => {
    const long = 'Breakout หลังประกาศงบไตรมาสที่สามของบริษัท'

    it('cuts the strategy short and keeps the days and the feeling in view', async () => {
      phone()
      await seedTrade('KBANK', '2024-01-01', '2024-01-05', '200', { buy: { strategy: long, emotion: 'calm' } })
      renderRoute('/trades')
      const item = within(await screen.findByRole('list', { name: 'เทรดที่ปิดล่าสุด' })).getByRole('listitem')
      const strategy = within(item).getByTitle(long)
      expect(strategy).toHaveClass('min-w-0', 'truncate')
      const tail = within(item).getByText('· 4 วัน · นิ่ง มีแผน')
      expect(tail).toHaveClass('shrink-0', 'whitespace-nowrap')
      expect(tail).not.toHaveClass('truncate')
      expect(tail.parentElement).toBe(strategy.parentElement)
      expect(tail.parentElement).toHaveTextContent(`${long} · 4 วัน · นิ่ง มีแผน`)
    })

    it('gives every cut-off name its full text as a title', async () => {
      phone()
      await seedTrade('KBANK', '2024-01-01', '2024-01-05', '200', { buy: { strategy: long } })
      await seedTrade('AOT', '2024-10-10', null, '100', { buy: { strategy: long } })
      renderRoute('/trades')
      const groups = await screen.findByRole('list', { name: 'กลยุทธ์ไหนทำเงิน' })
      expect(within(groups).getByTitle(long)).toHaveTextContent(long)
      const open = screen.getByRole('list', { name: 'เทรดที่เปิดอยู่' })
      expect(within(open).getByTitle(long)).toHaveTextContent(`เปิดเมื่อ 10 ต.ค. 2024 · ${long}`)
    })

    it('names the list after the heading above it', async () => {
      phone()
      await seedTrade('KBANK', '2024-01-01', '2024-01-05', '200')
      const user = userEvent.setup()
      renderRoute('/trades')
      const toggle = await screen.findByRole('button', { name: 'ยังไม่ได้รีวิว 1' })
      expect(screen.getByRole('list', { name: 'เทรดที่ปิดล่าสุด' })).toBeInTheDocument()
      await user.click(toggle)
      expect(screen.getByRole('list', { name: 'ยังไม่ได้รีวิว' })).toBeInTheDocument()
      expect(screen.queryByRole('list', { name: 'เทรดที่ปิดล่าสุด' })).not.toBeInTheDocument()
    })
  })

  describe('on a tablet, where the sidebar leaves the cards narrow', () => {
    it('writes the rows as lists until the screen can hold the tables', async () => {
      tablet()
      await seedFive()
      renderRoute('/trades')
      expect(await screen.findByRole('list', { name: 'เทรดที่ปิดล่าสุด' })).toBeInTheDocument()
      expect(screen.getByRole('list', { name: 'กลยุทธ์ไหนทำเงิน' })).toBeInTheDocument()
      expect(screen.getByRole('list', { name: 'เทรดที่เปิดอยู่' })).toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })

    it('still shows the tables at 1024px and up', async () => {
      stubWidth(1024)
      await seedFive()
      renderRoute('/trades')
      expect(await screen.findAllByRole('table')).toHaveLength(5)
      expect(screen.queryByRole('list', { name: 'เทรดที่ปิดล่าสุด' })).not.toBeInTheDocument()
    })
  })
})

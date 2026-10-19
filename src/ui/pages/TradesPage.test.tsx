import { screen, waitFor, within } from '@testing-library/react'
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

const phone = () =>
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))

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
    expect(factor.getByText('ชนะเฉลี่ย 1,500 · แพ้เฉลี่ย 333')).toBeInTheDocument()
    const perTrade = within(stat('ได้ต่อเทรด'))
    expect(perTrade.getByText('+400')).toHaveClass('text-gain')
    expect(perTrade.getByText('รวม +2,000')).toBeInTheDocument()
    const held = within(stat('ถือเฉลี่ย'))
    expect(held.getByText('14 วัน')).toBeInTheDocument()
    expect(held.getByText('ชนะ 7 วัน · แพ้ 19 วัน')).toBeInTheDocument()
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

  it('ranks strategies, feelings and months by what they made', async () => {
    await seedFive()
    renderRoute('/trades')
    const strategies = (await screen.findByRole('heading', { name: 'กลยุทธ์ไหนทำเงิน' })).closest('div')!
    const rows = within(strategies).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.textContent)).toEqual(['Pullback1100%+2,000', 'Breakout250%+500', 'ไม่ระบุ20%−500'])
    const feelings = screen.getByRole('heading', { name: 'อารมณ์ตอนเข้า' }).closest('div')!
    const feelingRows = within(feelings).getAllByRole('row').slice(1)
    expect(feelingRows.map((r) => r.textContent)).toEqual(['ไม่ระบุ333%+1,500', 'นิ่ง มีแผน250%+500'])
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
    expect(screen.getByText('ยังไม่ได้รีวิว 5')).toBeInTheDocument()
  })

  it('names the longest losing run and the best and worst trade', async () => {
    await seedFive()
    renderRoute('/trades')
    expect(await screen.findByText('แพ้ติดกันมากสุด 2 ครั้ง · เทรดดีสุด +2,000 (ETH) · แย่สุด −500 (TSLA)')).toBeInTheDocument()
    expect(screen.getByText('ยังไม่มีข้อผิดพลาดที่บันทึกไว้')).toBeInTheDocument()
  })

  it('names a lone closed trade once and mentions no losing run when none lost', async () => {
    await seedTrade('KBANK', '2024-01-01', '2024-01-05', '200')
    renderRoute('/trades')
    expect(await screen.findByText('เทรดดีสุด +1,000 (KBANK)')).toBeInTheDocument()
    expect(screen.queryByText(/แย่สุด/)).not.toBeInTheDocument()
    expect(screen.queryByText(/แพ้ติดกัน/)).not.toBeInTheDocument()
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
    expect(within(open).getByText('ถือมา')).toBeInTheDocument()
    expect(row).toHaveTextContent('6 วัน')
    expect(row).toHaveTextContent('Pullback')
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
      const [first] = screen.getAllByRole('button', { name: 'รีวิว' })
      expect(first.closest('tr')).toHaveTextContent('NVDA')
      await user.click(first)

      const form = screen.getByRole('form', { name: 'รีวิวเทรด NVDA' })
      await user.type(within(form).getByLabelText('รีวิวหลังปิด'), 'เข้าเร็วเกินไป')
      await user.click(within(form).getByRole('button', { name: 'ไล่ราคา' }))
      await user.click(within(form).getByRole('button', { name: '3' }))
      await user.click(within(form).getByRole('button', { name: 'บันทึก' }))

      expect(await screen.findByText('ยังไม่ได้รีวิว 4')).toBeInTheDocument()
      expect(screen.queryByRole('form')).not.toBeInTheDocument()
      const nvda = screen.getByText('NVDA', { selector: 'b' }).closest('tr')!
      expect(within(nvda).getByRole('button', { name: 'รีวิวแล้ว' })).toBeInTheDocument()
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
      await user.click(await screen.findByRole('button', { name: 'รีวิวแล้ว' }))
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
      await user.click((await screen.findAllByRole('button', { name: 'รีวิว' }))[0])
      await user.type(screen.getByLabelText('รีวิวหลังปิด'), 'ไม่เก็บ')
      await user.click(screen.getByRole('button', { name: 'ยกเลิก' }))
      expect(screen.queryByRole('form')).not.toBeInTheDocument()
      expect((await db.transactions.get('sell-NVDA'))?.journal).toBeUndefined()
    })

    it('keeps one form open at a time', async () => {
      await seedFive()
      const user = userEvent.setup()
      renderRoute('/trades')
      const buttons = await screen.findAllByRole('button', { name: 'รีวิว' })
      await user.click(buttons[0])
      await user.click(buttons[1])
      expect(screen.getAllByRole('form')).toHaveLength(1)
      expect(screen.getByRole('form', { name: 'รีวิวเทรด PTT' })).toBeInTheDocument()
    })

    it('closes the form when another period is chosen', async () => {
      await seedFive()
      const user = userEvent.setup()
      renderRoute('/trades')
      await user.click((await screen.findAllByRole('button', { name: 'รีวิว' }))[0])
      await user.click(screen.getByRole('button', { name: 'ทั้งหมด' }))
      expect(screen.queryByRole('form')).not.toBeInTheDocument()
    })

    it('shows what went wrong when the review cannot be saved', async () => {
      await seedFive()
      await db.transactions.update('sell-NVDA', { journal: { score: 9 } })
      const user = userEvent.setup()
      renderRoute('/trades')
      await user.click((await screen.findAllByRole('button', { name: 'รีวิวแล้ว' }))[0])
      await user.click(screen.getByRole('button', { name: 'บันทึก' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('คะแนนการลงมือต้องเป็น 1–5')
      expect(screen.getByRole('form')).toBeInTheDocument()
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
      expect(screen.queryByRole('button', { name: /^รีวิว/ })).not.toBeInTheDocument()
      expect(screen.queryByText(/ยังไม่ได้รีวิว/)).not.toBeInTheDocument()
    })
  })

  describe('on a phone', () => {
    it('writes each table row on two lines', async () => {
      phone()
      await seedFive()
      renderRoute('/trades')
      const list = await screen.findByRole('list', { name: 'กลยุทธ์ไหนทำเงิน' })
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      const items = within(list).getAllByRole('listitem')
      expect(items.map((li) => li.textContent)).toEqual(['Pullback+2,0001 เทรด · ชนะ 100%', 'Breakout+5002 เทรด · ชนะ 50%', 'ไม่ระบุ−5002 เทรด · ชนะ 0%'])
      expect(within(screen.getByRole('list', { name: 'แยกตามเดือน' })).getByText('5 เทรด · ชนะ 40%')).toBeInTheDocument()
    })

    it('puts the strategy and the time held under the asset, with a 44px review button', async () => {
      phone()
      await seedFive()
      const user = userEvent.setup()
      renderRoute('/trades')
      const list = await screen.findByRole('list', { name: 'เทรดที่ปิดล่าสุด' })
      const items = within(list).getAllByRole('listitem')
      expect(items).toHaveLength(5)
      expect(items[2]).toHaveTextContent('ETH')
      expect(items[2]).toHaveTextContent('Pullback · ถือ 10 วัน')
      expect(items[2]).toHaveTextContent('+2,000')
      const button = within(items[2]).getByRole('button', { name: 'รีวิว' })
      expect(button).toHaveClass('min-h-11', 'min-w-11')
      await user.click(button)
      expect(within(items[2]).getByRole('form', { name: 'รีวิวเทรด ETH' })).toBeInTheDocument()
      const open = within(screen.getByRole('list', { name: 'เทรดที่เปิดอยู่' })).getAllByRole('listitem')
      expect(open[0]).toHaveTextContent('AOT')
      expect(open[0]).toHaveTextContent('ถือมา 6 วัน')
      expect(open[0]).toHaveTextContent('เปิดเมื่อ 10 ต.ค. 2024 · Pullback')
    })
  })
})

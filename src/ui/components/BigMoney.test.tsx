import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { BigMoney, BigMoneyFor, CongressTrade } from '../../market/client'
import { BigMoneySection, StockBigMoney } from './BigMoney'

const trade = (ticker: string, type: CongressTrade['type'], member = 'Josh Gottheimer'): CongressTrade => ({
  ticker,
  asset: `${ticker} Common Stock`,
  type,
  tradedAt: '2026-10-15',
  notifiedAt: '2026-10-29',
  amount: '$1,001 – $15,000',
  member,
  state: 'NJ05',
  filedAt: '2026-10-29',
  url: `https://house.test/${ticker}.pdf`,
})

const data: BigMoney = {
  funds: [
    {
      cik: '1067983',
      name: 'BERKSHIRE HATHAWAY INC',
      period: '2026-06-30',
      filedAt: '2026-08-14',
      moves: [
        { issuer: 'APPLE INC', ticker: 'AAPL', shares: '280000000', value: '60000000000', change: 'reduce', sharesChange: '-20000000', valueChange: '-10000000000' },
        { issuer: 'NEW CO', ticker: null, shares: '1000000', value: '5000000000', change: 'new', sharesChange: '1000000', valueChange: '5000000000' },
      ],
    },
  ],
  congress: [trade('NVDA', 'buy'), trade('MPC', 'sell', 'David J. Taylor')],
}

function show(state: Parameters<typeof BigMoneySection>[0]['state']) {
  render(
    <MemoryRouter>
      <BigMoneySection state={state} />
    </MemoryRouter>,
  )
  return screen.getByRole('region', { name: 'เงินใหญ่ขยับ' })
}

describe('BigMoneySection', () => {
  it('lists fund moves and House trades with a signed, coloured action', () => {
    const section = show({ status: 'ready', data })
    const apple = within(section).getByRole('listitem', { name: /AAPL/ })
    expect(apple).toHaveTextContent('BERKSHIRE HATHAWAY INC')
    expect(within(apple).getByText('− ขายบางส่วน 20M หุ้น')).toHaveClass('text-loss')
    expect(apple).toHaveTextContent('13F ไตรมาส 30 มิ.ย. 2026 · ยื่น 14 ส.ค. 2026')
    expect(within(section).getByRole('listitem', { name: /NEW CO/ })).toHaveTextContent('+ ซื้อใหม่ 1M หุ้น')
    const nvda = within(section).getByRole('listitem', { name: /NVDA/ })
    expect(nvda).toHaveTextContent('Josh Gottheimer · NJ05')
    expect(within(nvda).getByText('+ ซื้อ $1,001 – $15,000')).toHaveClass('text-gain')
    expect(nvda).toHaveTextContent('ซื้อขาย 15 ต.ค. 2026 · แจ้ง 29 ต.ค. 2026')
    expect(section).toHaveTextContent('รายงานของสภาผู้แทนฯ ช้าได้ 30–45 วันตามกฎหมาย')
    expect(within(section).getByRole('link', { name: 'ดูทั้งหมด' })).toHaveAttribute('href', '/market/bigmoney')
  })

  it('spreads the House trades on ตลาด across members', () => {
    const many = ['T', 'LRCX', 'MPC', 'COST'].map((ticker) => trade(ticker, 'buy', 'David J. Taylor'))
    const section = show({ status: 'ready', data: { funds: null, congress: [...many, trade('NVDA', 'sell', 'Josh Gottheimer')] } })
    const rows = within(section).getAllByRole('listitem').map((row) => row.getAttribute('aria-label'))
    expect(rows).toEqual(['T David J. Taylor', 'NVDA Josh Gottheimer', 'LRCX David J. Taylor', 'MPC David J. Taylor'])
  })

  it('says 13F is not switched on when the server has no SEC user agent', () => {
    expect(show({ status: 'ready', data: { ...data, funds: null } })).toHaveTextContent('ข้อมูล 13F ยังไม่เปิด')
  })
})

describe('StockBigMoney', () => {
  const forApple: BigMoneyFor = {
    holders: [{ ...data.funds![0].moves[0], fund: 'BERKSHIRE HATHAWAY INC', period: '2026-06-30', filedAt: '2026-08-14' }],
    insiders: [{ owner: 'COOK TIMOTHY D', role: 'CEO', date: '2026-10-01', side: 'sell', shares: '1000', price: '250', filedAt: '2026-10-03' }],
    congress: [trade('AAPL', 'partial')],
  }

  it('shows the funds, insiders and House members trading the stock', () => {
    render(<StockBigMoney data={forApple} />)
    const section = screen.getByRole('region', { name: 'เงินใหญ่' })
    expect(within(section).getByRole('listitem', { name: /BERKSHIRE/ })).toHaveTextContent('− ขายบางส่วน 20M หุ้น')
    const insider = within(section).getByRole('listitem', { name: /COOK TIMOTHY D/ })
    expect(insider).toHaveTextContent('CEO')
    expect(insider).toHaveTextContent('− ขาย 1,000 หุ้น @ 250.00')
    expect(insider).toHaveTextContent('Form 4 · ยื่น 3 ต.ค. 2026')
    expect(within(section).getByRole('listitem', { name: /Josh Gottheimer/ })).toHaveTextContent('− ขายบางส่วน $1,001 – $15,000')
  })

  it('shows nothing when nobody traded it', () => {
    const { container } = render(<StockBigMoney data={{ holders: [], insiders: null, congress: [] }} />)
    expect(container).toBeEmptyDOMElement()
  })
})

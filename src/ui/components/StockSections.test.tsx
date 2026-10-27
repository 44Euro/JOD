import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { FinancialPeriod, Financials } from '../../market/client'
import { FinancialsSection, ValuationSection } from './StockSections'

const year = (y: number, revenue: string | null, netIncome: string | null, freeCashFlow: string | null): FinancialPeriod => ({ period: `CY${y}`, end: `${y}-09-27`, revenue, netIncome, freeCashFlow })
const financials: Financials = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  currency: 'USD',
  shares: '10',
  annual: [year(2021, '365000000000', '94000000000', null), year(2022, '394000000000', '-5200000000', null), year(2023, '383000000000', '97000000000', null), year(2024, '391000000000', '93000000000', '100'), year(2025, '416161000000', '112000000000', '110')],
  quarterly: [{ period: 'CY2026Q2', end: '2026-06-27', revenue: '109000000000', netIncome: '29000000000', freeCashFlow: null }],
}

describe('FinancialsSection', () => {
  it('shows five years and switches to quarters', async () => {
    const user = userEvent.setup()
    render(<FinancialsSection state={{ status: 'ready', data: financials }} />)
    const section = screen.getByRole('region', { name: 'งบการเงิน' })
    const table = within(section).getByRole('table')
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['', '2021', '2022', '2023', '2024', '2025'])
    expect(within(table).getByRole('row', { name: /รายได้/ })).toHaveTextContent('416.2B')
    expect(within(table).getByRole('row', { name: /กำไรสุทธิ/ })).toHaveTextContent('−5.2B')
    expect(section).toHaveTextContent('ที่มา SEC · งบปี 2025 สิ้นสุด 27 ก.ย. 2025')
    await user.click(within(section).getByRole('button', { name: 'ไตรมาส' }))
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['', 'Q2 2026'])
  })

  it('blanks a missing figure', () => {
    render(<FinancialsSection state={{ status: 'ready', data: financials }} />)
    expect(within(screen.getByRole('table')).getByRole('row', { name: /กระแสเงินสดอิสระ/ })).toHaveTextContent('—')
  })

  it('says filings are not switched on', () => {
    render(<FinancialsSection state={{ status: 'off' }} />)
    expect(screen.getByRole('region', { name: 'งบการเงิน' })).toHaveTextContent('งบการเงินยังไม่เปิด')
  })
})

describe('ValuationSection', () => {
  it('values the share from the inputs and says how far it is from the price', async () => {
    const user = userEvent.setup()
    render(<ValuationSection state={{ status: 'ready', data: financials }} price="150" />)
    const section = screen.getByRole('region', { name: 'มูลค่า (DCF)' })
    expect(within(section).getByLabelText('การเติบโตต่อปี (%)')).toHaveValue('10')
    expect(within(section).getByLabelText('ผลตอบแทนที่ต้องการ (%)')).toHaveValue('10')
    expect(within(section).getByLabelText('จำนวนปี')).toHaveValue('5')
    expect(section).toHaveTextContent('205.33')
    expect(section).toHaveTextContent('สูงกว่าราคาตลาด 36.89%')
    expect(section).toHaveTextContent('คำนวณจากตัวเลขที่คุณใส่ ไม่ใช่คำแนะนำการลงทุน')
    await user.clear(within(section).getByLabelText('ผลตอบแทนที่ต้องการ (%)'))
    await user.type(within(section).getByLabelText('ผลตอบแทนที่ต้องการ (%)'), '2')
    expect(section).toHaveTextContent('ผลตอบแทนที่ต้องการต้องมากกว่า 2.5%')
  })

  it('explains why there is no value for negative cash flow', () => {
    const losing = { ...financials, annual: [...financials.annual.slice(0, 4), year(2025, '1', '-1', '-5')] }
    render(<ValuationSection state={{ status: 'ready', data: losing }} price="150" />)
    expect(screen.getByRole('region', { name: 'มูลค่า (DCF)' })).toHaveTextContent('กระแสเงินสดอิสระปีล่าสุดติดลบหรือไม่มี')
  })
})

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { D } from '../../domain/decimal'
import type { DividendMonth } from '../../domain/dividendCalendar'
import { DividendCalendar } from './DividendCalendar'

const month = (key: string, items: DividendMonth['items']): DividendMonth => ({ month: key, items, totalBase: items.reduce((sum, i) => sum.plus(i.amountBase), D(0)) })
const months: DividendMonth[] = [
  month('2026-11', [{ instrumentId: 'SET:PTT', currency: 'THB', amountQuote: D(108), amountBase: D(108), received: true }]),
  month('2026-12', [{ instrumentId: 'US:VOO', currency: 'USD', amountQuote: D('25.5'), amountBase: D(867), received: false }]),
  ...['2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09', '2027-10'].map((key) => month(key, [])),
]
const symbols = new Map([
  ['SET:PTT', 'PTT'],
  ['US:VOO', 'VOO'],
])

describe('DividendCalendar', () => {
  it('lists each month with received and expected dividends and a total', () => {
    render(<DividendCalendar months={months} symbols={symbols} base="THB" />)
    const card = screen.getByRole('region', { name: 'ปันผล 12 เดือนข้างหน้า' })
    expect(card).toHaveTextContent('รวม 12 เดือน ≈ ฿975')
    const november = within(card).getByRole('listitem', { name: 'พ.ย. 2026' })
    expect(november).toHaveTextContent('฿108')
    expect(within(november).getByText('PTT').closest('li')).toHaveTextContent('ได้รับแล้ว')
    const december = within(card).getByRole('listitem', { name: 'ธ.ค. 2026' })
    const voo = within(december).getByText('VOO').closest('li')!
    expect(voo).toHaveTextContent('25.50 USD')
    expect(voo).toHaveTextContent('≈ ฿867')
    expect(voo).toHaveTextContent('คาดการณ์')
    expect(voo).toHaveClass('border-dashed')
    expect(within(card).getByRole('listitem', { name: 'ม.ค. 2027' })).toHaveTextContent('—')
    expect(card).toHaveTextContent('คาดจากปันผลที่ได้รับใน 12 เดือนที่ผ่านมา × จำนวนหุ้นที่ถืออยู่')
  })

  it('shows nothing when no dividend is expected', () => {
    const { container } = render(<DividendCalendar months={months.map((m) => month(m.month, []))} symbols={symbols} base="THB" />)
    expect(container).toBeEmptyDOMElement()
  })
})

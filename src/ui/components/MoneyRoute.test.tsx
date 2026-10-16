import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MoneyRoute } from './MoneyRoute'

describe('MoneyRoute', () => {
  it('lists every station in order with its value first', () => {
    render(
      <MoneyRoute
        label="เส้นทางทดสอบ"
        stations={[
          { value: '35,000', label: 'ทุน' },
          { value: '+7,000', label: 'จากหุ้น', tone: 'gain' },
          { value: '−2,400', label: 'จากค่าเงิน', tone: 'fx', fx: true },
          { value: '39,600', label: 'วันนี้' },
        ]}
      />,
    )
    const items = within(screen.getByRole('list', { name: 'เส้นทางทดสอบ' })).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(['35,000ทุน', '+7,000จากหุ้น', '−2,400จากค่าเงิน', '39,600วันนี้'])
  })

  it('colours each leg after the station it leaves: grey for plain money, purple after a currency station', () => {
    render(
      <MoneyRoute
        label="เส้นทางสินทรัพย์"
        stations={[
          { value: '฿112,056', label: 'บาทที่ลงไป', neutral: true },
          { value: '35.00', label: 'แลกเป็น USD', fx: true },
          { value: '400.20', label: 'ทุนเฉลี่ย' },
          { value: '฿132,000', label: 'วันนี้' },
        ]}
      />,
    )
    expect(screen.getByRole('list', { name: 'เส้นทางสินทรัพย์' }).style.getPropertyValue('--route-h')).toBe(
      'linear-gradient(90deg, var(--route-neutral) 0.00% 33.33%, var(--fx) 33.33% 66.67%, var(--market-us) 66.67% 100.00%)',
    )
  })

  it('keeps space-between to phones so a desktop station stays centred in its column', () => {
    render(<MoneyRoute label="เส้นทางทดสอบ" stations={[{ value: '1', label: 'เริ่ม' }, { value: '2', label: 'จบ' }]} />)
    const [first] = within(screen.getByRole('list', { name: 'เส้นทางทดสอบ' })).getAllByRole('listitem')
    expect(first).toHaveClass('max-md:justify-between')
    expect(first).not.toHaveClass('justify-between')
  })
})

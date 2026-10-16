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
})

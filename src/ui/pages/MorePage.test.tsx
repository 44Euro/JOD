import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderRoute, resetDb } from '../../test/render'

describe('MorePage', () => {
  beforeEach(resetDb)

  it('lists the pages that moved behind เพิ่มเติม in order', async () => {
    renderRoute('/more')
    const more = await screen.findByRole('navigation', { name: 'หน้าอื่นๆ' })
    const links = within(more).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['รายการ', 'แผน', 'รายได้', 'ค่าเงิน', 'นำเข้าข้อมูล', 'ตั้งค่า'])
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/transactions', '/plans', '/income', '/fx', '/import', '/settings'])
  })
})

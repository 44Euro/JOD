import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderRoute, resetDb } from '../../test/render'

describe('MorePage', () => {
  beforeEach(resetDb)

  it('lists the pages that moved behind เพิ่มเติม in order', async () => {
    renderRoute('/more')
    const more = await screen.findByRole('navigation', { name: 'หน้าอื่นๆ' })
    const links = within(more).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['รายการ', 'รายได้', 'ค่าเงิน', 'นำเข้าข้อมูล', 'ตั้งค่า'])
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/transactions', '/income', '/fx', '/import', '/settings'])
  })
})

describe('ImportPage', () => {
  beforeEach(resetDb)

  it('says the import comes in phase 1.5 and points to the opening balance form meanwhile', async () => {
    renderRoute('/import')
    expect(await screen.findByRole('heading', { name: 'นำเข้าข้อมูล' })).toBeInTheDocument()
    expect(screen.getByText(/จะมาในเฟส 1\.5/)).toBeInTheDocument()
    const page = within(screen.getByRole('main'))
    expect(page.getByRole('link', { name: 'กรอกยอดยกมา' })).toHaveAttribute('href', '/transactions/new?type=opening')
    expect(page.getByRole('link', { name: 'บันทึกรายการ' })).toHaveAttribute('href', '/transactions/new')
  })
})

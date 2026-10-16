import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderRoute, resetDb } from '../test/render'

describe('Layout', () => {
  beforeEach(resetDb)

  it('shows the sidebar and the bottom navigation with the main pages', async () => {
    renderRoute('/')
    const sidebar = await screen.findByRole('navigation', { name: 'เมนูหลัก' })
    expect(within(sidebar).getByRole('link', { name: 'ตั้งค่า' })).toHaveAttribute('href', '/settings')
    expect(within(sidebar).getByRole('link', { name: 'พอร์ต' })).toHaveAttribute('href', '/portfolio')
    expect(within(sidebar).getByRole('link', { name: 'รายได้' })).toHaveAttribute('href', '/income')
    const bottom = screen.getByRole('navigation', { name: 'เมนูด้านล่าง' })
    expect(within(bottom).getByRole('link', { name: 'บันทึก' })).toHaveAttribute('href', '/transactions/new')
    expect(within(bottom).getByRole('link', { name: 'เพิ่มเติม' })).toHaveAttribute('href', '/more')
  })

  it('reaches income and settings on a phone through เพิ่มเติม', async () => {
    renderRoute('/more')
    const more = await screen.findByRole('navigation', { name: 'หน้าอื่นๆ' })
    expect(within(more).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/income', '/settings'])
  })

  it('marks เพิ่มเติม as the current page on the pages behind it', async () => {
    renderRoute('/income')
    const bottom = await screen.findByRole('navigation', { name: 'เมนูด้านล่าง' })
    expect(within(bottom).getByRole('link', { name: 'เพิ่มเติม' })).toHaveAttribute('aria-current', 'page')
    expect(within(bottom).getByRole('link', { name: 'ภาพรวม' })).not.toHaveAttribute('aria-current')
  })

  it('does not mark the list as the current page while a new transaction is open', async () => {
    renderRoute('/transactions/new')
    const sidebar = await screen.findByRole('navigation', { name: 'เมนูหลัก' })
    expect(within(sidebar).getByRole('link', { name: 'รายการ' })).not.toHaveAttribute('aria-current')
  })

  it('marks พอร์ต as the current page on an asset page, in the sidebar and in the bottom bar', async () => {
    renderRoute('/assets/US%3AVOO')
    const sidebar = await screen.findByRole('navigation', { name: 'เมนูหลัก' })
    expect(within(sidebar).getByRole('link', { name: 'พอร์ต' })).toHaveAttribute('aria-current', 'page')
    expect(within(sidebar).getByRole('link', { name: 'ภาพรวม' })).not.toHaveAttribute('aria-current')
    const bottom = screen.getByRole('navigation', { name: 'เมนูด้านล่าง' })
    expect(within(bottom).getByRole('link', { name: 'พอร์ต' })).toHaveAttribute('aria-current', 'page')
    expect(within(bottom).getByRole('link', { name: 'เพิ่มเติม' })).not.toHaveAttribute('aria-current')
  })
})

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
    const bottom = screen.getByRole('navigation', { name: 'เมนูด้านล่าง' })
    expect(within(bottom).getByRole('link', { name: 'บันทึก' })).toHaveAttribute('href', '/transactions/new')
  })
})

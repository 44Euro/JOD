import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { makeTx } from '../test/fixtures'
import { renderRoute, resetDb } from '../test/render'

const labels = (nav: HTMLElement) => within(nav).getAllByRole('link').map((link) => link.textContent)
const hrefs = (nav: HTMLElement) => within(nav).getAllByRole('link').map((link) => link.getAttribute('href'))

describe('Layout', () => {
  beforeEach(resetDb)

  it('lists the eight pages in the sidebar in the order of the spec', async () => {
    renderRoute('/')
    const sidebar = await screen.findByRole('navigation', { name: 'เมนูหลัก' })
    expect(labels(sidebar)).toEqual(['ภาพรวม', 'พอร์ต', 'รายการ', 'เทรด', 'รายได้', 'ค่าเงิน', 'นำเข้าข้อมูล', 'ตั้งค่า'])
    expect(hrefs(sidebar)).toEqual(['/', '/portfolio', '/transactions', '/trades', '/income', '/fx', '/import', '/settings'])
  })

  it('puts five tabs in the bottom bar with the new-transaction button in the middle', async () => {
    renderRoute('/')
    const bottom = await screen.findByRole('navigation', { name: 'เมนูด้านล่าง' })
    expect(labels(bottom)).toEqual(['ภาพรวม', 'พอร์ต', 'บันทึก', 'เทรด', 'เพิ่มเติม'])
    expect(hrefs(bottom)).toEqual(['/', '/portfolio', '/transactions/new', '/trades', '/more'])
  })

  it.each(['/more', '/income', '/fx', '/import', '/settings', '/transactions'])('marks เพิ่มเติม as the current tab on %s', async (path) => {
    renderRoute(path)
    const bottom = await screen.findByRole('navigation', { name: 'เมนูด้านล่าง' })
    expect(within(bottom).getByRole('link', { name: 'เพิ่มเติม' })).toHaveAttribute('aria-current', 'page')
    expect(within(bottom).getByRole('link', { name: 'เทรด' })).not.toHaveAttribute('aria-current')
    expect(within(bottom).getByRole('link', { name: 'ภาพรวม' })).not.toHaveAttribute('aria-current')
  })

  it('keeps เพิ่มเติม as the current tab while a transaction is being edited', async () => {
    await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
    await db.transactions.add(makeTx({ id: 'tx-edit' }))
    renderRoute('/transactions/tx-edit')
    await screen.findByRole('heading', { name: 'แก้ไขรายการ' })
    const bottom = screen.getByRole('navigation', { name: 'เมนูด้านล่าง' })
    expect(within(bottom).getByRole('link', { name: 'เพิ่มเติม' })).toHaveAttribute('aria-current', 'page')
    expect(within(bottom).getByRole('link', { name: 'บันทึก' })).not.toHaveAttribute('aria-current')
  })

  it('gives a new transaction to the บันทึก button and not to เพิ่มเติม', async () => {
    renderRoute('/transactions/new')
    const bottom = await screen.findByRole('navigation', { name: 'เมนูด้านล่าง' })
    expect(within(bottom).getByRole('link', { name: 'บันทึก' })).toHaveAttribute('aria-current', 'page')
    expect(within(bottom).getByRole('link', { name: 'เพิ่มเติม' })).not.toHaveAttribute('aria-current')
  })

  it('marks เทรด as the current tab on the trades page', async () => {
    renderRoute('/trades')
    const bottom = await screen.findByRole('navigation', { name: 'เมนูด้านล่าง' })
    expect(within(bottom).getByRole('link', { name: 'เทรด' })).toHaveAttribute('aria-current', 'page')
    expect(within(bottom).getByRole('link', { name: 'เพิ่มเติม' })).not.toHaveAttribute('aria-current')
    const sidebar = screen.getByRole('navigation', { name: 'เมนูหลัก' })
    expect(within(sidebar).getByRole('link', { name: 'เทรด' })).toHaveAttribute('aria-current', 'page')
  })

  it('marks รายการ as the current page in the sidebar on the list only', async () => {
    renderRoute('/transactions')
    const sidebar = await screen.findByRole('navigation', { name: 'เมนูหลัก' })
    expect(within(sidebar).getByRole('link', { name: 'รายการ' })).toHaveAttribute('aria-current', 'page')
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

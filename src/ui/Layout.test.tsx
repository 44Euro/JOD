import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { makeTx } from '../test/fixtures'
import { renderRoute, resetDb } from '../test/render'

const labels = (nav: HTMLElement) => within(nav).getAllByRole('link').map((link) => link.textContent)
const hrefs = (nav: HTMLElement) => within(nav).getAllByRole('link').map((link) => link.getAttribute('href'))

describe('Layout', () => {
  beforeEach(resetDb)

  it('lists the pages in the sidebar in the order of the spec, with แผน after เทรด', async () => {
    renderRoute('/')
    const sidebar = await screen.findByRole('navigation', { name: 'เมนูหลัก' })
    expect(labels(sidebar)).toEqual(['เช้านี้', 'ตลาด', 'พอร์ต', 'รายการ', 'เทรด', 'แผน', 'รายได้', 'สรุปประจำปี', 'ค่าเงิน', 'นำเข้าข้อมูล', 'ตั้งค่า'])
    expect(hrefs(sidebar)).toEqual(['/', '/market', '/portfolio', '/transactions', '/trades', '/plans', '/income', '/summary', '/fx', '/import', '/settings'])
  })

  it('uses the line chart icon for เทรด', async () => {
    renderRoute('/')
    const sidebar = await screen.findByRole('navigation', { name: 'เมนูหลัก' })
    expect(within(sidebar).getByRole('link', { name: 'เทรด' }).querySelector('svg')).toHaveClass('lucide-chart-line')
  })

  it('lets the sidebar scroll instead of squashing its parts on a short window', async () => {
    renderRoute('/')
    const sidebar = await screen.findByRole('navigation', { name: 'เมนูหลัก' })
    const aside = sidebar.parentElement!
    const logo = within(aside).getByText('JOD')
    const button = within(aside).getByRole('link', { name: 'บันทึกรายการ' })
    const legend = within(aside).getByText('สีประจำตลาด').parentElement!
    for (const part of [logo, button, sidebar, legend]) expect(part).toHaveClass('shrink-0')
    expect(aside).toHaveClass('overflow-y-auto')
  })

  it('hides the market colour legend on a window shorter than 780px', async () => {
    renderRoute('/')
    const legend = (await screen.findByText('สีประจำตลาด')).parentElement!
    expect(legend).toHaveClass('[@media(max-height:779px)]:hidden')
    expect(within(legend).getByText('ตลาดต่างประเทศอื่น')).toBeInTheDocument()
  })

  it('puts five tabs in the bottom bar with the new-transaction button in the middle', async () => {
    renderRoute('/')
    const bottom = await screen.findByRole('navigation', { name: 'เมนูด้านล่าง' })
    expect(labels(bottom)).toEqual(['เช้านี้', 'ตลาด', 'บันทึก', 'พอร์ต', 'เพิ่มเติม'])
    expect(hrefs(bottom)).toEqual(['/', '/market', '/transactions/new', '/portfolio', '/more'])
  })

  it.each(['/more', '/income', '/fx', '/import', '/settings', '/transactions'])('marks เพิ่มเติม as the current tab on %s', async (path) => {
    renderRoute(path)
    const bottom = await screen.findByRole('navigation', { name: 'เมนูด้านล่าง' })
    expect(within(bottom).getByRole('link', { name: 'เพิ่มเติม' })).toHaveAttribute('aria-current', 'page')
    expect(within(bottom).getByRole('link', { name: 'พอร์ต' })).not.toHaveAttribute('aria-current')
    expect(within(bottom).getByRole('link', { name: 'เช้านี้' })).not.toHaveAttribute('aria-current')
  })

  it('keeps เพิ่มเติม as the current tab while a transaction is being edited', async () => {
    await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
    await db.transactions.add(makeTx({ id: 'tx-edit' }))
    renderRoute('/transactions/tx-edit')
    await screen.findByRole('heading', { name: 'แก้ไขรายการ' })
    const bottom = screen.getByRole('navigation', { name: 'เมนูด้านล่าง' })
    expect(within(bottom).getByRole('link', { name: 'เพิ่มเติม' })).toHaveAttribute('aria-current', 'page')
    expect(within(bottom).getByRole('link', { name: 'บันทึก' })).not.toHaveAttribute('aria-current')
    const sidebar = screen.getByRole('navigation', { name: 'เมนูหลัก' })
    expect(within(sidebar).getByRole('link', { name: 'รายการ' })).toHaveAttribute('aria-current', 'page')
    expect(within(sidebar).getByRole('link', { name: 'เช้านี้' })).not.toHaveAttribute('aria-current')
  })

  it('keeps the bottom bar clear of the home indicator by at least 22px', async () => {
    renderRoute('/')
    const bottom = await screen.findByRole('navigation', { name: 'เมนูด้านล่าง' })
    expect(bottom).toHaveClass('pb-[max(env(safe-area-inset-bottom),22px)]')
  })

  it('gives a new transaction to the บันทึก button and not to เพิ่มเติม', async () => {
    renderRoute('/transactions/new')
    const bottom = await screen.findByRole('navigation', { name: 'เมนูด้านล่าง' })
    expect(within(bottom).getByRole('link', { name: 'บันทึก' })).toHaveAttribute('aria-current', 'page')
    expect(within(bottom).getByRole('link', { name: 'เพิ่มเติม' })).not.toHaveAttribute('aria-current')
  })

  it('marks พอร์ต as the current tab on the trades page, and เทรด in the sidebar', async () => {
    renderRoute('/trades')
    const bottom = await screen.findByRole('navigation', { name: 'เมนูด้านล่าง' })
    expect(within(bottom).getByRole('link', { name: 'พอร์ต' })).toHaveAttribute('aria-current', 'page')
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
    expect(within(sidebar).getByRole('link', { name: 'เช้านี้' })).not.toHaveAttribute('aria-current')
    const bottom = screen.getByRole('navigation', { name: 'เมนูด้านล่าง' })
    expect(within(bottom).getByRole('link', { name: 'พอร์ต' })).toHaveAttribute('aria-current', 'page')
    expect(within(bottom).getByRole('link', { name: 'เพิ่มเติม' })).not.toHaveAttribute('aria-current')
  })
})

describe('keyboard shortcuts', () => {
  beforeEach(async () => {
    await resetDb()
    await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
  })

  it('opens a new transaction with N', async () => {
    const router = renderRoute('/portfolio')
    await screen.findByRole('navigation', { name: 'เมนูหลัก' })
    fireEvent.keyDown(window, { key: 'n' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/transactions/new'))
    expect(await screen.findByRole('heading', { name: 'บันทึกรายการ' })).toBeInTheDocument()
  })

  it('ignores N while typing', async () => {
    const router = renderRoute('/transactions')
    const search = await screen.findByRole('textbox', { name: 'ค้นหา' })
    search.focus()
    fireEvent.keyDown(search, { key: 'n' })
    expect(router.state.location.pathname).toBe('/transactions')
  })

  it('ignores N with a modifier', async () => {
    const router = renderRoute('/portfolio')
    await screen.findByRole('navigation', { name: 'เมนูหลัก' })
    fireEvent.keyDown(window, { key: 'n', metaKey: true })
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true })
    expect(router.state.location.pathname).toBe('/portfolio')
  })

  it('jumps to search with /', async () => {
    const router = renderRoute('/portfolio')
    await screen.findByRole('navigation', { name: 'เมนูหลัก' })
    fireEvent.keyDown(window, { key: '/' })
    const search = await screen.findByRole('textbox', { name: 'ค้นหา' })
    expect(router.state.location.pathname).toBe('/transactions')
    await waitFor(() => expect(search).toHaveFocus())
    search.blur()
    fireEvent.keyDown(window, { key: '/' })
    expect(search).toHaveFocus()
    expect(search).toHaveAttribute('aria-keyshortcuts', '/')
  })

  it('names the shortcut on the sidebar button', async () => {
    renderRoute('/portfolio')
    const nav = await screen.findByRole('navigation', { name: 'เมนูหลัก' })
    const button = nav.parentElement!.querySelector('[aria-keyshortcuts="N"]')
    expect(button).toHaveAttribute('title', 'บันทึกรายการ (N)')
  })
})

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { logError, resetErrorsForTests } from '../../errors/log'
import { renderRoute, resetDb } from '../../test/render'

beforeEach(async () => {
  await resetDb()
  await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
  resetErrorsForTests()
})

describe('privacy and problem reports', () => {
  it('links the policy from settings and says what leaves the device', async () => {
    const user = userEvent.setup()
    renderRoute('/settings')
    await user.click(await screen.findByRole('link', { name: 'อ่านนโยบายความเป็นส่วนตัว' }))
    expect(await screen.findByRole('heading', { name: 'นโยบายความเป็นส่วนตัว' })).toBeInTheDocument()
    expect(screen.getByText(/ส่งเฉพาะคู่สกุลเงินและวันที่/)).toBeInTheDocument()
  })

  it('says the JOD server asks Yahoo for prices and searches without knowing the holdings', async () => {
    renderRoute('/privacy')
    expect(await screen.findByText(/แอปส่งสัญลักษณ์ของหุ้นที่ถือไปถามเซิร์ฟเวอร์ JOD ซึ่งไปถาม Yahoo ให้/)).toBeInTheDocument()
    expect(screen.getByText('ค้นหาสินทรัพย์')).toBeInTheDocument()
    expect(screen.getByText(/ไม่ผูกกับข้อมูลพอร์ตของคุณ/)).toBeInTheDocument()
  })

  it('says the server asks SEC for a US company’s filings when its page opens', async () => {
    renderRoute('/privacy')
    expect(await screen.findByText('หน้าหุ้น')).toBeInTheDocument()
    expect(screen.getByText(/ไปขอราคา กราฟ งบจาก SEC และข่าวของหุ้นตัวนั้น/)).toBeInTheDocument()
  })

  it('says the big-money data is public filings the server reads for everyone', async () => {
    renderRoute('/privacy')
    expect(await screen.findByText('เงินใหญ่')).toBeInTheDocument()
    expect(screen.getByText(/อ่านรายงานสาธารณะของ SEC และสภาผู้แทนฯ สหรัฐ/)).toBeInTheDocument()
  })

  it('says which symbols news asks about and that the calendar is filtered on the device', async () => {
    renderRoute('/privacy')
    expect(await screen.findByText('ข่าวและปฏิทินงบ')).toBeInTheDocument()
    expect(screen.getByText(/ปฏิทินงบดึงมาทั้งตลาดแล้วกรองในเครื่อง/)).toBeInTheDocument()
  })

  it('shows logged problems in settings and clears them', async () => {
    logError(new Error('boom 123'), '#/fx')
    const user = userEvent.setup()
    renderRoute('/settings')
    expect(await screen.findByText(/มี 1 ปัญหา/)).toBeInTheDocument()
    expect(screen.getByText('#/fx · Error: boom #')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'ล้าง' }))
    expect(screen.getByText('ยังไม่มีปัญหาที่บันทึกไว้')).toBeInTheDocument()
  })

  it('shows a friendly page instead of a crash for an unknown address', async () => {
    renderRoute('/nowhere')
    expect(await screen.findByRole('heading', { name: 'ไม่พบหน้านี้' })).toBeInTheDocument()
  })
})

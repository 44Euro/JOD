import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { getSettings } from '../../db/repo'
import { renderRoute, resetDb } from '../../test/render'

beforeEach(async () => {
  await resetDb()
})

describe('WelcomePage', () => {
  it('sets the base currency and the first account from a broker preset', async () => {
    const user = userEvent.setup()
    const router = renderRoute('/')
    await screen.findByRole('heading', { name: 'สกุลเงินหลัก' })
    expect(screen.getByText('สกุลเงินหลัก', { selector: 'li span' }).closest('li')).toHaveAttribute('aria-current', 'step')
    await user.selectOptions(screen.getByLabelText('สกุลเงินหลักของพอร์ต'), 'USD')
    await user.click(screen.getByRole('button', { name: 'ถัดไป' }))
    await user.click(await screen.findByRole('button', { name: 'Streaming' }))
    expect(screen.getByRole('button', { name: 'Streaming' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('ชื่อบัญชี')).toHaveValue('Streaming SET')
    expect(screen.getByLabelText('สกุลเงินของบัญชี')).toHaveValue('THB')
    expect(screen.getByText(/0\.157%/)).toBeInTheDocument()
    expect(screen.getByText(/ตรวจกับโบรกอีกครั้ง/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'ถัดไป' }))
    expect(await screen.findByRole('heading', { name: 'จะเริ่มอย่างไร' })).toBeInTheDocument()
    expect((await getSettings(db)).baseCurrency).toBe('USD')
    const [account] = await db.accounts.toArray()
    expect([account.name, account.broker, account.feeTemplate?.commissionPct]).toEqual(['Streaming SET', 'Streaming', '0.157'])
    expect(screen.getByRole('link', { name: /กรอกยอดยกมา/ })).toHaveAttribute('href', '/transactions/new?type=opening')
    expect(screen.getByRole('link', { name: /นำเข้าจากรูปแคปหรือไฟล์/ })).toHaveAttribute('href', '/import')
    expect(router.state.location.pathname).toBe('/welcome')
  })

  it('asks for a name before saving', async () => {
    const user = userEvent.setup()
    renderRoute('/welcome')
    await user.click(await screen.findByRole('button', { name: 'ถัดไป' }))
    await user.click(await screen.findByRole('button', { name: 'พิมพ์เอง' }))
    await user.click(screen.getByRole('button', { name: 'ถัดไป' }))
    expect(await screen.findByText('ใส่ชื่อบัญชี')).toBeInTheDocument()
    expect(await db.accounts.count()).toBe(0)
  })

  it('opens the overview with sample data', async () => {
    const user = userEvent.setup()
    const router = renderRoute('/welcome')
    await user.click(await screen.findByRole('button', { name: 'ลองดูด้วยข้อมูลตัวอย่างก่อน' }))
    expect(await screen.findByRole('link', { name: 'ข้อมูลตัวอย่าง' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('goes back to the overview when the app already has an account', async () => {
    await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
    const router = renderRoute('/welcome')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})

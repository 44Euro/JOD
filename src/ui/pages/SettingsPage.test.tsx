import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { makeTx } from '../../test/fixtures'
import { renderRoute, resetDb } from '../../test/render'

const account = { id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' }

describe('SettingsPage', () => {
  beforeEach(resetDb)

  it('adds an account and lists it', async () => {
    const user = userEvent.setup()
    renderRoute('/settings')
    await user.type(await screen.findByLabelText('ชื่อบัญชี'), 'Dime US')
    await user.type(screen.getByLabelText('โบรกเกอร์'), 'Dime')
    await user.click(screen.getByRole('button', { name: 'เพิ่มบัญชี' }))
    expect(await screen.findByText('Dime US')).toBeInTheDocument()
    expect(await db.accounts.count()).toBe(1)
  })

  it('locks the base currency once transactions exist', async () => {
    await db.accounts.add(account)
    await db.transactions.add(makeTx())
    renderRoute('/settings')
    expect(await screen.findByLabelText('สกุลเงินหลัก')).toBeDisabled()
    expect(screen.getByText(/เปลี่ยนไม่ได้หลังมีรายการแล้ว/)).toBeInTheDocument()
  })

  it('explains why an account with transactions cannot be deleted', async () => {
    await db.accounts.add(account)
    await db.transactions.add(makeTx())
    const user = userEvent.setup()
    renderRoute('/settings')
    await user.click(await screen.findByRole('button', { name: 'ลบ Dime US' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ลบไม่ได้ บัญชีนี้ยังมี 1 รายการ')
    expect(await db.accounts.count()).toBe(1)
  })
})

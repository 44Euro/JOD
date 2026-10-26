import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { LOCK_STORAGE_KEY, resetLockForTests, setPin } from '../security/lock'
import { renderRoute, resetDb } from '../test/render'

beforeEach(async () => {
  await resetDb()
  await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
  localStorage.removeItem(LOCK_STORAGE_KEY)
  resetLockForTests()
})

describe('LockGate', () => {
  it('shows nothing of the app until the PIN is entered', async () => {
    await setPin('2468')
    resetLockForTests()
    const user = userEvent.setup()
    renderRoute('/settings')
    expect(await screen.findByRole('heading', { name: 'JOD ล็อกอยู่' })).toBeInTheDocument()
    expect(screen.queryByText('Dime US')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('PIN'), '1111')
    await user.click(screen.getByRole('button', { name: 'ปลดล็อก' }))
    expect(await screen.findByText('PIN ไม่ถูก')).toBeInTheDocument()
    await user.type(screen.getByLabelText('PIN'), '2468')
    await user.click(screen.getByRole('button', { name: 'ปลดล็อก' }))
    expect(await screen.findByText('Dime US')).toBeInTheDocument()
  })

  it('lets a PIN be set from settings', async () => {
    const user = userEvent.setup()
    renderRoute('/settings')
    await user.type(await screen.findByLabelText('PIN ใหม่ (ตัวเลข 4–8 หลัก)'), '1357')
    await user.type(screen.getByLabelText('PIN อีกครั้ง'), '1357')
    await user.click(screen.getByRole('button', { name: 'ตั้ง PIN' }))
    expect(await screen.findByText(/ตั้ง PIN แล้ว/)).toBeInTheDocument()
    expect(localStorage.getItem(LOCK_STORAGE_KEY)).not.toBeNull()
  })
})

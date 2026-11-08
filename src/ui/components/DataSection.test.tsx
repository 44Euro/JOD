import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { makeTx } from '../../test/fixtures'
import { encryptText } from '../../security/crypto'
import { renderRoute, resetDb } from '../../test/render'
import { acceptConfirm } from '../../test/confirm'

const account = { id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' }

beforeEach(async () => {
  await resetDb()
  await db.accounts.add(account)
  await db.transactions.add(makeTx({ id: 'keep-me' }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

function jsonFile(content: unknown) {
  return new File([typeof content === 'string' ? content : JSON.stringify(content)], 'backup.json', {
    type: 'application/json',
  })
}

describe('DataSection', () => {
  it('keeps existing data when the chosen file is not a JOD backup', async () => {
    const user = userEvent.setup()
    renderRoute('/settings')
    await user.upload(await screen.findByLabelText('เลือกไฟล์สำรอง'), jsonFile({ app: 'other' }))
    expect(await screen.findByText('ไม่ใช่ไฟล์สำรองของ JOD หรือเป็นเวอร์ชันที่ไม่รองรับ')).toBeInTheDocument()
    expect(await db.transactions.get('keep-me')).toBeDefined()
  })

  it('replaces the data from a valid backup after confirmation', async () => {
    const other = { ...account, id: 'acc-2', name: 'Bitkub' }
    const backup = {
      app: 'jod',
      version: 1,
      exportedAt: '2024-06-01T00:00:00.000Z',
      data: { accounts: [other], instruments: [], settings: [], transactions: [makeTx({ id: 'from-file', accountId: 'acc-2' })] },
    }
    const user = userEvent.setup()
    renderRoute('/settings')
    await user.upload(await screen.findByLabelText('เลือกไฟล์สำรอง'), jsonFile(backup))
    await acceptConfirm(user, 'กู้คืน')
    expect(await screen.findByText('กู้คืนแล้ว 1 รายการ')).toBeInTheDocument()
    expect(await db.transactions.get('keep-me')).toBeUndefined()
    expect(await db.transactions.get('from-file')).toBeDefined()
  })
})

describe('DataSection sample data', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('removes the sample data and keeps the user’s own account', async () => {
    const { loadSampleData } = await import('../../db/sampleData')
    await loadSampleData(db, '2024-06-01')
    const user = userEvent.setup()
    renderRoute('/settings')
    await user.click(await screen.findByRole('button', { name: 'ลบข้อมูลตัวอย่าง' }))
    await acceptConfirm(user, 'ลบข้อมูลตัวอย่าง')
    expect(await screen.findByText('ลบข้อมูลตัวอย่างแล้ว')).toBeInTheDocument()
    expect((await db.accounts.toArray()).map((a) => a.id)).toEqual(['acc-1'])
    expect((await db.transactions.toArray()).some((t) => t.id.startsWith('sample-'))).toBe(false)
  })

  it('offers no sample button when there is no sample data', async () => {
    renderRoute('/settings')
    expect(await screen.findByRole('button', { name: 'สำรองข้อมูล' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ลบข้อมูลตัวอย่าง' })).not.toBeInTheDocument()
  })

  it('asks for the passphrase of a sealed backup and restores it only with the right one', async () => {
    const backup = {
      app: 'jod',
      version: 1,
      exportedAt: '2024-06-01T00:00:00.000Z',
      data: { accounts: [account], instruments: [], settings: [], transactions: [makeTx({ id: 'sealed-tx' })] },
    }
    const sealed = await encryptText(JSON.stringify(backup), 'long passphrase', 1000)
    const user = userEvent.setup()
    renderRoute('/settings')
    await user.upload(await screen.findByLabelText('เลือกไฟล์สำรอง'), jsonFile(sealed))
    const field = await screen.findByLabelText('ไฟล์นี้เข้ารหัสไว้ · ใส่รหัสผ่าน')
    await user.type(field, 'wrong one')
    await user.click(screen.getByRole('button', { name: 'เปิดไฟล์' }))
    expect(await screen.findByText('รหัสผ่านไม่ถูก หรือไฟล์เสียหาย')).toBeInTheDocument()
    expect(await db.transactions.get('keep-me')).toBeDefined()
    await user.clear(field)
    await user.type(field, 'long passphrase')
    await user.click(screen.getByRole('button', { name: 'เปิดไฟล์' }))
    await acceptConfirm(user, 'กู้คืน')
    expect(await screen.findByText('กู้คืนแล้ว 1 รายการ')).toBeInTheDocument()
    expect(await db.transactions.get('sealed-tx')).toBeDefined()
  })

  it('refuses a short passphrase for a sealed backup', async () => {
    const user = userEvent.setup()
    renderRoute('/settings')
    await user.click(await screen.findByLabelText('เข้ารหัสไฟล์สำรองด้วยรหัสผ่าน'))
    await user.type(screen.getByLabelText('รหัสผ่านไฟล์สำรอง'), 'short')
    await user.click(screen.getByRole('button', { name: 'สำรองข้อมูล' }))
    expect(await screen.findByText('รหัสผ่านไฟล์สำรองต้องยาวอย่างน้อย 8 ตัวอักษร')).toBeInTheDocument()
  })
})

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { makeTx } from '../../test/fixtures'
import { renderRoute, resetDb } from '../../test/render'

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
    vi.spyOn(window, 'confirm').mockReturnValue(true)
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
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderRoute('/settings')
    await user.click(await screen.findByRole('button', { name: 'ลบข้อมูลตัวอย่าง' }))
    expect(await screen.findByText('ลบข้อมูลตัวอย่างแล้ว')).toBeInTheDocument()
    expect((await db.accounts.toArray()).map((a) => a.id)).toEqual(['acc-1'])
    expect((await db.transactions.toArray()).some((t) => t.id.startsWith('sample-'))).toBe(false)
  })

  it('offers no sample button when there is no sample data', async () => {
    renderRoute('/settings')
    expect(await screen.findByRole('button', { name: 'สำรองข้อมูล' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ลบข้อมูลตัวอย่าง' })).not.toBeInTheDocument()
  })
})

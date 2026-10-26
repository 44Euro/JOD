import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { makeTx } from '../../test/fixtures'
import { renderRoute, resetDb } from '../../test/render'

const thb = { currency: 'THB', fxRate: '1', fxSource: 'same' as const }

beforeEach(async () => {
  await resetDb()
  await db.accounts.add({ id: 'acc-1', name: 'Fund', broker: '', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
  await db.instruments.add({ id: 'FUND:KFSSF', market: 'FUND', symbol: 'KFSSF', name: 'KFSSF', assetType: 'fund', currency: 'THB' })
  await db.transactions.bulkAdd([
    makeTx({ ...thb, id: 'b', instrumentId: 'FUND:KFSSF', date: '2025-03-01', quantity: '25000', price: '10' }),
    makeTx({ ...thb, id: 's', type: 'sell', instrumentId: 'FUND:KFSSF', date: '2025-09-01', quantity: '1000', price: '11' }),
  ])
})

describe('TaxPage', () => {
  it('shows the deductible part of fund purchases and warns about an early sale', async () => {
    const user = userEvent.setup()
    renderRoute('/tax')
    await user.selectOptions(await screen.findByLabelText('ปีภาษี'), '2025')
    expect(screen.getByText('฿250,000')).toBeInTheDocument()
    await user.type(screen.getByLabelText('เงินได้ทั้งปี (ไม่บังคับ)'), '600000')
    expect(screen.getByText('฿250,000 · ลดหย่อนได้ ฿180,000')).toBeInTheDocument()
    expect(screen.getByText(/ขาย KFSSF 1,000 หน่วยเมื่อ 1 ก.ย. 2025 ก่อนครบกำหนด \(1 มี.ค. 2035\)/)).toBeInTheDocument()
    const held = screen.getByRole('list', { name: 'หน่วยที่ถืออยู่' })
    expect(within(held).getByText('ขายได้ตั้งแต่ 1 มี.ค. 2035')).toBeInTheDocument()
  })
})

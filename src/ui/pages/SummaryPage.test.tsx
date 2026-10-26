import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { makeTx } from '../../test/fixtures'
import { renderRoute, resetDb } from '../../test/render'

beforeEach(async () => {
  await resetDb()
  await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
  await db.transactions.bulkAdd([
    makeTx({ id: 'b', date: '2024-01-05', quantity: '10', price: '100', fxRate: '35' }),
    makeTx({ id: 's', type: 'sell', date: '2024-02-01', quantity: '10', price: '110', fxRate: '35' }),
  ])
})

describe('SummaryPage', () => {
  it('sums up a chosen year with its Buddhist year and prints', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const user = userEvent.setup()
    renderRoute('/summary')
    await user.selectOptions(await screen.findByLabelText('ปี'), '2024')
    expect(await screen.findByRole('heading', { name: 'สรุปปี 2024' })).toBeInTheDocument()
    expect(screen.getByText(/พ.ศ. 2567 · คิดเป็น THB/)).toBeInTheDocument()
    expect(screen.getAllByText('+3,500')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'พิมพ์ / บันทึกเป็น PDF' }))
    expect(print).toHaveBeenCalled()
  })
})

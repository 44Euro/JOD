import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { getSettings, saveSettings } from '../../db/repo'
import { makeTx } from '../../test/fixtures'
import { renderRoute, resetDb } from '../../test/render'

const baht = { currency: 'THB', fxRate: '1', fxSource: 'same' as const }

beforeEach(async () => {
  await resetDb()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 1, 9, 0))
  await db.accounts.bulkAdd([
    { id: 'acc-1', name: 'Streaming', broker: 'Streaming', note: '', createdAt: '2024-01-01T00:00:00.000Z' },
    { id: 'acc-2', name: 'Bitkub', broker: 'Bitkub', note: '', createdAt: '2024-01-01T00:00:00.000Z' },
  ])
  await db.instruments.bulkAdd([
    { id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'PTT', assetType: 'stock', currency: 'THB', lastPrice: '30' },
    { id: 'SET:KBANK', market: 'SET', symbol: 'KBANK', name: 'KBANK', assetType: 'stock', currency: 'THB', lastPrice: '100' },
  ])
  await db.transactions.bulkAdd([
    makeTx({ ...baht, instrumentId: 'SET:PTT', quantity: '1000', price: '30' }),
    makeTx({ ...baht, accountId: 'acc-2', instrumentId: 'SET:KBANK', quantity: '100', price: '100' }),
  ])
})

afterEach(() => vi.useRealTimers())

const goal = (extra = {}) => ({ id: 'g1', name: 'เงินดาวน์', target: '100000', targetDate: '2028-11-01', createdAt: '2026-11-01T00:00:00.000Z', ...extra })

describe('GoalsCard', () => {
  it('invites a first goal and saves it at the top of แผน', async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    renderRoute('/plans')
    const card = await screen.findByRole('region', { name: 'เป้าหมาย' })
    expect(card).toHaveTextContent('ตั้งเป้า')
    await user.click(within(card).getByRole('button', { name: 'เพิ่มเป้าหมาย' }))
    await user.type(within(card).getByLabelText('ชื่อเป้าหมาย'), 'เงินดาวน์')
    await user.type(within(card).getByLabelText('จำนวนเงิน (THB)'), '100000')
    await user.type(within(card).getByLabelText('ภายในวันที่'), '2028-11-01')
    await user.click(within(card).getByRole('button', { name: 'บันทึกเป้าหมาย' }))
    await waitFor(async () => expect((await getSettings(db)).goals?.map((g) => [g.name, g.target, g.targetDate])).toEqual([['เงินดาวน์', '100000', '2028-11-01']]))
    expect(await within(card).findByText('มีแล้ว ฿40,000 · 40%')).toBeInTheDocument()
    expect(card).toHaveTextContent('อีก 24 เดือน')
    expect(card).toHaveTextContent('ถ้าไม่มีผลตอบแทน ต้องออมเดือนละ ฿2,500')
    // The buys are more than a year old, so the portfolio's own yearly return is offered too.
    expect(card).toHaveTextContent('ถ้าได้ผลตอบแทนปีละ')
    const page = screen.getByRole('heading', { level: 1, name: 'แผน' })
    expect(page.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('refuses a goal without a name, an amount or a future date', async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    renderRoute('/plans')
    const card = await screen.findByRole('region', { name: 'เป้าหมาย' })
    await user.click(within(card).getByRole('button', { name: 'เพิ่มเป้าหมาย' }))
    await user.click(within(card).getByRole('button', { name: 'บันทึกเป้าหมาย' }))
    expect(within(card).getByRole('alert')).toHaveTextContent('ตั้งชื่อเป้าหมาย')
    expect((await getSettings(db)).goals).toBeUndefined()
  })

  it('counts only the accounts a goal names', async () => {
    await saveSettings(db, { baseCurrency: 'THB', goals: [goal({ accountIds: ['acc-2'] })] })
    renderRoute('/plans')
    const card = await screen.findByRole('region', { name: 'เป้าหมาย' })
    expect(await within(card).findByText('มีแล้ว ฿10,000 · 10%')).toBeInTheDocument()
    expect(card).toHaveTextContent('นับจาก Bitkub')
  })

  it('offers only the no-return figure before a year of history', async () => {
    await db.transactions.clear()
    await db.transactions.add(makeTx({ ...baht, instrumentId: 'SET:PTT', quantity: '1000', price: '30', date: '2026-06-01' }))
    await saveSettings(db, { baseCurrency: 'THB', goals: [goal()] })
    renderRoute('/plans')
    const card = await screen.findByRole('region', { name: 'เป้าหมาย' })
    expect(await within(card).findByText('มีแล้ว ฿30,000 · 30%')).toBeInTheDocument()
    expect(card).toHaveTextContent('ถ้าไม่มีผลตอบแทน ต้องออมเดือนละ')
    expect(card).not.toHaveTextContent('ถ้าได้ผลตอบแทน')
  })

  it('says a goal is reached', async () => {
    await saveSettings(db, { baseCurrency: 'THB', goals: [goal({ target: '30000' })] })
    renderRoute('/plans')
    const card = await screen.findByRole('region', { name: 'เป้าหมาย' })
    expect(await within(card).findByText('ถึงเป้าแล้ว')).toBeInTheDocument()
  })

  it('switches between goals and deletes one', async () => {
    await saveSettings(db, { baseCurrency: 'THB', goals: [goal(), goal({ id: 'g2', name: 'เกษียณ', target: '400000' })] })
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    renderRoute('/plans')
    const card = await screen.findByRole('region', { name: 'เป้าหมาย' })
    await user.click(await within(card).findByRole('button', { name: 'เกษียณ' }))
    expect(within(card).getByText('มีแล้ว ฿40,000 · 10%')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'ลบเป้าหมาย เกษียณ' }))
    await waitFor(async () => expect((await getSettings(db)).goals?.map((g) => g.id)).toEqual(['g1']))
  })
})

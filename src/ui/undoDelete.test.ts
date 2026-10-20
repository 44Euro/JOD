import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import { saveTransaction } from '../db/repo'
import { makeTx } from '../test/fixtures'
import { resetDb } from '../test/render'
import { UNDO_MS, deleteWithUndo, pendingDeletes, undoDelete } from './undoDelete'

beforeEach(async () => {
  await resetDb()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
})

afterEach(() => {
  vi.useRealTimers()
})

async function saved(overrides = {}) {
  const tx = makeTx(overrides)
  await saveTransaction(db, tx)
  return (await db.transactions.get(tx.id))!
}

describe('undoDelete', () => {
  it('puts back the exact record', async () => {
    const tx = makeTx({ note: 'keep me' })
    await saveTransaction(db, tx)
    const stored = (await db.transactions.get(tx.id))!
    await deleteWithUndo(db, stored)
    expect(await db.transactions.get(tx.id)).toBeUndefined()
    await undoDelete(db, tx.id)
    expect(await db.transactions.get(tx.id)).toEqual(stored)
    expect(pendingDeletes()).toEqual([])
  })

  it('forgets a deleted row after ten seconds', async () => {
    const tx = await saved()
    await deleteWithUndo(db, tx)
    vi.advanceTimersByTime(UNDO_MS - 1)
    expect(pendingDeletes().map((p) => p.tx.id)).toEqual([tx.id])
    vi.advanceTimersByTime(1)
    expect(pendingDeletes()).toEqual([])
    expect(await db.transactions.get(tx.id)).toBeUndefined()
  })

  it('restores each of two deleted rows on its own', async () => {
    const a = await saved()
    const b = await saved()
    await deleteWithUndo(db, a)
    vi.advanceTimersByTime(4000)
    await deleteWithUndo(db, b)
    vi.advanceTimersByTime(6000)
    expect(pendingDeletes().map((p) => p.tx.id)).toEqual([b.id])
    await undoDelete(db, b.id)
    expect(await db.transactions.toArray()).toEqual([b])
    expect(pendingDeletes()).toEqual([])
  })

  it('keeps the row pending and reports why when the id is taken again', async () => {
    const tx = await saved()
    await deleteWithUndo(db, tx)
    await db.transactions.add({ ...tx, note: 'someone else' })
    await expect(undoDelete(db, tx.id)).rejects.toThrow('รายการนี้มีอยู่แล้ว')
    expect(pendingDeletes().map((p) => p.tx.id)).toEqual([tx.id])
    expect((await db.transactions.get(tx.id))!.note).toBe('someone else')
  })

  it('ignores a second press while the first restore is still running', async () => {
    const tx = await saved()
    await deleteWithUndo(db, tx)
    const results = await Promise.allSettled([undoDelete(db, tx.id), undoDelete(db, tx.id)])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(await db.transactions.count()).toBe(1)
  })
})

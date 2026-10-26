import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { createDb } from './db'
import { getSettings } from './repo'

const account = { id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' }

describe('database upgrade', () => {
  it('opens a version 1 database from sub-plan 1 without losing anything', async () => {
    const name = `test-${crypto.randomUUID()}`
    const old = new Dexie(name)
    old.version(1).stores({
      accounts: 'id, name',
      instruments: 'id, market, symbol',
      transactions: 'id, accountId, instrumentId, date, type',
      fxRates: 'key',
      settings: 'key',
    })
    const tx = makeTx({ id: 'from-v1' })
    await old.table('accounts').add(account)
    await old.table('transactions').add(tx)
    await old.table('settings').add({ key: 'app', baseCurrency: 'THB', lastBackupAt: '2026-10-01T00:00:00.000Z' })
    old.close()

    const db = createDb(name)
    await db.open()
    expect(db.verno).toBe(5)
    expect(await db.accounts.toArray()).toEqual([account])
    expect(await db.transactions.get('from-v1')).toEqual(tx)
    expect(await getSettings(db)).toEqual({ baseCurrency: 'THB', lastBackupAt: '2026-10-01T00:00:00.000Z' })
    expect(await db.dailyValues.count()).toBe(0)
    expect(await db.imports.count()).toBe(0)
    db.close()
  })
})

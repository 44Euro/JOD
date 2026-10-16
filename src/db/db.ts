import Dexie, { type EntityTable } from 'dexie'
import type { Account, Instrument, Settings, Transaction } from '../domain/types'

export interface FxRateRecord {
  key: string
  rate: string
  rateDate: string
  fetchedAt: string
}

export interface SettingsRecord extends Settings {
  key: 'app'
}

export type JodDB = Dexie & {
  accounts: EntityTable<Account, 'id'>
  instruments: EntityTable<Instrument, 'id'>
  transactions: EntityTable<Transaction, 'id'>
  fxRates: EntityTable<FxRateRecord, 'key'>
  settings: EntityTable<SettingsRecord, 'key'>
}

export function createDb(name = 'jod'): JodDB {
  const db = new Dexie(name) as JodDB
  db.version(1).stores({
    accounts: 'id, name',
    instruments: 'id, market, symbol',
    transactions: 'id, accountId, instrumentId, date, type',
    fxRates: 'key',
    settings: 'key',
  })
  return db
}

export const db = createDb()

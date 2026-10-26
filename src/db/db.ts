import Dexie, { type EntityTable } from 'dexie'
import type { Account, DcaPlan, ImportBatch, Instrument, Settings, Transaction } from '../domain/types'

export interface FxRateRecord {
  key: string
  rate: string
  rateDate: string
  fetchedAt: string
}

export interface SettingsRecord extends Settings {
  key: 'app'
}

// A snapshot of the whole portfolio on one day; unlike everything else it cannot be recomputed later.
export interface DailyValueRecord {
  date: string
  valueBase: string
  netInvestedBase: string
  recordedAt: string
  // The day's price of the index the portfolio is compared with, kept from the first price update of the day.
  benchmarkSymbol?: string
  benchmarkPrice?: string
}

export type JodDB = Dexie & {
  accounts: EntityTable<Account, 'id'>
  instruments: EntityTable<Instrument, 'id'>
  transactions: EntityTable<Transaction, 'id'>
  fxRates: EntityTable<FxRateRecord, 'key'>
  settings: EntityTable<SettingsRecord, 'key'>
  dailyValues: EntityTable<DailyValueRecord, 'date'>
  imports: EntityTable<ImportBatch, 'id'>
  plans: EntityTable<DcaPlan, 'id'>
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
  // Later versions list only what changes; Dexie keeps every version 1 table and its rows as they are.
  db.version(2).stores({ dailyValues: 'date' })
  db.version(3).stores({ transactions: 'id, accountId, instrumentId, date, type, importBatchId', imports: 'id, createdAt' })
  db.version(4).stores({ plans: 'id, instrumentId' })
  return db
}

export const db = createDb()

import { DEFAULT_SETTINGS, type Account, type Instrument, type Settings, type Transaction } from '../domain/types'
import { validateTransaction } from '../domain/validation'
import type { JodDB } from './db'

export function newId(): string {
  return crypto.randomUUID()
}

export async function getSettings(db: JodDB): Promise<Settings> {
  const row = await db.settings.get('app')
  return row ? { baseCurrency: row.baseCurrency, lastBackupAt: row.lastBackupAt } : DEFAULT_SETTINGS
}

export async function saveSettings(db: JodDB, settings: Settings): Promise<void> {
  await db.settings.put({ key: 'app', ...settings })
}

export async function addAccount(
  db: JodDB,
  input: Pick<Account, 'name' | 'broker' | 'note'>,
  now: Date = new Date(),
): Promise<Account> {
  const account: Account = { id: newId(), ...input, createdAt: now.toISOString() }
  await db.accounts.add(account)
  return account
}

export async function deleteAccount(db: JodDB, id: string): Promise<void> {
  const used = await db.transactions.where('accountId').equals(id).count()
  if (used > 0) throw new Error(`ลบไม่ได้ บัญชีนี้ยังมี ${used} รายการ`)
  await db.accounts.delete(id)
}

export async function upsertInstrument(db: JodDB, input: Omit<Instrument, 'lastPrice' | 'lastPriceAt'>): Promise<void> {
  const existing = await db.instruments.get(input.id)
  await db.instruments.put({ ...existing, ...input })
}

export async function setInstrumentPrice(db: JodDB, id: string, price: string, now: Date = new Date()): Promise<void> {
  await db.instruments.update(id, { lastPrice: price, lastPriceAt: now.toISOString() })
}

export async function saveTransaction(db: JodDB, tx: Transaction, now: Date = new Date()): Promise<void> {
  const errors = validateTransaction(tx)
  if (errors.length > 0) throw new Error(errors.join(', '))
  await db.transactions.put({ ...tx, updatedAt: now.toISOString() })
}

export async function deleteTransaction(db: JodDB, id: string): Promise<void> {
  await db.transactions.delete(id)
}

import { DEFAULT_SETTINGS, type Account, type Instrument, type Settings, type Thesis, type Transaction } from '../domain/types'
import { validateThesis, validateTransaction } from '../domain/validation'
import type { DailyValueRecord, JodDB } from './db'

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
  const [sent, received] = await Promise.all([
    db.transactions.where('accountId').equals(id).count(),
    db.transactions.filter((tx) => tx.toAccountId === id).count(),
  ])
  const used = sent + received
  if (used > 0) throw new Error(`ลบไม่ได้ บัญชีนี้ยังมี ${used} รายการ`)
  await db.accounts.delete(id)
}

// Price and thesis are edited elsewhere, so the form's instrument details never carry (or wipe) them.
export async function upsertInstrument(
  db: JodDB,
  input: Omit<Instrument, 'lastPrice' | 'lastPriceAt' | keyof Thesis>,
): Promise<void> {
  const existing = await db.instruments.get(input.id)
  await db.instruments.put({ ...existing, ...input })
}

export async function setInstrumentPrice(db: JodDB, id: string, price: string, now: Date = new Date()): Promise<void> {
  await db.instruments.update(id, { lastPrice: price, lastPriceAt: now.toISOString() })
}

// Empty fields are removed from the record rather than stored as empty strings.
export async function saveInstrumentThesis(db: JodDB, id: string, thesis: Thesis): Promise<void> {
  const errors = validateThesis(thesis)
  if (errors.length > 0) throw new Error(errors.join(', '))
  const updated = await db.instruments.update(id, {
    holdReason: thesis.holdReason.trim() || undefined,
    targetPrice: thesis.targetPrice || undefined,
    reviewDate: thesis.reviewDate || undefined,
  })
  if (updated === 0) throw new Error('ไม่พบสินทรัพย์นี้')
}

export async function saveTransaction(db: JodDB, tx: Transaction, now: Date = new Date()): Promise<void> {
  const errors = validateTransaction(tx)
  if (errors.length > 0) throw new Error(errors.join(', '))
  await db.transactions.put({ ...tx, updatedAt: now.toISOString() })
}

export async function deleteTransaction(db: JodDB, id: string): Promise<void> {
  await db.transactions.delete(id)
}

// One row per day: later runs on the same day overwrite it, so the row ends up holding the day's last
// known value. Returns whether anything was written.
export async function recordDailyValue(
  db: JodDB,
  snapshot: Omit<DailyValueRecord, 'recordedAt'>,
  now: Date = new Date(),
): Promise<boolean> {
  return db.transaction('rw', db.dailyValues, async () => {
    const existing = await db.dailyValues.get(snapshot.date)
    if (existing?.valueBase === snapshot.valueBase && existing.netInvestedBase === snapshot.netInvestedBase) return false
    await db.dailyValues.put({ ...snapshot, recordedAt: now.toISOString() })
    return true
  })
}

import { DEFAULT_SETTINGS, type Account, type Instrument, type Settings, type Thesis, type Transaction } from '../domain/types'
import { validateFeeTemplate, validateThesis, validateTransaction } from '../domain/validation'
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

export async function updateAccount(
  db: JodDB,
  id: string,
  patch: Pick<Account, 'name' | 'broker' | 'note' | 'feeTemplate'>,
): Promise<void> {
  const name = patch.name.trim()
  if (!name) throw new Error('กรุณาตั้งชื่อบัญชี')
  const errors = patch.feeTemplate ? validateFeeTemplate(patch.feeTemplate) : []
  if (errors.length > 0) throw new Error(errors[0])
  const updated = await db.accounts.update(id, { name, broker: patch.broker.trim(), note: patch.note, feeTemplate: patch.feeTemplate })
  if (updated === 0) throw new Error('ไม่พบบัญชีนี้')
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

// Every transaction is checked before the first is written, and the writes share one database transaction, so a set
// that belongs together (a dividend and the buy it paid for) is saved whole or not at all.
export async function saveTransactions(db: JodDB, txs: readonly Transaction[], now: Date = new Date()): Promise<void> {
  const errors = [...new Set(txs.flatMap((tx) => validateTransaction(tx)))]
  if (errors.length > 0) throw new Error(errors.join(', '))
  const updatedAt = now.toISOString()
  await db.transaction('rw', db.transactions, async () => {
    for (const tx of txs) await db.transactions.put({ ...tx, updatedAt })
  })
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

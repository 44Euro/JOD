import {
  DEFAULT_SETTINGS,
  instrumentKey,
  type Account,
  type Instrument,
  type Mistake,
  type Settings,
  type Thesis,
  type TradeJournal,
  type Transaction,
  type Unit,
} from '../domain/types'
import { validateFeeTemplate, validateSymbol, validateThesis, validateTransaction } from '../domain/validation'
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

// The id is MARKET:SYMBOL, so a new symbol is a new id: the instrument is re-keyed and every transaction that points at
// the old id follows it, in one database transaction. Daily values only hold totals and do not refer to instruments.
export async function renameInstrument(
  db: JodDB,
  id: string,
  change: { symbol: string; name: string; unit?: Unit },
): Promise<string> {
  const symbol = change.symbol.trim().toUpperCase()
  return db.transaction('rw', db.instruments, db.transactions, async () => {
    const existing = await db.instruments.get(id)
    if (!existing) throw new Error('ไม่พบสินทรัพย์นี้')
    // An instrument saved before the rules existed can still have its name or unit edited.
    if (symbol !== existing.symbol) {
      const errors = validateSymbol(symbol)
      if (errors.length > 0) throw new Error(errors.join(', '))
    }
    const newId = instrumentKey(existing.market, symbol)
    const submitted = change.name.trim()
    // A name that only repeated the old symbol would read "META FB" after the change, so it follows the symbol.
    const name = !submitted || (existing.name === existing.symbol && submitted === existing.name) ? symbol : submitted
    const unit = change.unit ?? existing.unit
    if (newId === id) {
      await db.instruments.put({ ...existing, name, ...(unit && { unit }) })
      return id
    }
    if (await db.instruments.get(newId)) throw new Error(`มี ${symbol} อยู่แล้ว · รวมสินทรัพย์สองตัวยังทำไม่ได้`)
    await db.instruments.add({
      ...existing,
      id: newId,
      symbol,
      name,
      ...(unit && { unit }),
      previousSymbols: [...new Set([...(existing.previousSymbols ?? []), existing.symbol])].filter((old) => old !== symbol),
    })
    await db.instruments.delete(id)
    await db.transactions.where('instrumentId').equals(id).modify({ instrumentId: newId })
    await db.transactions.filter((tx) => tx.toInstrumentId === id).modify({ toInstrumentId: newId })
    await db.transactions.filter((tx) => tx.feeInstrumentId === id).modify({ feeInstrumentId: newId })
    return newId
  })
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

// The review is written on the sell that closed the trade, next to whatever that sell's journal already says. What the
// review leaves empty is removed from the journal, so clearing a field in the form clears it in the record. Only a sell
// takes one: a swap has no journal to take it, since a restore refuses a journal on anything but a buy or a sell.
export async function saveTradeReview(
  db: JodDB,
  txId: string,
  review: { review: string; mistakes: Mistake[]; score?: number },
  now: Date = new Date(),
): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const tx = await db.transactions.get(txId)
    if (!tx) throw new Error('ไม่พบรายการนี้')
    if (tx.type !== 'sell') throw new Error('รีวิวได้เฉพาะรายการขาย')
    const journal: TradeJournal = { ...tx.journal }
    const text = review.review.trim()
    if (text) journal.review = text
    else delete journal.review
    if (review.mistakes.length > 0) journal.mistakes = [...review.mistakes]
    else delete journal.mistakes
    if (review.score !== undefined) journal.score = review.score
    else delete journal.score
    const next = Object.keys(journal).length > 0 ? journal : undefined
    const errors = validateTransaction({ ...tx, journal: next })
    if (errors.length > 0) throw new Error(errors[0])
    await db.transactions.update(txId, { journal: next, updatedAt: now.toISOString() })
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

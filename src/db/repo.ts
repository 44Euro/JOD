import { isIsoDate } from '../domain/dates'
import { D, isDecimalString } from '../domain/decimal'
import {
  DEFAULT_SETTINGS,
  PLAN_FREQUENCIES,
  instrumentKey,
  type Account,
  type DcaPlan,
  type TaxFund,
  type WatchItem,
  type TradePicture,
  type ImportBatch,
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
import { SAMPLE_INSTRUMENT_IDS, SAMPLE_PREFIX } from './sampleData'
import { t } from '../i18n'

export function newId(): string {
  return crypto.randomUUID()
}

export async function getSettings(db: JodDB): Promise<Settings> {
  const row = await db.settings.get('app')
  return row
    ? { baseCurrency: row.baseCurrency, lastBackupAt: row.lastBackupAt, hideNumbersOnLaunch: row.hideNumbersOnLaunch, theme: row.theme, benchmarkSymbol: row.benchmarkSymbol, checklist: row.checklist }
    : DEFAULT_SETTINGS
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
  if (!name) throw new Error(t('กรุณาตั้งชื่อบัญชี'))
  const errors = patch.feeTemplate ? validateFeeTemplate(patch.feeTemplate) : []
  if (errors.length > 0) throw new Error(errors[0])
  const updated = await db.accounts.update(id, { name, broker: patch.broker.trim(), note: patch.note, feeTemplate: patch.feeTemplate })
  if (updated === 0) throw new Error(t('ไม่พบบัญชีนี้'))
}

export async function deleteAccount(db: JodDB, id: string): Promise<void> {
  const [sent, received] = await Promise.all([
    db.transactions.where('accountId').equals(id).count(),
    db.transactions.filter((tx) => tx.toAccountId === id).count(),
  ])
  const used = sent + received
  if (used > 0) throw new Error(t('ลบไม่ได้ บัญชีนี้ยังมี {0} รายการ', used))
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
  if (updated === 0) throw new Error(t('ไม่พบสินทรัพย์นี้'))
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
    if (!existing) throw new Error(t('ไม่พบสินทรัพย์นี้'))
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
    if (await db.instruments.get(newId)) throw new Error(t('มี {0} อยู่แล้ว · รวมสินทรัพย์สองตัวยังทำไม่ได้', symbol))
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
    if (!tx) throw new Error(t('ไม่พบรายการนี้'))
    if (tx.type !== 'sell') throw new Error(t('รีวิวได้เฉพาะรายการขาย'))
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

// The record goes back as it was, id and timestamps included, so it lands where it sat in the ledger. It is not
// validated again: it was valid when it was saved, and an undo must not be refused for rules that have moved on.
export async function restoreTransaction(db: JodDB, tx: Transaction): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    if (await db.transactions.get(tx.id)) throw new Error(t('รายการนี้มีอยู่แล้ว'))
    await db.transactions.add(tx)
  })
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
    await db.dailyValues.put({ ...existing, ...snapshot, recordedAt: now.toISOString() })
    return true
  })
}

// Sample rows are recognised by their ids, so the user's own accounts and transactions are never touched; a sample
// instrument goes only once nothing of the user's refers to it.
export async function removeSampleData(db: JodDB): Promise<void> {
  await db.transaction('rw', db.accounts, db.instruments, db.transactions, async () => {
    const sampleAccounts = new Set((await db.accounts.toArray()).filter((a) => a.id.startsWith(SAMPLE_PREFIX)).map((a) => a.id))
    await db.transactions
      .filter((tx) => sampleAccounts.has(tx.accountId) || (tx.toAccountId !== undefined && sampleAccounts.has(tx.toAccountId)))
      .delete()
    await db.accounts.bulkDelete([...sampleAccounts])
    const used = new Set(
      (await db.transactions.toArray()).flatMap((tx) => [tx.instrumentId, tx.toInstrumentId, tx.feeInstrumentId]).filter(Boolean),
    )
    await db.instruments.bulkDelete(SAMPLE_INSTRUMENT_IDS.filter((id) => !used.has(id)))
  })
}

// The batch row, its new instruments and every record go in one database transaction: an import is saved whole or not
// at all, and the records are checked before anything is written.
export async function saveImport(
  db: JodDB,
  batch: ImportBatch,
  txs: readonly Transaction[],
  instruments: readonly Instrument[],
  now: Date = new Date(),
): Promise<void> {
  const errors = [...new Set(txs.flatMap((tx) => validateTransaction(tx)))]
  if (errors.length > 0) throw new Error(errors.join(', '))
  const updatedAt = now.toISOString()
  await db.transaction('rw', db.imports, db.instruments, db.transactions, async () => {
    for (const instrument of instruments) {
      if (!(await db.instruments.get(instrument.id))) await db.instruments.add(instrument)
    }
    await db.transactions.bulkAdd(txs.map((tx) => ({ ...tx, importBatchId: batch.id, updatedAt })))
    await db.imports.add(batch)
  })
}

// Returns how many records were removed. Records the user edited after the import still carry the batch and go too.
export async function undoImport(db: JodDB, batchId: string): Promise<number> {
  return db.transaction('rw', db.imports, db.instruments, db.transactions, async () => {
    const batch = await db.imports.get(batchId)
    const removed = await db.transactions.where('importBatchId').equals(batchId).delete()
    if (batch && batch.createdInstrumentIds.length > 0) {
      const used = new Set(
        (await db.transactions.toArray()).flatMap((tx) => [tx.instrumentId, tx.toInstrumentId, tx.feeInstrumentId]).filter(Boolean),
      )
      await db.instruments.bulkDelete(batch.createdInstrumentIds.filter((id) => !used.has(id)))
    }
    await db.imports.delete(batchId)
    return removed
  })
}

// An empty value removes the target.
export async function setTargetPct(db: JodDB, id: string, pct: string): Promise<void> {
  const value = pct.trim()
  if (value && (!isDecimalString(value) || D(value).isNegative() || D(value).gt(100))) throw new Error(t('เป้าหมายต้องเป็น 0–100%'))
  await db.instruments.update(id, { targetPct: value ? D(value).toString() : undefined })
}

export function validatePlan(plan: DcaPlan): string[] {
  const errors: string[] = []
  if (!plan.accountId) errors.push(t('เลือกบัญชี'))
  if (!plan.instrumentId) errors.push(t('เลือกสินทรัพย์'))
  if (!isDecimalString(plan.amount) || !D(plan.amount).gt(0)) errors.push(t('จำนวนเงินต่องวดต้องมากกว่า 0'))
  if (!/^[A-Z]{3,5}$/.test(plan.currency)) errors.push(t('สกุลเงินไม่ถูกต้อง'))
  if (!PLAN_FREQUENCIES.includes(plan.frequency)) errors.push(t('ความถี่ไม่ถูกต้อง'))
  if (!isIsoDate(plan.startDate)) errors.push(t('วันเริ่มไม่ถูกต้อง'))
  return errors
}

export async function savePlan(db: JodDB, plan: DcaPlan): Promise<void> {
  const errors = validatePlan(plan)
  if (errors.length > 0) throw new Error(errors.join(', '))
  await db.plans.put(plan)
}

export async function deletePlan(db: JodDB, id: string): Promise<void> {
  await db.plans.delete(id)
}

// Only a day whose value is already recorded takes a benchmark price; returns whether one was written.
export async function recordBenchmark(db: JodDB, date: string, symbol: string, price: string): Promise<boolean> {
  return db.transaction('rw', db.dailyValues, async () => {
    const row = await db.dailyValues.get(date)
    if (!row) return false
    await db.dailyValues.update(date, { benchmarkSymbol: symbol, benchmarkPrice: price })
    return true
  })
}

export async function saveWatchItem(db: JodDB, item: WatchItem): Promise<void> {
  const errors = validateSymbol(item.symbol)
  if (item.buyBelow && (!isDecimalString(item.buyBelow) || D(item.buyBelow).isNegative())) errors.push(t('ราคาที่อยากซื้อต้องเป็นตัวเลข'))
  if (errors.length > 0) throw new Error(errors.join(', '))
  await db.watchlist.put({ ...item, symbol: item.symbol.trim().toUpperCase() })
}

export async function deleteWatchItem(db: JodDB, id: string): Promise<void> {
  await db.watchlist.delete(id)
}

export async function addPictures(db: JodDB, txId: string, files: readonly File[], now: Date = new Date()): Promise<void> {
  const rows: TradePicture[] = files.map((file, i) => ({
    id: newId(),
    txId,
    name: file.name,
    blob: file,
    createdAt: new Date(now.getTime() + i).toISOString(),
  }))
  await db.pictures.bulkAdd(rows)
}

export async function deletePicture(db: JodDB, id: string): Promise<void> {
  await db.pictures.delete(id)
}

export async function setTaxFund(db: JodDB, id: string, kind: TaxFund | null): Promise<void> {
  await db.instruments.update(id, { taxFund: kind ?? undefined })
}

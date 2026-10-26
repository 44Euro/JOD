import { isIsoDate } from '../domain/dates'
import { D, isDecimalString } from '../domain/decimal'
import { cashDeltaQuote, sortTransactions } from '../domain/ledger'
import {
  IMPORT_SOURCES,
  MARKETS,
  THEME_CHOICES,
  UNITS,
  type Account,
  type DcaPlan,
  type FeeTemplate,
  type ImportBatch,
  type Instrument,
  type Market,
  type Transaction,
  type WatchItem,
} from '../domain/types'
import { validateFeeTemplate, validateTransaction } from '../domain/validation'
import type { DailyValueRecord, JodDB, SettingsRecord } from './db'
import { validatePlan } from './repo'

// Version 2 adds dailyValues. Version 1 files (from before the daily value table) still restore. imports came later
// without a new version: an older app restoring the file only loses the import history, never a record.
export interface BackupFile {
  app: 'jod'
  version: 1 | 2
  exportedAt: string
  data: {
    accounts: Account[]
    instruments: Instrument[]
    transactions: Transaction[]
    settings: SettingsRecord[]
    dailyValues?: DailyValueRecord[]
    imports?: ImportBatch[]
    plans?: DcaPlan[]
    watchlist?: WatchItem[]
  }
}

export class BackupError extends Error {
  name = 'BackupError'
}

export async function exportBackup(db: JodDB, now: Date = new Date()): Promise<BackupFile> {
  const [accounts, instruments, transactions, settings, dailyValues, imports, plans, watchlist] = await Promise.all([
    db.accounts.toArray(),
    db.instruments.toArray(),
    db.transactions.toArray(),
    db.settings.toArray(),
    db.dailyValues.toArray(),
    db.imports.toArray(),
    db.plans.toArray(),
    db.watchlist.toArray(),
  ])
  return {
    app: 'jod',
    version: 2,
    exportedAt: now.toISOString(),
    data: { accounts, instruments, transactions, settings, dailyValues, imports, plans, watchlist },
  }
}

const FEE_TEMPLATE_FIELDS = ['currency', 'commissionPct', 'minimum', 'vatPct', 'perOrder'] as const

function isValidFeeTemplate(value: unknown): value is FeeTemplate {
  if (typeof value !== 'object' || value === null) return false
  const template = value as Record<string, unknown>
  if (!FEE_TEMPLATE_FIELDS.every((field) => typeof template[field] === 'string')) return false
  return validateFeeTemplate(value as FeeTemplate).length === 0
}

export function parseBackup(text: string): BackupFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new BackupError('ไฟล์นี้ไม่ใช่ JSON')
  }
  const file = parsed as Partial<BackupFile> | null
  if (file?.app !== 'jod' || (file.version !== 1 && file.version !== 2) || !file.data) {
    throw new BackupError('ไม่ใช่ไฟล์สำรองของ JOD หรือเป็นเวอร์ชันที่ไม่รองรับ')
  }
  const { accounts, instruments, transactions, settings } = file.data
  if (![accounts, instruments, transactions, settings].every(Array.isArray)) {
    throw new BackupError('ข้อมูลในไฟล์สำรองไม่ครบ')
  }
  for (const account of accounts) {
    if (account.feeTemplate !== undefined && !isValidFeeTemplate(account.feeTemplate)) {
      throw new BackupError(`บัญชี ${account.name} มีสูตรค่าธรรมเนียมที่ไม่ถูกต้อง`)
    }
  }
  for (const instrument of instruments) {
    if (!isValidInstrument(instrument)) throw new BackupError('พบสินทรัพย์ที่เสียหายในไฟล์')
  }
  const accountIds = new Set(accounts.map((a) => a.id))
  for (const tx of transactions) {
    if (typeof tx !== 'object' || tx === null) throw new BackupError('พบรายการที่เสียหายในไฟล์')
    const errors = validateTransaction(tx)
    if (errors.length > 0) throw new BackupError(`รายการ ${tx.id} ไม่ถูกต้อง: ${errors[0]}`)
    if (!accountIds.has(tx.accountId) || (tx.toAccountId !== undefined && !accountIds.has(tx.toAccountId))) {
      throw new BackupError(`รายการ ${tx.id} อ้างถึงบัญชีที่ไม่มีในไฟล์`)
    }
  }
  for (const row of settings) {
    if (
      (row?.hideNumbersOnLaunch !== undefined && typeof row.hideNumbersOnLaunch !== 'boolean') ||
      (row?.theme !== undefined && !THEME_CHOICES.includes(row.theme)) ||
      (row?.checklist !== undefined && !(Array.isArray(row.checklist) && row.checklist.every((item) => typeof item === 'string'))) ||
      (row?.benchmarkSymbol !== undefined && (typeof row.benchmarkSymbol !== 'string' || !/^[A-Z0-9.^-]{1,12}$/.test(row.benchmarkSymbol)))
    ) {
      throw new BackupError('การตั้งค่าในไฟล์สำรองไม่ถูกต้อง')
    }
  }
  const { dailyValues = [] } = file.data
  if (!Array.isArray(dailyValues)) throw new BackupError('ข้อมูลในไฟล์สำรองไม่ครบ')
  for (const row of dailyValues) {
    const valid =
      typeof row === 'object' &&
      row !== null &&
      typeof row.date === 'string' &&
      isIsoDate(row.date) &&
      typeof row.valueBase === 'string' &&
      isDecimalString(row.valueBase) &&
      typeof row.netInvestedBase === 'string' &&
      isDecimalString(row.netInvestedBase) &&
      (row.benchmarkPrice === undefined || (typeof row.benchmarkPrice === 'string' && isDecimalString(row.benchmarkPrice))) &&
      (row.benchmarkSymbol === undefined || typeof row.benchmarkSymbol === 'string')
    if (!valid) throw new BackupError('พบมูลค่ารายวันที่เสียหายในไฟล์')
  }
  const { imports = [] } = file.data
  if (!Array.isArray(imports) || !imports.every((batch) => isValidImport(batch, accountIds))) {
    throw new BackupError('ประวัติการนำเข้าในไฟล์เสียหาย')
  }
  const { plans = [] } = file.data
  if (!Array.isArray(plans) || !plans.every((p) => typeof p === 'object' && p !== null && typeof p.id === 'string' && accountIds.has(p.accountId) && validatePlan(p).length === 0)) {
    throw new BackupError('แผนทยอยซื้อในไฟล์เสียหาย')
  }
  const { watchlist = [] } = file.data
  const validWatch = (w: Partial<WatchItem>) =>
    typeof w.id === 'string' &&
    typeof w.symbol === 'string' &&
    MARKETS.includes(w.market as Market) &&
    typeof w.note === 'string' &&
    (w.buyBelow === undefined || (typeof w.buyBelow === 'string' && isDecimalString(w.buyBelow)))
  if (!Array.isArray(watchlist) || !watchlist.every((w) => typeof w === 'object' && w !== null && validWatch(w))) {
    throw new BackupError('รายการที่ติดตามในไฟล์เสียหาย')
  }
  return file as BackupFile
}

// Runs as one transaction so a failure part-way leaves the existing data untouched.
export async function restoreBackup(db: JodDB, backup: BackupFile): Promise<void> {
  const tables = [db.accounts, db.instruments, db.transactions, db.settings, db.dailyValues, db.imports, db.plans, db.watchlist]
  await db.transaction('rw', tables, async () => {
    await Promise.all(tables.map((table) => table.clear()))
    await db.accounts.bulkAdd(backup.data.accounts)
    await db.instruments.bulkAdd(backup.data.instruments)
    await db.transactions.bulkAdd(backup.data.transactions)
    await db.settings.bulkAdd(backup.data.settings)
    await db.dailyValues.bulkAdd(backup.data.dailyValues ?? [])
    await db.imports.bulkAdd(backup.data.imports ?? [])
    await db.plans.bulkAdd(backup.data.plans ?? [])
    await db.watchlist.bulkAdd(backup.data.watchlist ?? [])
  })
}

// Pages read these fields directly: an unknown unit would print "undefined" and a non-array trail would crash S5.
function isValidInstrument(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const i = value as Partial<Instrument>
  return (
    typeof i.id === 'string' &&
    typeof i.symbol === 'string' &&
    MARKETS.includes(i.market as Market) &&
    (i.unit === undefined || UNITS.includes(i.unit)) &&
    (i.previousSymbols === undefined || (Array.isArray(i.previousSymbols) && i.previousSymbols.every((s) => typeof s === 'string'))) &&
    (i.targetPct === undefined || (typeof i.targetPct === 'string' && isDecimalString(i.targetPct) && D(i.targetPct).gte(0) && D(i.targetPct).lte(100)))
  )
}

function isValidImport(value: unknown, accountIds: ReadonlySet<string>): boolean {
  if (typeof value !== 'object' || value === null) return false
  const b = value as Partial<ImportBatch>
  return (
    typeof b.id === 'string' &&
    typeof b.accountId === 'string' &&
    accountIds.has(b.accountId) &&
    IMPORT_SOURCES.includes(b.source as ImportBatch['source']) &&
    Number.isInteger(b.fileCount) &&
    Number.isInteger(b.count) &&
    Array.isArray(b.createdInstrumentIds) &&
    b.createdInstrumentIds.every((id) => typeof id === 'string') &&
    typeof b.createdAt === 'string'
  )
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function transactionsToCsv(
  transactions: readonly Transaction[],
  accounts: readonly Account[],
  baseCurrency: string,
): string {
  const names = new Map(accounts.map((a) => [a.id, a.name]))
  const header = [
    'date', 'time', 'type', 'account', 'instrument', 'quantity', 'price', 'amount', 'currency', 'fees', 'tax',
    'fx_rate', 'fx_source', 'net_amount', `net_amount_${baseCurrency}`, 'remit_to_thailand', 'tax_year', 'to_account', 'to_instrument', 'to_quantity', 'receive_kind',
    'fee_paid_in', 'fee_instrument', 'fee_quantity', 'strategy', 'emotion', 'note',
  ]
  const rows = sortTransactions(transactions).map((tx) => {
    const net = cashDeltaQuote(tx)
    return [
      tx.date, tx.time ?? '', tx.type, names.get(tx.accountId) ?? tx.accountId, tx.instrumentId ?? '',
      tx.quantity ?? '', tx.price ?? '', tx.amount ?? '', tx.currency, tx.fees, tx.tax, tx.fxRate, tx.fxSource,
      net.toString(), net.times(D(tx.fxRate)).toString(), tx.remitToThailand ? 'yes' : '', tx.taxYear?.toString() ?? '',
      tx.toAccountId ? (names.get(tx.toAccountId) ?? tx.toAccountId) : '', tx.toInstrumentId ?? '', tx.toQuantity ?? '',
      tx.receiveKind ?? '', tx.feePaidIn ?? '', tx.feeInstrumentId ?? '', tx.feeQuantity ?? '',
      tx.journal?.strategy ?? '', tx.journal?.emotion ?? '', tx.note,
    ]
  })
  // The BOM makes Excel open the file as UTF-8 so Thai text is not garbled.
  return '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

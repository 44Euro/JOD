import { D } from '../domain/decimal'
import { cashDeltaQuote, sortTransactions } from '../domain/ledger'
import type { Account, Instrument, Transaction } from '../domain/types'
import { validateTransaction } from '../domain/validation'
import type { JodDB, SettingsRecord } from './db'

export interface BackupFile {
  app: 'jod'
  version: 1
  exportedAt: string
  data: {
    accounts: Account[]
    instruments: Instrument[]
    transactions: Transaction[]
    settings: SettingsRecord[]
  }
}

export class BackupError extends Error {
  name = 'BackupError'
}

export async function exportBackup(db: JodDB, now: Date = new Date()): Promise<BackupFile> {
  const [accounts, instruments, transactions, settings] = await Promise.all([
    db.accounts.toArray(),
    db.instruments.toArray(),
    db.transactions.toArray(),
    db.settings.toArray(),
  ])
  return { app: 'jod', version: 1, exportedAt: now.toISOString(), data: { accounts, instruments, transactions, settings } }
}

export function parseBackup(text: string): BackupFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new BackupError('ไฟล์นี้ไม่ใช่ JSON')
  }
  const file = parsed as Partial<BackupFile> | null
  if (file?.app !== 'jod' || file.version !== 1 || !file.data) {
    throw new BackupError('ไม่ใช่ไฟล์สำรองของ JOD หรือเป็นเวอร์ชันที่ไม่รองรับ')
  }
  const { accounts, instruments, transactions, settings } = file.data
  if (![accounts, instruments, transactions, settings].every(Array.isArray)) {
    throw new BackupError('ข้อมูลในไฟล์สำรองไม่ครบ')
  }
  const accountIds = new Set(accounts.map((a) => a.id))
  for (const tx of transactions) {
    if (typeof tx !== 'object' || tx === null) throw new BackupError('พบรายการที่เสียหายในไฟล์')
    const errors = validateTransaction(tx)
    if (errors.length > 0) throw new BackupError(`รายการ ${tx.id} ไม่ถูกต้อง: ${errors[0]}`)
    if (!accountIds.has(tx.accountId)) throw new BackupError(`รายการ ${tx.id} อ้างถึงบัญชีที่ไม่มีในไฟล์`)
  }
  return file as BackupFile
}

// Runs as one transaction so a failure part-way leaves the existing data untouched.
export async function restoreBackup(db: JodDB, backup: BackupFile): Promise<void> {
  await db.transaction('rw', [db.accounts, db.instruments, db.transactions, db.settings], async () => {
    await Promise.all([db.accounts.clear(), db.instruments.clear(), db.transactions.clear(), db.settings.clear()])
    await db.accounts.bulkAdd(backup.data.accounts)
    await db.instruments.bulkAdd(backup.data.instruments)
    await db.transactions.bulkAdd(backup.data.transactions)
    await db.settings.bulkAdd(backup.data.settings)
  })
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
    'fx_rate', 'fx_source', 'net_amount', `net_amount_${baseCurrency}`, 'remit_to_thailand', 'tax_year', 'note',
  ]
  const rows = sortTransactions(transactions).map((tx) => {
    const net = cashDeltaQuote(tx)
    return [
      tx.date, tx.time ?? '', tx.type, names.get(tx.accountId) ?? tx.accountId, tx.instrumentId ?? '',
      tx.quantity ?? '', tx.price ?? '', tx.amount ?? '', tx.currency, tx.fees, tx.tax, tx.fxRate, tx.fxSource,
      net.toString(), net.times(D(tx.fxRate)).toString(), tx.remitToThailand ? 'yes' : '', tx.taxYear?.toString() ?? '',
      tx.note,
    ]
  })
  // The BOM makes Excel open the file as UTF-8 so Thai text is not garbled.
  return '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

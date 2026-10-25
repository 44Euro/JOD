import type { JodDB } from '../db/db'
import { newId, saveTransactions, upsertInstrument } from '../db/repo'
import { todayLocal } from '../domain/dates'
import { computeLedger } from '../domain/ledger'
import type { Instrument, Transaction } from '../domain/types'
import { draftToTransaction, reinvestTransaction, type Draft } from './transactionDraft'
import { issueText } from './transactionText'

export interface PreparedSave {
  tx: Transaction
  written: Transaction[]
  errors: string[]
}

export interface SaveContext {
  existing?: Transaction
  others: readonly Transaction[]
  instruments: readonly Instrument[]
  baseCurrency: string
  reinvesting: boolean
  at: Date
}

// Builds what the form would write and refuses anything the ledger would skip, so a saved record always counts.
export function prepareSave(draft: Draft, ctx: SaveContext): PreparedSave {
  const today = todayLocal(ctx.at)
  const { tx, errors: draftErrors } = draftToTransaction(draft, {
    id: ctx.existing?.id ?? newId(),
    createdAt: ctx.existing?.createdAt ?? ctx.at.toISOString(),
    baseCurrency: ctx.baseCurrency,
    today,
    instruments: ctx.instruments,
  })
  // The buy sorts right after the dividend even when both carry the same date and time.
  const buy = ctx.reinvesting
    ? reinvestTransaction(draft, tx, { id: newId(), createdAt: new Date(ctx.at.getTime() + 1).toISOString(), today })
    : null
  const written = buy ? [tx, buy.tx] : [tx]
  const found = [...new Set([...draftErrors, ...(buy?.errors ?? [])])]
  if (found.length > 0) return { tx, written, errors: found }
  const ledgerErrors = computeLedger([...ctx.others, ...written])
    .issues.filter((issue) => written.some((t) => t.id === issue.txId))
    .map(issueText)
  return { tx, written, errors: [...new Set(ledgerErrors)] }
}

// A dividend can be paid in another currency than the one the instrument trades in, so a known instrument keeps what
// is stored for it; only an instrument the app has never seen is written, with the draft's currency.
export async function writeSave(
  db: JodDB,
  draft: Draft,
  { tx, written }: PreparedSave,
  instruments: readonly Instrument[],
  at: Date,
): Promise<void> {
  const entered = [
    {
      id: tx.instrumentId,
      market: draft.market,
      symbol: draft.symbol.trim().toUpperCase(),
      name: draft.instrumentName,
      assetType: draft.assetType,
      unit: draft.unit,
    },
    {
      id: tx.toInstrumentId,
      market: draft.toMarket,
      symbol: draft.toSymbol.trim().toUpperCase(),
      name: draft.toInstrumentName,
      assetType: draft.toAssetType,
      unit: draft.toUnit,
    },
  ]
  for (const { id, name, ...instrument } of entered) {
    if (id && !instruments.some((i) => i.id === id)) {
      await upsertInstrument(db, { ...instrument, id, name: name.trim() || instrument.symbol, currency: draft.currency })
    }
  }
  await saveTransactions(db, written, at)
}

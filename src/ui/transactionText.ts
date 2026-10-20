import { D } from '../domain/decimal'
import { acquisitionCostQuote, cashDeltaQuote, type LedgerIssue } from '../domain/ledger'
import { symbolOf, type Instrument, type Transaction } from '../domain/types'
import { fmtNumber, fmtPlain, fmtPrice, fmtSigned, fmtValue, plClass } from './format'
import { RECEIVE_KIND_LABELS, TX_TYPE_LABELS, unitLabel } from './labels'

type Names = ReadonlyMap<string, string>
type Instruments = ReadonlyMap<string, Instrument>

// The reason a transaction was skipped, with its quantities masked while the numbers are hidden.
export function issueText(issue: LedgerIssue): string {
  const { pattern, figures } = issue
  if (!pattern || !figures) return issue.message
  return pattern.replace(/\{(\d+)\}/g, (_, index) => fmtNumber(figures[Number(index)], 8))
}

// Only the fee of a transfer is valued at its rate, so without a fee the rate would suggest a value that is not there.
export function feeFreeTransfer(tx: Transaction): boolean {
  return tx.type === 'transfer' && D(tx.fees).isZero()
}

// A fee paid in cash is in the net column; one paid in units is not, so the row says how many.
export function feeNoteText(tx: Transaction): string {
  if (tx.feePaidIn === 'received') {
    return `หัก ${fmtNumber(tx.feeQuantity, 8)} ${symbolOf(tx.type === 'swap' ? tx.toInstrumentId : tx.instrumentId)}`
  }
  return tx.feePaidIn === 'asset' ? `ค่าธรรมเนียม ${fmtNumber(tx.feeQuantity, 8)} ${symbolOf(tx.feeInstrumentId)}` : ''
}

export function feeNote(tx: Transaction): string {
  const text = feeNoteText(tx)
  return text && ` · ${text}`
}

export function taxNoteText(tx: Transaction): string {
  const income = tx.type === 'dividend' || tx.type === 'interest' || tx.type === 'receive_asset'
  return income && D(tx.tax).greaterThan(0) ? `หัก ณ ที่จ่าย ${fmtNumber(tx.tax)}` : ''
}

export function describeAmount(tx: Transaction, accountNames?: Names, instruments?: Instruments): string {
  return describeBody(tx, accountNames, instruments) + feeNote(tx)
}

// The part of the description before the fee note, for a list that writes the currency between the two.
export function describeBody(tx: Transaction, accountNames?: Names, instruments?: Instruments): string {
  const tax = taxNoteText(tx)
  const main = describeMain(tx, accountNames, instruments)
  return tax ? `${main} ${tax}` : main
}

export function describeMain(tx: Transaction, accountNames?: Names, instruments?: Instruments): string {
  switch (tx.type) {
    case 'buy':
    case 'sell':
      return `${fmtNumber(tx.quantity, 8)} × ${fmtPrice(tx.price)}`
    case 'opening':
      return tx.instrumentId ? `${fmtNumber(tx.quantity, 8)} × ${fmtPrice(tx.price)}` : fmtNumber(tx.amount)
    case 'split':
      return `× ${fmtPlain(tx.splitRatio, 4)}`
    case 'fx_convert':
      return `${fmtNumber(tx.amount)} ${tx.currency} → ${fmtNumber(tx.toAmount)} ${tx.toCurrency ?? ''}`
    case 'transfer': {
      const to = accountNames?.get(tx.toAccountId ?? '') ?? '—'
      return tx.instrumentId
        ? `${fmtNumber(tx.quantity, 8)} ${unitLabel(instruments?.get(tx.instrumentId))} → ${to}`
        : `${fmtNumber(tx.amount)} ${tx.currency} → ${to}`
    }
    case 'swap':
      return `${fmtNumber(tx.quantity, 8)} ${symbolOf(tx.instrumentId)} → ${fmtNumber(tx.toQuantity, 8)} ${symbolOf(tx.toInstrumentId)}`
    case 'receive_asset':
      return `${fmtNumber(tx.quantity, 8)} × ${fmtPrice(tx.price)} · ${RECEIVE_KIND_LABELS[tx.receiveKind ?? 'other']}`
    default:
      return fmtNumber(tx.amount)
  }
}

// The page of the asset that paid a fee shows the fee, not the trade it was paid for.
export function describeFeePaid(tx: Transaction): string {
  return `${TX_TYPE_LABELS[tx.type]} ${symbolOf(tx.instrumentId)} · ${fmtNumber(tx.feeQuantity, 8)} ${symbolOf(tx.feeInstrumentId)}`
}

export function feePaidNet(tx: Transaction, skipped: boolean): { text: string; className: string } {
  if (skipped) return { text: '—', className: 'text-muted-foreground' }
  const cost = D(tx.fees).times(D(tx.fxRate)).negated()
  return { text: fmtSigned(cost), className: plClass(cost) }
}

// A transaction the ledger skipped moves no cash, so showing its amount would mislead. An opening holding was
// paid for before the app existed, so its row shows what it cost instead; a split moves nothing at all.
export function netOf(tx: Transaction, skipped: boolean): { text: string; className: string } {
  if (skipped || tx.type === 'split') return { text: '—', className: 'text-muted-foreground' }
  if (tx.type === 'opening' && tx.instrumentId) {
    return { text: `ทุน ${fmtValue(acquisitionCostQuote(tx).times(D(tx.fxRate)))}`, className: 'text-muted-foreground' }
  }
  if (tx.type === 'transfer') {
    // Moving something to another account of your own costs nothing but the fee.
    const cost = D(tx.fees).times(D(tx.fxRate)).negated()
    return cost.isZero() ? { text: '—', className: 'text-muted-foreground' } : { text: fmtSigned(cost), className: plClass(cost) }
  }
  if (tx.type === 'receive_asset') {
    // The row is about the income, so it shows what the units are worth after fees and tax, not the cash that moved.
    const income = D(tx.quantity).times(D(tx.price)).minus(D(tx.fees)).minus(D(tx.tax)).times(D(tx.fxRate))
    return { text: fmtSigned(income), className: plClass(income) }
  }
  const net = cashDeltaQuote(tx).times(D(tx.fxRate))
  if (tx.type === 'swap' && net.isZero()) return { text: '—', className: 'text-muted-foreground' }
  return { text: fmtSigned(net), className: plClass(net) }
}

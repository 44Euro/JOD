import { D } from '../domain/decimal'
import { acquisitionCostQuote, cashDeltaQuote } from '../domain/ledger'
import { symbolOf, type Transaction } from '../domain/types'
import { fmtNumber, fmtPrice, fmtSigned, fmtValue, plClass } from './format'
import { RECEIVE_KIND_LABELS, TX_TYPE_LABELS } from './labels'

// A fee paid in cash is in the net column; one paid in units is not, so the row says how many.
export function feeNote(tx: Transaction): string {
  if (tx.feePaidIn === 'received') {
    return ` · หัก ${fmtNumber(tx.feeQuantity, 8)} ${symbolOf(tx.type === 'swap' ? tx.toInstrumentId : tx.instrumentId)}`
  }
  return tx.feePaidIn === 'asset' ? ` · ค่าธรรมเนียม ${fmtNumber(tx.feeQuantity, 8)} ${symbolOf(tx.feeInstrumentId)}` : ''
}

export function describeAmount(tx: Transaction, accountNames?: ReadonlyMap<string, string>): string {
  return describeBody(tx, accountNames) + feeNote(tx)
}

// The part of the description before the fee note, for a list that writes the currency between the two.
export function describeBody(tx: Transaction, accountNames?: ReadonlyMap<string, string>): string {
  switch (tx.type) {
    case 'buy':
    case 'sell':
      return `${fmtNumber(tx.quantity, 8)} × ${fmtPrice(tx.price)}`
    case 'opening':
      return tx.instrumentId ? `${fmtNumber(tx.quantity, 8)} × ${fmtPrice(tx.price)}` : fmtNumber(tx.amount)
    case 'split':
      return `× ${fmtNumber(tx.splitRatio, 4)}`
    case 'fx_convert':
      return `${fmtNumber(tx.amount)} ${tx.currency} → ${fmtNumber(tx.toAmount)} ${tx.toCurrency ?? ''}`
    case 'transfer': {
      const to = accountNames?.get(tx.toAccountId ?? '') ?? '—'
      return tx.instrumentId ? `${fmtNumber(tx.quantity, 8)} หน่วย → ${to}` : `${fmtNumber(tx.amount)} ${tx.currency} → ${to}`
    }
    case 'swap':
      return `${fmtNumber(tx.quantity, 8)} ${symbolOf(tx.instrumentId)} → ${fmtNumber(tx.toQuantity, 8)} ${symbolOf(tx.toInstrumentId)}`
    case 'receive_asset': {
      const received = `${fmtNumber(tx.quantity, 8)} × ${fmtPrice(tx.price)} · ${RECEIVE_KIND_LABELS[tx.receiveKind ?? 'other']}`
      return D(tx.tax).greaterThan(0) ? `${received} หัก ณ ที่จ่าย ${fmtNumber(tx.tax)}` : received
    }
    case 'dividend':
    case 'interest':
      return D(tx.tax).greaterThan(0) ? `${fmtNumber(tx.amount)} หัก ณ ที่จ่าย ${fmtNumber(tx.tax)}` : fmtNumber(tx.amount)
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
    // Cash only moves by the tax, but the row is about the income, so it shows what the units are worth after it.
    const income = D(tx.quantity).times(D(tx.price)).minus(D(tx.fees)).minus(D(tx.tax)).times(D(tx.fxRate))
    return { text: fmtSigned(income), className: plClass(income) }
  }
  const net = cashDeltaQuote(tx).times(D(tx.fxRate))
  if (tx.type === 'swap' && net.isZero()) return { text: '—', className: 'text-muted-foreground' }
  return { text: fmtSigned(net), className: plClass(net) }
}

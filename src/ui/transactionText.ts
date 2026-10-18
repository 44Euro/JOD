import { D } from '../domain/decimal'
import { acquisitionCostQuote, cashDeltaQuote } from '../domain/ledger'
import type { Transaction } from '../domain/types'
import { fmtNumber, fmtPrice, fmtSigned, fmtValue, plClass } from './format'
import { symbolOf } from './labels'

export function describeAmount(tx: Transaction, accountNames?: ReadonlyMap<string, string>): string {
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
    case 'dividend':
    case 'interest':
      return D(tx.tax).greaterThan(0) ? `${fmtNumber(tx.amount)} หัก ณ ที่จ่าย ${fmtNumber(tx.tax)}` : fmtNumber(tx.amount)
    default:
      return fmtNumber(tx.amount)
  }
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
  const net = cashDeltaQuote(tx).times(D(tx.fxRate))
  if (tx.type === 'swap' && net.isZero()) return { text: '—', className: 'text-muted-foreground' }
  return { text: fmtSigned(net), className: plClass(net) }
}

import { D } from '../domain/decimal'
import { acquisitionCostQuote, cashDeltaQuote } from '../domain/ledger'
import type { Transaction } from '../domain/types'
import { fmtNumber, fmtPrice, fmtSigned, fmtValue, plClass } from './format'

export function describeAmount(tx: Transaction): string {
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
  const net = cashDeltaQuote(tx).times(D(tx.fxRate))
  return { text: fmtSigned(net), className: plClass(net) }
}

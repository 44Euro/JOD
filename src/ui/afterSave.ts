import { D, type Decimal } from '../domain/decimal'
import { accountTracksCash, computeLedger, positionKey, type Ledger, type Position } from '../domain/ledger'
import type { Transaction } from '../domain/types'
import { fmtMoney, fmtNumber } from './format'

export interface AfterSaveRow {
  label: string
  before: string
  after: string
  fx?: boolean
}

export interface AfterSavePreview {
  rows: AfterSaveRow[]
  warning: string | null
}

function cashOf(ledger: Ledger, accountId: string, currency: string): Decimal {
  return ledger.cash.find((row) => row.accountId === accountId && row.currency === currency)?.amount ?? D(0)
}

export function previewAfterSave(
  others: readonly Transaction[],
  tx: Transaction,
  baseCurrency: string,
  symbol: string,
  previous?: Transaction,
): AfterSavePreview {
  const saved = previous ? [...others, previous] : others
  const before = computeLedger(saved)
  const after = computeLedger([...others, tx])
  const rows: AfterSaveRow[] = []

  if (tx.instrumentId) {
    const key = positionKey(tx.accountId, tx.instrumentId)
    const was = before.positions.find((p) => p.key === key)
    const now = after.positions.find((p) => p.key === key)
    const quantity = (p?: Position) => (p ? fmtNumber(p.quantity, 8) : '0')
    const avgCost = (p?: Position) => (p ? fmtNumber(p.costQuote.div(p.quantity), 4) : '—')
    rows.push({ label: `${symbol} ที่ถือ`, before: quantity(was), after: quantity(now) })
    rows.push({ label: `ทุนเฉลี่ย (${tx.currency})`, before: avgCost(was), after: avgCost(now) })
    if (tx.currency !== baseCurrency) {
      const avgRate = (p?: Position) => (p && !p.costQuote.isZero() ? fmtNumber(p.costBase.div(p.costQuote), 4) : '—')
      rows.push({ label: 'เรทเฉลี่ยตอนซื้อ', before: avgRate(was), after: avgRate(now), fx: true })
    }
  }

  let warning: string | null = null
  if (accountTracksCash([...saved, tx], tx.accountId)) {
    const currencies = tx.type === 'fx_convert' && tx.toCurrency ? [tx.currency, tx.toCurrency] : [tx.currency]
    for (const currency of currencies) {
      const was = cashOf(before, tx.accountId, currency)
      const now = cashOf(after, tx.accountId, currency)
      if (was.equals(now)) continue
      rows.push({ label: `เงินสด ${currency}`, before: fmtMoney(was), after: fmtMoney(now) })
      if (now.lessThan(0) && !was.lessThan(0)) {
        warning = `เงินสด ${currency} จะติดลบ · ลืมบันทึกการแลกเงินหรือฝากเงินหรือเปล่า?`
      }
    }
  }
  return { rows, warning }
}

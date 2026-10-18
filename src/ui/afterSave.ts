import { D, type Decimal } from '../domain/decimal'
import { accountTracksCash, computeLedger, positionKey, receivedUnitCost, type Ledger, type Position } from '../domain/ledger'
import type { Transaction } from '../domain/types'
import { fmtMoney, fmtNumber } from './format'
import { symbolOf } from './labels'

export interface AfterSaveRow {
  label: string
  before: string
  after: string
  fx?: boolean
}

export interface SwapOutcome {
  unitCost: Decimal
  realizedQuote: Decimal
}

export interface AfterSavePreview {
  rows: AfterSaveRow[]
  warning: string | null
  swap: SwapOutcome | null
}

function cashOf(ledger: Ledger, accountId: string, currency: string): Decimal {
  return ledger.cash.find((row) => row.accountId === accountId && row.currency === currency)?.amount ?? D(0)
}

function positionOf(ledger: Ledger, accountId: string, instrumentId: string): Position | undefined {
  const key = positionKey(accountId, instrumentId)
  return ledger.positions.find((p) => p.key === key)
}

const quantity = (p?: Position) => (p ? fmtNumber(p.quantity, 8) : '0')

export function previewAfterSave(
  others: readonly Transaction[],
  tx: Transaction,
  baseCurrency: string,
  symbol: string,
  previous?: Transaction,
  accountNames?: ReadonlyMap<string, string>,
): AfterSavePreview {
  const saved = previous ? [...others, previous] : others
  const before = computeLedger(saved)
  const after = computeLedger([...others, tx])
  const rows: AfterSaveRow[] = []
  const transfer = tx.type === 'transfer'
  const toAccountId = tx.toAccountId ?? ''
  const nameOf = (accountId: string) => accountNames?.get(accountId) ?? '—'

  if (tx.instrumentId && transfer) {
    for (const accountId of [tx.accountId, toAccountId]) {
      rows.push({
        label: `${symbol} · ${nameOf(accountId)}`,
        before: quantity(positionOf(before, accountId, tx.instrumentId)),
        after: quantity(positionOf(after, accountId, tx.instrumentId)),
      })
    }
  } else if (tx.instrumentId) {
    const was = positionOf(before, tx.accountId, tx.instrumentId)
    const now = positionOf(after, tx.accountId, tx.instrumentId)
    const avgCost = (p?: Position) => (p ? fmtNumber(p.costQuote.div(p.quantity), 4) : '—')
    rows.push({ label: `${symbol} ที่ถือ`, before: quantity(was), after: quantity(now) })
    rows.push({ label: `ทุนเฉลี่ย (${tx.currency})`, before: avgCost(was), after: avgCost(now) })
    if (tx.currency !== baseCurrency) {
      const avgRate = (p?: Position) => (p && !p.costQuote.isZero() ? fmtNumber(p.costBase.div(p.costQuote), 4) : '—')
      rows.push({ label: 'เรทเฉลี่ยตอนซื้อ', before: avgRate(was), after: avgRate(now), fx: true })
    }
  }
  if (tx.type === 'swap' && tx.toInstrumentId) {
    rows.push({
      label: `${symbolOf(tx.toInstrumentId)} ที่ถือ`,
      before: quantity(positionOf(before, tx.accountId, tx.toInstrumentId)),
      after: quantity(positionOf(after, tx.accountId, tx.toInstrumentId)),
    })
  }

  const cashRow = (accountId: string, currency: string): AfterSaveRow => ({
    label: transfer ? `เงินสด ${currency} · ${nameOf(accountId)}` : `เงินสด ${currency}`,
    before: fmtMoney(cashOf(before, accountId, currency)),
    after: fmtMoney(cashOf(after, accountId, currency)),
  })

  // A transfer of cash always shows both accounts; the sending side is judged like any other cash movement.
  const cashTransfer = transfer && !tx.instrumentId
  const tracksCash = accountTracksCash([...saved, tx], tx.accountId)
  let warning: string | null = null
  if (tracksCash || cashTransfer) {
    const currencies = tx.type === 'fx_convert' && tx.toCurrency ? [tx.currency, tx.toCurrency] : [tx.currency]
    for (const currency of currencies) {
      const was = cashOf(before, tx.accountId, currency)
      const now = cashOf(after, tx.accountId, currency)
      if (was.equals(now) && !cashTransfer) continue
      rows.push(cashRow(tx.accountId, currency))
      if (tracksCash && now.lessThan(0) && !was.lessThan(0)) {
        warning = `เงินสด ${currency} จะติดลบ · ลืมบันทึกการแลกเงินหรือฝากเงินหรือเปล่า?`
      }
    }
  }
  if (cashTransfer) rows.push(cashRow(toAccountId, tx.currency))

  // A swap the ledger would skip realizes nothing.
  const realized = tx.type === 'swap' ? after.realized.find((e) => e.txId === tx.id) : undefined
  const unitCost = receivedUnitCost(tx)
  return { rows, warning, swap: realized && unitCost ? { unitCost, realizedQuote: realized.realizedQuote } : null }
}

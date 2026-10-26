import { D, type Decimal } from '../domain/decimal'
import { accountTracksCash, computeLedger, positionKey, receivedUnitCost, type Ledger, type Position } from '../domain/ledger'
import { symbolOf, type Transaction } from '../domain/types'
import { fmtMoney, fmtNumber, fmtPlain } from './format'
import { t } from '../i18n'

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
  alongside: readonly Transaction[] = [],
): AfterSavePreview {
  const saved = previous ? [...others, previous] : others
  const before = computeLedger(saved)
  const after = computeLedger([...others, tx, ...alongside])
  const rows: AfterSaveRow[] = []
  const transfer = tx.type === 'transfer'
  const swap = tx.type === 'swap'
  const toAccountId = tx.toAccountId ?? ''
  const nameOf = (accountId: string) => accountNames?.get(accountId) ?? '—'

  // A swap shows two coins side by side, so each of its rows says which coin it is about.
  const holdingRows = (instrumentId: string, name: string): AfterSaveRow[] => {
    const was = positionOf(before, tx.accountId, instrumentId)
    const now = positionOf(after, tx.accountId, instrumentId)
    const avgCost = (p?: Position) => (p ? fmtPlain(p.costQuote.div(p.quantity), 4) : '—')
    const avgRate = (p?: Position) => (p && !p.costQuote.isZero() ? fmtPlain(p.costBase.div(p.costQuote), 4) : '—')
    const holding: AfterSaveRow[] = [
      { label: t('{0} ที่ถือ', name), before: quantity(was), after: quantity(now) },
      { label: swap ? t('ทุนเฉลี่ย {0} ({1})', name, tx.currency) : t('ทุนเฉลี่ย ({0})', tx.currency), before: avgCost(was), after: avgCost(now) },
    ]
    if (tx.currency !== baseCurrency) {
      holding.push({ label: swap ? t('เรทเฉลี่ยตอนซื้อ {0}', name) : t('เรทเฉลี่ยตอนซื้อ'), before: avgRate(was), after: avgRate(now), fx: true })
    }
    return holding
  }

  if (tx.instrumentId && transfer) {
    for (const accountId of [tx.accountId, toAccountId]) {
      rows.push({
        label: `${symbol} · ${nameOf(accountId)}`,
        before: quantity(positionOf(before, accountId, tx.instrumentId)),
        after: quantity(positionOf(after, accountId, tx.instrumentId)),
      })
    }
  } else if (tx.instrumentId) {
    rows.push(...holdingRows(tx.instrumentId, symbol))
  }
  if (swap && tx.toInstrumentId) rows.push(...holdingRows(tx.toInstrumentId, symbolOf(tx.toInstrumentId)))
  if (tx.feePaidIn === 'asset' && tx.feeInstrumentId) {
    rows.push({
      label: t('{0} ที่ถือ', symbolOf(tx.feeInstrumentId)),
      before: quantity(positionOf(before, tx.accountId, tx.feeInstrumentId)),
      after: quantity(positionOf(after, tx.accountId, tx.feeInstrumentId)),
    })
  }

  const cashRow = (accountId: string, currency: string): AfterSaveRow => ({
    label: transfer ? t('เงินสด {0} · {1}', currency, nameOf(accountId)) : t('เงินสด {0}', currency),
    before: fmtMoney(cashOf(before, accountId, currency)),
    after: fmtMoney(cashOf(after, accountId, currency)),
  })

  // A transfer of cash always shows both accounts; the sending side is judged like any other cash movement.
  const cashTransfer = transfer && !tx.instrumentId
  const tracksCash = accountTracksCash([...saved, tx, ...alongside], tx.accountId)
  let warning: string | null = null
  if (tracksCash || cashTransfer) {
    const currencies = tx.type === 'fx_convert' && tx.toCurrency ? [tx.currency, tx.toCurrency] : [tx.currency]
    for (const currency of currencies) {
      const was = cashOf(before, tx.accountId, currency)
      const now = cashOf(after, tx.accountId, currency)
      if (was.equals(now) && !cashTransfer) continue
      rows.push(cashRow(tx.accountId, currency))
      if (tracksCash && now.lessThan(0) && !was.lessThan(0)) {
        warning = t('เงินสด {0} จะติดลบ · ลืมบันทึกการแลกเงินหรือฝากเงินหรือเปล่า?', currency)
      }
    }
  }
  if (cashTransfer) rows.push(cashRow(toAccountId, tx.currency))

  // A swap the ledger would skip realizes nothing.
  const realized = tx.type === 'swap' ? after.realized.find((e) => e.txId === tx.id) : undefined
  const unitCost = receivedUnitCost(tx)
  return { rows, warning, swap: realized && unitCost ? { unitCost, realizedQuote: realized.realizedQuote } : null }
}

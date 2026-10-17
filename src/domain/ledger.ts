import { D, Decimal } from './decimal'
import type { Transaction } from './types'

export interface Position {
  key: string
  accountId: string
  instrumentId: string
  currency: string
  quantity: Decimal
  costQuote: Decimal
  costBase: Decimal
}

export interface RealizedEvent {
  txId: string
  date: string
  accountId: string
  instrumentId: string
  currency: string
  quantity: Decimal
  proceedsQuote: Decimal
  costQuote: Decimal
  realizedQuote: Decimal
  proceedsBase: Decimal
  costBase: Decimal
  realizedBase: Decimal
  priceEffectBase: Decimal
  fxEffectBase: Decimal
}

export type IncomeKind = 'dividend' | 'interest'

export interface IncomeEvent {
  txId: string
  date: string
  accountId: string
  instrumentId: string
  kind: IncomeKind
  currency: string
  grossQuote: Decimal
  taxQuote: Decimal
  netQuote: Decimal
  grossBase: Decimal
  taxBase: Decimal
  netBase: Decimal
}

export interface CashBalance {
  accountId: string
  currency: string
  amount: Decimal
}

export interface LedgerIssue {
  txId: string
  message: string
}

export interface Ledger {
  positions: Position[]
  realized: RealizedEvent[]
  income: IncomeEvent[]
  cash: CashBalance[]
  feesBase: Decimal
  issues: LedgerIssue[]
}

export function positionKey(accountId: string, instrumentId: string): string {
  return `${accountId}|${instrumentId}`
}

export function sortTransactions(transactions: readonly Transaction[]): Transaction[] {
  return [...transactions].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.time ?? '').localeCompare(b.time ?? '') ||
      a.createdAt.localeCompare(b.createdAt),
  )
}

export function acquisitionCostQuote(tx: Transaction): Decimal {
  return D(tx.quantity).times(D(tx.price)).plus(D(tx.fees)).plus(D(tx.tax))
}

// The cost that leaves a position with `quantity` units: the average cost per unit times the units, or
// everything when the whole holding goes so no rounding residue is left behind.
export function takeCost(position: Position, quantity: Decimal): { costQuote: Decimal; costBase: Decimal; closesAll: boolean } {
  const closesAll = quantity.equals(position.quantity)
  return {
    costQuote: closesAll ? position.costQuote : position.costQuote.div(position.quantity).times(quantity),
    costBase: closesAll ? position.costBase : position.costBase.div(position.quantity).times(quantity),
    closesAll,
  }
}

// An account that only ever records trades has no cash history, so the cash computed for it only reflects
// the trades and is not a real balance.
export function accountTracksCash(transactions: readonly Transaction[], accountId: string): boolean {
  return transactions.some(
    (t) =>
      t.accountId === accountId &&
      (t.type === 'deposit' || t.type === 'withdraw' || t.type === 'fx_convert' || (t.type === 'opening' && !t.instrumentId)),
  )
}

// Signed cash movement in the transaction's own currency (the source side for fx_convert, whose fee is
// taken out of the amount exchanged, so it is already inside `amount`).
export function cashDeltaQuote(tx: Transaction): Decimal {
  const fees = D(tx.fees)
  const tax = D(tx.tax)
  switch (tx.type) {
    case 'buy':
      return acquisitionCostQuote(tx).negated()
    case 'sell':
      return D(tx.quantity).times(D(tx.price)).minus(fees).minus(tax)
    case 'dividend':
    case 'interest':
      return D(tx.amount).minus(fees).minus(tax)
    case 'deposit':
      return D(tx.amount).minus(fees)
    case 'withdraw':
    case 'fee':
      return D(tx.amount).plus(fees).plus(tax).negated()
    case 'fx_convert':
      return D(tx.amount).negated()
    case 'transfer':
      return tx.instrumentId ? fees.negated() : D(tx.amount).plus(fees).negated()
    // An opening holding was paid for before the app existed, so only opening cash moves cash.
    case 'opening':
      return tx.instrumentId ? D(0) : D(tx.amount)
    case 'split':
      return D(0)
  }
}

// Cash the receiving account gets from a transfer; a transfer of units brings none.
export function transferInQuote(tx: Transaction): Decimal {
  return tx.type === 'transfer' && !tx.instrumentId ? D(tx.amount) : D(0)
}

// Tax on dividends and interest is withholding tax, so it is reported under income instead.
export function feesQuote(tx: Transaction): Decimal {
  const fees = D(tx.fees)
  if (tx.type === 'buy' || tx.type === 'sell') return fees.plus(D(tx.tax))
  if (tx.type === 'fee') return fees.plus(D(tx.amount)).plus(D(tx.tax))
  return fees
}

export function computeLedger(transactions: readonly Transaction[]): Ledger {
  const positions = new Map<string, Position>()
  const cash = new Map<string, CashBalance>()
  const realized: RealizedEvent[] = []
  const income: IncomeEvent[] = []
  const issues: LedgerIssue[] = []
  let feesBase = D(0)

  const addCash = (accountId: string, currency: string, delta: Decimal) => {
    const key = `${accountId}|${currency}`
    const row = cash.get(key) ?? { accountId, currency, amount: D(0) }
    row.amount = row.amount.plus(delta)
    cash.set(key, row)
  }

  for (const tx of sortTransactions(transactions)) {
    const rate = D(tx.fxRate)
    const instrumentId = tx.instrumentId ?? ''
    const key = positionKey(tx.accountId, instrumentId)
    const held = positions.get(key)
    const acquires = tx.type === 'buy' || (tx.type === 'opening' && Boolean(tx.instrumentId))

    if ((acquires || tx.type === 'sell') && held && held.currency !== tx.currency) {
      issues.push({ txId: tx.id, message: `สกุลเงิน ${tx.currency} ไม่ตรงกับที่ถืออยู่ (${held.currency})` })
      continue
    }

    if (acquires) {
      const position = held ?? {
        key,
        accountId: tx.accountId,
        instrumentId,
        currency: tx.currency,
        quantity: D(0),
        costQuote: D(0),
        costBase: D(0),
      }
      const cost = acquisitionCostQuote(tx)
      position.quantity = position.quantity.plus(D(tx.quantity))
      position.costQuote = position.costQuote.plus(cost)
      position.costBase = position.costBase.plus(cost.times(rate))
      positions.set(key, position)
    }

    if (tx.type === 'sell') {
      const quantity = D(tx.quantity)
      if (!held || held.quantity.lessThan(quantity)) {
        issues.push({ txId: tx.id, message: `ขาย ${quantity} หน่วย แต่ถืออยู่ ${held?.quantity ?? 0} หน่วย` })
        continue
      }
      const { costQuote, costBase, closesAll } = takeCost(held, quantity)
      const proceedsQuote = cashDeltaQuote(tx)
      const proceedsBase = proceedsQuote.times(rate)
      const realizedQuote = proceedsQuote.minus(costQuote)
      const realizedBase = proceedsBase.minus(costBase)
      // Price effect is valued at the rate the units were bought at; whatever is left is currency.
      const costRate = costQuote.isZero() ? rate : costBase.div(costQuote)
      const priceEffectBase = realizedQuote.times(costRate)
      realized.push({
        txId: tx.id,
        date: tx.date,
        accountId: tx.accountId,
        instrumentId,
        currency: tx.currency,
        quantity,
        proceedsQuote,
        costQuote,
        realizedQuote,
        proceedsBase,
        costBase,
        realizedBase,
        priceEffectBase,
        fxEffectBase: realizedBase.minus(priceEffectBase),
      })
      if (closesAll) {
        positions.delete(key)
      } else {
        held.quantity = held.quantity.minus(quantity)
        held.costQuote = held.costQuote.minus(costQuote)
        held.costBase = held.costBase.minus(costBase)
      }
    }

    if (tx.type === 'transfer' && tx.instrumentId) {
      const toAccountId = tx.toAccountId ?? ''
      const quantity = D(tx.quantity)
      if (!held || held.quantity.lessThan(quantity)) {
        issues.push({ txId: tx.id, message: `โอน ${quantity} หน่วย แต่ถืออยู่ ${held?.quantity ?? 0} หน่วย` })
        continue
      }
      const toKey = positionKey(toAccountId, instrumentId)
      const target = positions.get(toKey)
      if (target && target.currency !== held.currency) {
        issues.push({
          txId: tx.id,
          message: `สกุลเงิน ${held.currency} ไม่ตรงกับที่ถืออยู่ในบัญชีปลายทาง (${target.currency})`,
        })
        continue
      }
      const { costQuote, costBase, closesAll } = takeCost(held, quantity)
      if (closesAll) {
        positions.delete(key)
      } else {
        held.quantity = held.quantity.minus(quantity)
        held.costQuote = held.costQuote.minus(costQuote)
        held.costBase = held.costBase.minus(costBase)
      }
      // Read after the sending side was updated, so a transfer to the same account cannot count twice.
      const received = positions.get(toKey) ?? {
        key: toKey,
        accountId: toAccountId,
        instrumentId,
        currency: held.currency,
        quantity: D(0),
        costQuote: D(0),
        costBase: D(0),
      }
      received.quantity = received.quantity.plus(quantity)
      received.costQuote = received.costQuote.plus(costQuote)
      received.costBase = received.costBase.plus(costBase)
      positions.set(toKey, received)
    }

    if (tx.type === 'split') {
      if (!held) {
        issues.push({ txId: tx.id, message: 'ไม่มีสินทรัพย์นี้ในพอร์ต ณ วันที่แตกพาร์' })
        continue
      }
      held.quantity = held.quantity.times(D(tx.splitRatio))
    }

    if (tx.type === 'dividend' || tx.type === 'interest') {
      const netQuote = cashDeltaQuote(tx)
      income.push({
        txId: tx.id,
        date: tx.date,
        accountId: tx.accountId,
        instrumentId,
        kind: tx.type,
        currency: tx.currency,
        grossQuote: D(tx.amount),
        taxQuote: D(tx.tax),
        netQuote,
        grossBase: D(tx.amount).times(rate),
        taxBase: D(tx.tax).times(rate),
        netBase: netQuote.times(rate),
      })
    }

    addCash(tx.accountId, tx.currency, cashDeltaQuote(tx))
    const cashIn = transferInQuote(tx)
    if (!cashIn.isZero()) addCash(tx.toAccountId ?? '', tx.currency, cashIn)
    if (tx.type === 'fx_convert' && tx.toCurrency) addCash(tx.accountId, tx.toCurrency, D(tx.toAmount))
    feesBase = feesBase.plus(feesQuote(tx).times(rate))
  }

  return {
    positions: [...positions.values()].sort((a, b) => a.key.localeCompare(b.key)),
    realized,
    income,
    cash: [...cash.values()].filter((row) => !row.amount.isZero()),
    feesBase,
    issues,
  }
}

import { D, Decimal } from './decimal'
import { symbolOf, type Transaction } from './types'

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

export type IncomeKind = 'dividend' | 'interest' | 'receive_asset'

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

// What an asset received as income is worth on the day: both its cost and the income it counts as.
function receivedValueQuote(tx: Transaction): Decimal {
  return D(tx.quantity).times(D(tx.price))
}

// The coin received in a swap costs the value it was swapped at plus the fees and tax paid on top.
function receivedCostQuote(tx: Transaction): Decimal {
  return D(tx.amount).plus(D(tx.fees)).plus(D(tx.tax))
}

export function receivedUnitCost(tx: Transaction): Decimal | null {
  const quantity = D(tx.toQuantity)
  return quantity.greaterThan(0) ? receivedCostQuote(tx).div(quantity) : null
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
    // Only the fees and tax are paid in cash; the coin given up pays for the coin received, and an asset
    // received as income costs nothing in cash.
    case 'swap':
    case 'receive_asset':
      return fees.plus(tax).negated()
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
  if (tx.type === 'buy' || tx.type === 'sell' || tx.type === 'swap') return fees.plus(D(tx.tax))
  if (tx.type === 'fee') return fees.plus(D(tx.amount)).plus(D(tx.tax))
  return fees
}

type TakenCost = ReturnType<typeof takeCost>

function realizedEvent(tx: Transaction, quantity: Decimal, proceedsQuote: Decimal, cost: TakenCost): RealizedEvent {
  const rate = D(tx.fxRate)
  const proceedsBase = proceedsQuote.times(rate)
  const realizedQuote = proceedsQuote.minus(cost.costQuote)
  const realizedBase = proceedsBase.minus(cost.costBase)
  // Price effect is valued at the rate the units were bought at; whatever is left is currency.
  const costRate = cost.costQuote.isZero() ? rate : cost.costBase.div(cost.costQuote)
  const priceEffectBase = realizedQuote.times(costRate)
  return {
    txId: tx.id,
    date: tx.date,
    accountId: tx.accountId,
    instrumentId: tx.instrumentId ?? '',
    currency: tx.currency,
    quantity,
    proceedsQuote,
    costQuote: cost.costQuote,
    realizedQuote,
    proceedsBase,
    costBase: cost.costBase,
    realizedBase,
    priceEffectBase,
    fxEffectBase: realizedBase.minus(priceEffectBase),
  }
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

  const removeUnits = (key: string, position: Position, quantity: Decimal, cost: TakenCost) => {
    if (cost.closesAll) {
      positions.delete(key)
    } else {
      position.quantity = position.quantity.minus(quantity)
      position.costQuote = position.costQuote.minus(cost.costQuote)
      position.costBase = position.costBase.minus(cost.costBase)
    }
  }

  for (const tx of sortTransactions(transactions)) {
    const rate = D(tx.fxRate)
    const instrumentId = tx.instrumentId ?? ''
    const key = positionKey(tx.accountId, instrumentId)
    const held = positions.get(key)
    const acquires = tx.type === 'buy' || tx.type === 'receive_asset' || (tx.type === 'opening' && Boolean(tx.instrumentId))

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
      const cost = tx.type === 'receive_asset' ? receivedValueQuote(tx) : acquisitionCostQuote(tx)
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
      const cost = takeCost(held, quantity)
      realized.push(realizedEvent(tx, quantity, cashDeltaQuote(tx), cost))
      removeUnits(key, held, quantity, cost)
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
      const cost = takeCost(held, quantity)
      removeUnits(key, held, quantity, cost)
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
      received.costQuote = received.costQuote.plus(cost.costQuote)
      received.costBase = received.costBase.plus(cost.costBase)
      positions.set(toKey, received)
    }

    if (tx.type === 'swap') {
      const quantity = D(tx.quantity)
      const toInstrumentId = tx.toInstrumentId ?? ''
      const toKey = positionKey(tx.accountId, toInstrumentId)
      const wrongCurrency = [held, positions.get(toKey)].find((p) => p && p.currency !== tx.currency)
      if (wrongCurrency) {
        // Either coin of a swap can be the one in the wrong currency, so the message names it.
        issues.push({
          txId: tx.id,
          message: `${symbolOf(wrongCurrency.instrumentId)} ถืออยู่เป็น ${wrongCurrency.currency} · รายการนี้ใช้ ${tx.currency}`,
        })
        continue
      }
      if (!held || held.quantity.lessThan(quantity)) {
        issues.push({ txId: tx.id, message: `แลก ${quantity} หน่วย แต่ถืออยู่ ${held?.quantity ?? 0} หน่วย` })
        continue
      }
      const cost = takeCost(held, quantity)
      realized.push(realizedEvent(tx, quantity, D(tx.amount), cost))
      removeUnits(key, held, quantity, cost)
      const received = positions.get(toKey) ?? {
        key: toKey,
        accountId: tx.accountId,
        instrumentId: toInstrumentId,
        currency: tx.currency,
        quantity: D(0),
        costQuote: D(0),
        costBase: D(0),
      }
      const receivedCost = receivedCostQuote(tx)
      received.quantity = received.quantity.plus(D(tx.toQuantity))
      received.costQuote = received.costQuote.plus(receivedCost)
      received.costBase = received.costBase.plus(receivedCost.times(rate))
      positions.set(toKey, received)
    }

    if (tx.type === 'split') {
      if (!held) {
        issues.push({ txId: tx.id, message: 'ไม่มีสินทรัพย์นี้ในพอร์ต ณ วันที่แตกพาร์' })
        continue
      }
      held.quantity = held.quantity.times(D(tx.splitRatio))
    }

    if (tx.type === 'dividend' || tx.type === 'interest' || tx.type === 'receive_asset') {
      const grossQuote = tx.type === 'receive_asset' ? receivedValueQuote(tx) : D(tx.amount)
      const netQuote = grossQuote.minus(D(tx.fees)).minus(D(tx.tax))
      income.push({
        txId: tx.id,
        date: tx.date,
        accountId: tx.accountId,
        instrumentId,
        kind: tx.type,
        currency: tx.currency,
        grossQuote,
        taxQuote: D(tx.tax),
        netQuote,
        grossBase: grossQuote.times(rate),
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

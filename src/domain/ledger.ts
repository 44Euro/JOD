import { D, Decimal } from './decimal'
import { symbolOf, type Transaction } from './types'
import { FEE_ASSET_SAME_ERROR } from './validation'
import { t } from '../i18n'

export interface Position {
  key: string
  accountId: string
  instrumentId: string
  currency: string
  quantity: Decimal
  costQuote: Decimal
  costBase: Decimal
  // The part of costBase that came from units received as income, which is value earned, not money paid.
  receivedCostBase: Decimal
}

// One change of the units held in one position by one transaction. `transfer` is true for both sides of a
// transfer between accounts, which moves units without opening or closing anything.
export interface PositionMove {
  txId: string
  date: string
  accountId: string
  instrumentId: string
  before: Decimal
  after: Decimal
  transfer: boolean
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
  // What the cash cost in the base currency, as an average. A negative balance has no cost.
  costBase: Decimal
}

export interface LedgerIssue {
  txId: string
  message: string
  // The message with {0}, {1} where a quantity stands, and those quantities, so a screen can mask them while the numbers are hidden.
  pattern?: string
  figures?: Decimal[]
}

type IssueDetail = Omit<LedgerIssue, 'txId'>

function shortfall(verb: string, needed: Decimal, held: Decimal | undefined, unit = t('หน่วย')): IssueDetail {
  const have = held ?? D(0)
  return {
    message: t('{0} {1} {2} แต่ถืออยู่ {3} {4}', verb, needed, unit, have, unit),
    // The same sentence with {0} and {1} left where the figures go, so a screen can mask them.
    pattern: t('{0} {1} {2} แต่ถืออยู่ {3} {4}', verb, '{0}', unit, '{1}', unit),
    figures: [needed, have],
  }
}

export interface Ledger {
  positions: Position[]
  realized: RealizedEvent[]
  income: IncomeEvent[]
  cash: CashBalance[]
  feesBase: Decimal
  issues: LedgerIssue[]
  moves: PositionMove[]
}

function emptyPosition(key: string, accountId: string, instrumentId: string, currency: string): Position {
  return { key, accountId, instrumentId, currency, quantity: D(0), costQuote: D(0), costBase: D(0), receivedCostBase: D(0) }
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
export function takeCost(
  position: Position,
  quantity: Decimal,
): { costQuote: Decimal; costBase: Decimal; receivedCostBase: Decimal; closesAll: boolean } {
  const closesAll = quantity.equals(position.quantity)
  return {
    costQuote: closesAll ? position.costQuote : position.costQuote.div(position.quantity).times(quantity),
    costBase: closesAll ? position.costBase : position.costBase.div(position.quantity).times(quantity),
    receivedCostBase: closesAll ? position.receivedCostBase : position.receivedCostBase.div(position.quantity).times(quantity),
    closesAll,
  }
}

// Units a fee took out of the asset received never arrive.
function feeUnitsTaken(tx: Transaction): Decimal {
  return tx.feePaidIn === 'received' ? D(tx.feeQuantity) : D(0)
}

// What an asset received as income is worth on the day: both its cost and the income it counts as.
function receivedValueQuote(tx: Transaction): Decimal {
  return D(tx.quantity).times(D(tx.price))
}

// The coin received in a swap costs the value it was swapped at plus the fees and tax paid on top.
// For an exercise, the cash paid plus fees; the cost carried over from what was given up is added by the ledger.
function receivedCostQuote(tx: Transaction): Decimal {
  return (tx.exercise ? D(tx.paid) : D(tx.amount)).plus(D(tx.fees)).plus(D(tx.tax))
}

export function receivedUnitCost(tx: Transaction): Decimal | null {
  const quantity = D(tx.toQuantity).minus(feeUnitsTaken(tx))
  return quantity.greaterThan(0) ? receivedCostQuote(tx).div(quantity) : null
}

// An account that only ever records trades has no cash history, so the cash computed for it only reflects
// the trades and is not a real balance. Cash moved in from another account is real money arriving, so it starts
// the account's cash history just as a deposit does.
export function accountTracksCash(transactions: readonly Transaction[], accountId: string): boolean {
  return transactions.some(
    (t) =>
      (t.accountId === accountId &&
        (t.type === 'deposit' || t.type === 'withdraw' || t.type === 'fx_convert' || (t.type === 'opening' && !t.instrumentId))) ||
      (t.type === 'transfer' && !t.instrumentId && t.toAccountId === accountId),
  )
}

export function feeFromCash(tx: Transaction): boolean {
  return (tx.feePaidIn ?? 'cash') === 'cash'
}

// What a sell brings in for the gain: the fee lowers it however it was paid, but only a fee paid in cash lowers the cash.
export function saleProceedsQuote(tx: Transaction): Decimal {
  return D(tx.quantity).times(D(tx.price)).minus(D(tx.fees)).minus(D(tx.tax))
}

// Signed cash movement in the transaction's own currency (the source side for fx_convert, whose fee is
// taken out of the amount exchanged, so it is already inside `amount`).
export function cashDeltaQuote(tx: Transaction): Decimal {
  const fees = D(tx.fees)
  const cashFees = feeFromCash(tx) ? fees : D(0)
  const tax = D(tx.tax)
  switch (tx.type) {
    case 'buy':
      return D(tx.quantity).times(D(tx.price)).plus(tax).plus(cashFees).negated()
    case 'sell':
      return D(tx.quantity).times(D(tx.price)).minus(cashFees).minus(tax)
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
      return tx.instrumentId ? cashFees.negated() : D(tx.amount).plus(cashFees).negated()
    // Only the fees and tax are paid in cash; the coin given up pays for the coin received, and an asset
    // received as income costs nothing in cash.
    case 'swap':
      return cashFees.plus(tax).plus(tx.exercise ? D(tx.paid) : 0).negated()
    case 'receive_asset':
      return fees.plus(tax).negated()
    // An opening holding was paid for before the app existed, so only opening cash moves cash.
    case 'opening':
      return tx.instrumentId ? D(0) : D(tx.amount)
    case 'split':
      return D(0)
  }
}

export function transferInQuote(tx: Transaction): Decimal {
  return tx.type === 'transfer' && !tx.instrumentId ? D(tx.amount) : D(0)
}

// What the units a fee took out of the asset received were worth, at the price paid for them. A transfer has no
// price, so it counts none.
function feeUnitsValueQuote(tx: Transaction): Decimal {
  const units = feeUnitsTaken(tx)
  if (tx.type === 'buy') return units.times(D(tx.price))
  const toQuantity = D(tx.toQuantity)
  return tx.type === 'swap' && toQuantity.greaterThan(0) ? units.times(D(tx.amount)).div(toQuantity) : D(0)
}

// Tax on dividends and interest is withholding tax, so it is reported under income instead.
export function feesQuote(tx: Transaction): Decimal {
  const fees = D(tx.fees)
  if (tx.type === 'buy' || tx.type === 'sell' || tx.type === 'swap') return fees.plus(D(tx.tax)).plus(feeUnitsValueQuote(tx))
  if (tx.type === 'fee') return fees.plus(D(tx.amount)).plus(D(tx.tax))
  return fees
}

type TakenCost = ReturnType<typeof takeCost>

function realizedEvent(
  tx: Transaction,
  instrumentId: string,
  quantity: Decimal,
  proceedsQuote: Decimal,
  cost: TakenCost,
): RealizedEvent {
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
    instrumentId,
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
  const moves: PositionMove[] = []
  let feesBase = D(0)

  const cashRow = (accountId: string, currency: string): CashBalance => {
    const key = `${accountId}|${currency}`
    const row = cash.get(key) ?? { accountId, currency, amount: D(0), costBase: D(0) }
    cash.set(key, row)
    return row
  }

  // Money that only fills a shortfall in the balance carries no cost, so only the part that ends above zero is costed.
  const receiveCash = (accountId: string, currency: string, delta: Decimal, costBase: Decimal) => {
    const row = cashRow(accountId, currency)
    const before = row.amount
    row.amount = before.plus(delta)
    if (delta.isZero()) return
    const costed = Decimal.max(row.amount, 0).minus(Decimal.max(before, 0))
    row.costBase = row.costBase.plus(costed.equals(delta) ? costBase : costBase.times(costed).div(delta))
  }

  // The cost leaves in proportion to the balance, all of it when the whole balance goes; money paid out of a balance
  // that is not above zero carries no cost.
  const payCash = (accountId: string, currency: string, out: Decimal): Decimal => {
    const row = cashRow(accountId, currency)
    let taken = D(0)
    if (row.amount.greaterThan(0)) taken = out.greaterThanOrEqualTo(row.amount) ? row.costBase : row.costBase.times(out).div(row.amount)
    row.amount = row.amount.minus(out)
    row.costBase = row.costBase.minus(taken)
    return taken
  }

  const recordMove = (tx: Transaction, position: Position, before: Decimal, after: Decimal, transfer = false) => {
    moves.push({
      txId: tx.id,
      date: tx.date,
      accountId: position.accountId,
      instrumentId: position.instrumentId,
      before,
      after,
      transfer,
    })
  }

  const removeUnits = (tx: Transaction, key: string, position: Position, quantity: Decimal, cost: TakenCost, transfer = false) => {
    const before = position.quantity
    if (cost.closesAll) {
      positions.delete(key)
    } else {
      position.quantity = position.quantity.minus(quantity)
      position.costQuote = position.costQuote.minus(cost.costQuote)
      position.costBase = position.costBase.minus(cost.costBase)
      position.receivedCostBase = position.receivedCostBase.minus(cost.receivedCostBase)
    }
    recordMove(tx, position, before, before.minus(quantity), transfer)
  }

  // The asset a fee is paid in is checked together with the rest of the transaction, before anything is changed,
  // and only sold once the transaction itself has been recorded.
  const feeAssetProblem = (tx: Transaction): IssueDetail | null => {
    if (tx.feePaidIn !== 'asset') return null
    if (tx.feeInstrumentId && (tx.feeInstrumentId === tx.instrumentId || tx.feeInstrumentId === tx.toInstrumentId)) {
      return { message: FEE_ASSET_SAME_ERROR }
    }
    const feeHeld = positions.get(positionKey(tx.accountId, tx.feeInstrumentId ?? ''))
    const symbol = symbolOf(tx.feeInstrumentId)
    if (feeHeld && feeHeld.currency !== tx.currency) {
      return { message: t('{0} ถืออยู่เป็น {1} · รายการนี้ใช้ {2}', symbol, feeHeld.currency, tx.currency) }
    }
    const feeQuantity = D(tx.feeQuantity)
    if (!feeHeld || feeHeld.quantity.lessThan(feeQuantity)) {
      return shortfall(t('ค่าธรรมเนียม'), feeQuantity, feeHeld?.quantity, symbol)
    }
    return null
  }

  // Paying with an asset sells it at what the fee is worth, so it realizes a gain or loss of its own.
  const payFeeInAsset = (tx: Transaction) => {
    const feeKey = positionKey(tx.accountId, tx.feeInstrumentId ?? '')
    const feeHeld = positions.get(feeKey)
    if (tx.feePaidIn !== 'asset' || !feeHeld) return
    const feeQuantity = D(tx.feeQuantity)
    const cost = takeCost(feeHeld, feeQuantity)
    realized.push(realizedEvent(tx, feeHeld.instrumentId, feeQuantity, D(tx.fees), cost))
    removeUnits(tx, feeKey, feeHeld, feeQuantity, cost)
  }

  for (const tx of sortTransactions(transactions)) {
    const rate = D(tx.fxRate)
    const instrumentId = tx.instrumentId ?? ''
    const key = positionKey(tx.accountId, instrumentId)
    const held = positions.get(key)
    const acquires = tx.type === 'buy' || tx.type === 'receive_asset' || (tx.type === 'opening' && Boolean(tx.instrumentId))

    if ((acquires || tx.type === 'sell') && held && held.currency !== tx.currency) {
      issues.push({ txId: tx.id, message: t('สกุลเงิน {0} ไม่ตรงกับที่ถืออยู่ ({1})', tx.currency, held.currency) })
      continue
    }

    if (acquires) {
      const feeProblem = feeAssetProblem(tx)
      if (feeProblem) {
        issues.push({ txId: tx.id, ...feeProblem })
        continue
      }
      const position = held ?? emptyPosition(key, tx.accountId, instrumentId, tx.currency)
      const cost = tx.type === 'receive_asset' ? receivedValueQuote(tx) : acquisitionCostQuote(tx)
      const before = position.quantity
      position.quantity = before.plus(D(tx.quantity)).minus(feeUnitsTaken(tx))
      recordMove(tx, position, before, position.quantity)
      position.costQuote = position.costQuote.plus(cost)
      position.costBase = position.costBase.plus(cost.times(rate))
      if (tx.type === 'receive_asset') position.receivedCostBase = position.receivedCostBase.plus(cost.times(rate))
      positions.set(key, position)
      payFeeInAsset(tx)
    }

    if (tx.type === 'sell') {
      const quantity = D(tx.quantity)
      if (!held || held.quantity.lessThan(quantity)) {
        issues.push({ txId: tx.id, ...shortfall(t('ขาย'), quantity, held?.quantity) })
        continue
      }
      const feeProblem = feeAssetProblem(tx)
      if (feeProblem) {
        issues.push({ txId: tx.id, ...feeProblem })
        continue
      }
      const cost = takeCost(held, quantity)
      realized.push(realizedEvent(tx, instrumentId, quantity, saleProceedsQuote(tx), cost))
      removeUnits(tx, key, held, quantity, cost)
      payFeeInAsset(tx)
    }

    if (tx.type === 'transfer' && tx.instrumentId) {
      const toAccountId = tx.toAccountId ?? ''
      const quantity = D(tx.quantity)
      if (!held || held.quantity.lessThan(quantity)) {
        issues.push({ txId: tx.id, ...shortfall(t('โอน'), quantity, held?.quantity) })
        continue
      }
      const toKey = positionKey(toAccountId, instrumentId)
      const target = positions.get(toKey)
      const toCurrency = tx.toCurrency ?? held.currency
      if (target && target.currency !== toCurrency) {
        issues.push({
          txId: tx.id,
          message: t('สกุลเงิน {0} ไม่ตรงกับที่ถืออยู่ในบัญชีปลายทาง ({1})', toCurrency, target.currency),
        })
        continue
      }
      const cost = takeCost(held, quantity)
      removeUnits(tx, key, held, quantity, cost, true)
      // Read after the sending side was updated, so a transfer to the same account cannot count twice.
      const received = positions.get(toKey) ?? emptyPosition(toKey, toAccountId, instrumentId, toCurrency)
      const before = received.quantity
      received.quantity = before.plus(quantity).minus(feeUnitsTaken(tx))
      recordMove(tx, received, before, received.quantity, true)
      // Moving into another currency keeps the baht cost whole and re-counts it at the day's rate, so no gain
      // appears on the move; only the price paid, as seen in the new currency, changes.
      const movedQuote = toCurrency === held.currency ? cost.costQuote : cost.costBase.div(D(tx.toFxRate))
      received.costQuote = received.costQuote.plus(movedQuote)
      received.costBase = received.costBase.plus(cost.costBase)
      received.receivedCostBase = received.receivedCostBase.plus(cost.receivedCostBase)
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
          message: t('{0} ถืออยู่เป็น {1} · รายการนี้ใช้ {2}', symbolOf(wrongCurrency.instrumentId), wrongCurrency.currency, tx.currency),
        })
        continue
      }
      if (!held || held.quantity.lessThan(quantity)) {
        issues.push({ txId: tx.id, ...shortfall(t('แลก'), quantity, held?.quantity) })
        continue
      }
      const feeProblem = feeAssetProblem(tx)
      if (feeProblem) {
        issues.push({ txId: tx.id, ...feeProblem })
        continue
      }
      const cost = takeCost(held, quantity)
      if (!tx.exercise) realized.push(realizedEvent(tx, instrumentId, quantity, D(tx.amount), cost))
      removeUnits(tx, key, held, quantity, cost)
      const received = positions.get(toKey) ?? emptyPosition(toKey, tx.accountId, toInstrumentId, tx.currency)
      const receivedCost = receivedCostQuote(tx)
      const before = received.quantity
      received.quantity = before.plus(D(tx.toQuantity)).minus(feeUnitsTaken(tx))
      recordMove(tx, received, before, received.quantity)
      // Exercising carries the cost of what was given up, at the rates it was bought at, into what is received.
      received.costQuote = received.costQuote.plus(receivedCost).plus(tx.exercise ? cost.costQuote : 0)
      received.costBase = received.costBase.plus(receivedCost.times(rate)).plus(tx.exercise ? cost.costBase : 0)
      positions.set(toKey, received)
      payFeeInAsset(tx)
    }

    if (tx.type === 'split') {
      if (!held) {
        issues.push({ txId: tx.id, message: t('ไม่มีสินทรัพย์นี้ในพอร์ต ณ วันที่แตกพาร์') })
        continue
      }
      const before = held.quantity
      held.quantity = before.times(D(tx.splitRatio))
      recordMove(tx, held, before, held.quantity)
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

    const cashDelta = cashDeltaQuote(tx)
    const cashIn = transferInQuote(tx)
    if (cashIn.isZero()) {
      if (cashDelta.lessThan(0)) payCash(tx.accountId, tx.currency, cashDelta.negated())
      else receiveCash(tx.accountId, tx.currency, cashDelta, cashDelta.times(rate))
    } else {
      // The cost of the cash sent goes with it; the cost of a fee paid on top goes with the fee. What the sender does not
      // hold arrives as money from outside, costed at the rate of the transfer.
      const held = Decimal.max(cashRow(tx.accountId, tx.currency).amount, 0)
      const uncovered = Decimal.max(cashIn.minus(held), 0)
      const moved = payCash(tx.accountId, tx.currency, cashIn).plus(uncovered.times(rate))
      payCash(tx.accountId, tx.currency, cashDelta.negated().minus(cashIn))
      receiveCash(tx.toAccountId ?? '', tx.currency, cashIn, moved)
    }
    if (tx.type === 'fx_convert' && tx.toCurrency) receiveCash(tx.accountId, tx.toCurrency, D(tx.toAmount), D(tx.amount).times(rate))
    feesBase = feesBase.plus(feesQuote(tx).times(rate))
  }

  return {
    positions: [...positions.values()].sort((a, b) => a.key.localeCompare(b.key)),
    realized,
    income,
    cash: [...cash.values()].filter((row) => !row.amount.isZero()),
    feesBase,
    issues,
    moves,
  }
}

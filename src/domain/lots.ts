import { D, Decimal } from './decimal'
import { sortTransactions } from './ledger'
import type { Transaction } from './types'

// One purchase still held. Costs are what is left of the purchase after earlier sales took their share.
export interface Lot {
  txId: string
  date: string
  accountId: string
  quantity: Decimal
  costQuote: Decimal
  costBase: Decimal
}

export interface FifoSale {
  txId: string
  date: string
  quantity: Decimal
  proceedsBase: Decimal
  costBase: Decimal
  realizedBase: Decimal
}

export interface FifoResult {
  lots: Lot[]
  sales: FifoSale[]
  realizedBase: Decimal
}

// Takes quantity from the oldest lots first and returns the part of each it took, cost scaled to the units.
function take(lots: Lot[], quantity: Decimal): Lot[] {
  const taken: Lot[] = []
  let left = quantity
  while (left.gt(0) && lots.length > 0) {
    const lot = lots[0]
    const used = Decimal.min(lot.quantity, left)
    const share = used.div(lot.quantity)
    const part = { ...lot, quantity: used, costQuote: lot.costQuote.times(share), costBase: lot.costBase.times(share) }
    taken.push(part)
    lot.quantity = lot.quantity.minus(used)
    lot.costQuote = lot.costQuote.minus(part.costQuote)
    lot.costBase = lot.costBase.minus(part.costBase)
    if (lot.quantity.lte(0)) lots.shift()
    left = left.minus(used)
  }
  return taken
}

const sum = (lots: readonly Lot[], pick: (l: Lot) => Decimal) => lots.reduce((s, l) => s.plus(pick(l)), D(0))

// First in, first out, per account: an alternative view to the average cost the app (and Thai brokers) account with.
// A transfer carries its lots to the other account with their own dates, so the order of purchase survives it.
export function fifoByAccount(transactions: readonly Transaction[], instrumentId: string): Map<string, FifoResult> {
  const results = new Map<string, FifoResult>()
  const result = (accountId: string) => {
    let r = results.get(accountId)
    if (!r) results.set(accountId, (r = { lots: [], sales: [], realizedBase: D(0) }))
    return r
  }
  const acquire = (tx: Transaction, accountId: string, quantity: Decimal, costQuote: Decimal) => {
    if (quantity.lte(0)) return
    result(accountId).lots.push({ txId: tx.id, date: tx.date, accountId, quantity, costQuote, costBase: costQuote.times(tx.fxRate) })
  }
  const dispose = (tx: Transaction, quantity: Decimal, proceedsBase: Decimal) => {
    const r = result(tx.accountId)
    const costBase = sum(take(r.lots, quantity), (l) => l.costBase)
    const realizedBase = proceedsBase.minus(costBase)
    r.sales.push({ txId: tx.id, date: tx.date, quantity, proceedsBase, costBase, realizedBase })
    r.realizedBase = r.realizedBase.plus(realizedBase)
  }

  for (const tx of sortTransactions(transactions)) {
    const qty = D(tx.quantity)
    const extras = D(tx.fees).plus(tx.tax)
    if (tx.instrumentId === instrumentId) {
      switch (tx.type) {
        case 'buy':
        case 'opening': {
          const received = tx.feePaidIn === 'received' ? qty.minus(D(tx.feeQuantity)) : qty
          acquire(tx, tx.accountId, received, qty.times(D(tx.price)).plus(extras))
          break
        }
        case 'receive_asset':
          acquire(tx, tx.accountId, qty, qty.times(D(tx.price)))
          break
        case 'sell':
          dispose(tx, qty, qty.times(D(tx.price)).minus(extras).times(tx.fxRate))
          break
        case 'swap':
          // An exercise passes these units' cost on instead of selling them.
          if (tx.exercise) take(result(tx.accountId).lots, qty)
          else dispose(tx, qty, D(tx.amount).times(tx.fxRate))
          break
        case 'split':
          for (const lot of result(tx.accountId).lots) lot.quantity = lot.quantity.times(D(tx.splitRatio))
          break
        case 'transfer':
          if (tx.toAccountId && qty.gt(0)) {
            for (const part of take(result(tx.accountId).lots, qty)) result(tx.toAccountId).lots.push({ ...part, accountId: tx.toAccountId })
            result(tx.toAccountId).lots.sort((a, b) => a.date.localeCompare(b.date))
          }
          break
      }
    }
    if (tx.type === 'swap' && tx.toInstrumentId === instrumentId) {
      const received = tx.feePaidIn === 'received' ? D(tx.toQuantity).minus(D(tx.feeQuantity)) : D(tx.toQuantity)
      if (tx.exercise) {
        const carried = exerciseCarry(transactions, tx)
        const cash = D(tx.paid).plus(extras)
        if (received.gt(0)) {
          result(tx.accountId).lots.push({
            txId: tx.id,
            date: tx.date,
            accountId: tx.accountId,
            quantity: received,
            costQuote: cash.plus(carried.quote),
            costBase: cash.times(tx.fxRate).plus(carried.base),
          })
        }
      } else acquire(tx, tx.accountId, received, D(tx.amount).plus(extras))
    }
    if (tx.feePaidIn === 'asset' && tx.feeInstrumentId === instrumentId && tx.feeQuantity) {
      dispose(tx, D(tx.feeQuantity), D(tx.fees).times(tx.fxRate))
    }
  }
  return results
}

// The FIFO cost of the units an exercise gives up: what the given-up asset's own lots held just before it.
function exerciseCarry(transactions: readonly Transaction[], exercise: Transaction): { quote: Decimal; base: Decimal } {
  const before = sortTransactions(transactions)
  const upTo = before.slice(0, before.findIndex((t) => t.id === exercise.id))
  const lots = [...(fifoByAccount(upTo, exercise.instrumentId ?? '').get(exercise.accountId)?.lots ?? [])].map((l) => ({ ...l }))
  const taken = take(lots, D(exercise.quantity))
  return { quote: sum(taken, (l) => l.costQuote), base: sum(taken, (l) => l.costBase) }
}

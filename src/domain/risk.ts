import { D, Decimal } from './decimal'
import type { Trade } from './trades'
import type { Transaction } from './types'

// The money at risk when the trade was opened: for each buy, the distance from its price down to its stop loss, times
// the units, at that buy's rate. A trade with any buy lacking a stop below its price has no defined risk.
export function initialRiskBase(trade: Trade, byId: ReadonlyMap<string, Transaction>): Decimal | null {
  let risk = D(0)
  let buys = 0
  for (const id of trade.txIds) {
    const tx = byId.get(id)
    if (!tx || tx.type !== 'buy') continue
    buys += 1
    const stop = tx.journal?.stopLoss
    if (!stop || !tx.price || !tx.quantity || D(stop).gte(tx.price)) return null
    risk = risk.plus(D(tx.price).minus(stop).times(tx.quantity).times(tx.fxRate))
  }
  return buys > 0 && risk.gt(0) ? risk : null
}

export function rMultiple(trade: Trade, byId: ReadonlyMap<string, Transaction>): Decimal | null {
  const risk = initialRiskBase(trade, byId)
  return risk ? trade.realizedBase.div(risk) : null
}

export function averageR(trades: readonly Trade[], byId: ReadonlyMap<string, Transaction>): { avg: Decimal; count: number } | null {
  const rs = trades.flatMap((t) => {
    const r = t.closeDate ? rMultiple(t, byId) : null
    return r ? [r] : []
  })
  if (rs.length === 0) return null
  return { avg: rs.reduce((s, r) => s.plus(r), D(0)).div(rs.length), count: rs.length }
}

// The largest fall of the running total of closed trades, in money, taken in the order the trades closed.
export function closedTradeDrawdown(trades: readonly Trade[]): Decimal {
  const closed = trades.filter((t) => t.closeDate).sort((a, b) => a.closeDate!.localeCompare(b.closeDate!))
  let total = D(0)
  let peak = D(0)
  let worst = D(0)
  for (const t of closed) {
    total = total.plus(t.realizedBase)
    peak = Decimal.max(peak, total)
    worst = Decimal.min(worst, total.minus(peak))
  }
  return worst
}

export interface PositionSize {
  units: Decimal
  value: Decimal
  riskAmount: Decimal
}

// How many units to buy so that being stopped out loses riskPct of the account. Units are rounded down to the lot
// size (1 share, 100 for the SET board lot, or a fraction of a coin).
export function positionSize(input: { account: string; riskPct: string; entry: string; stop: string; lot: string }): PositionSize | null {
  const values = [input.account, input.riskPct, input.entry, input.stop, input.lot]
  if (values.some((v) => !/^\d+(\.\d+)?$/.test(v.trim()))) return null
  const [account, riskPct, entry, stop, lot] = values.map((v) => D(v))
  const perUnit = entry.minus(stop)
  if (perUnit.lte(0) || lot.lte(0) || account.lte(0)) return null
  const riskAmount = account.times(riskPct).div(100)
  const units = riskAmount.div(perUnit).div(lot).floor().times(lot)
  return { units, value: units.times(entry), riskAmount }
}

import { daysBetween } from './dates'
import { sumBy, type Decimal } from './decimal'
import { positionKey, type Ledger, type PositionMove, type RealizedEvent } from './ledger'
import type { Emotion, Mistake, Transaction } from './types'

export interface Trade {
  id: string
  instrumentId: string
  accountIds: string[]
  openDate: string
  closeDate: string | null
  realizedBase: Decimal
  holdingDays: number | null
  txIds: string[]
  closingTxId: string | null
  strategy?: string
  emotion?: Emotion
  hasStopLoss: boolean
  mistakes: Mistake[]
  reviewed: boolean
}

interface Draft {
  id: string
  instrumentId: string
  order: number
  openDate: string
  closeDate: string | null
  closingTxId: string | null
  holding: Set<string>
  mergedInto: Draft | null
}

function rootOf(draft: Draft): Draft {
  return draft.mergedInto ? rootOf(draft.mergedInto) : draft
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

// A trade runs from the first unit held to the last, and a transfer between accounts only carries it along: the
// units it moves stay in the trade they came from, and a transfer into an account that already holds the asset
// from a trade of its own joins the two.
export function matchTrades(transactions: readonly Transaction[], ledger: Ledger): Trade[] {
  const byId = new Map(transactions.map((tx) => [tx.id, tx]))
  const drafts: Draft[] = []
  const tradeOf = new Map<string, Draft>()
  const assigned: { draft: Draft; move: PositionMove }[] = []
  // The sending side of a transfer comes just before the receiving side, which needs the trade the units left.
  let sending: { txId: string; draft: Draft | undefined } | null = null

  const open = (move: PositionMove): Draft => {
    const draft: Draft = {
      id: move.txId,
      instrumentId: move.instrumentId,
      order: drafts.length,
      openDate: move.date,
      closeDate: null,
      closingTxId: null,
      holding: new Set(),
      mergedInto: null,
    }
    drafts.push(draft)
    return draft
  }

  const join = (a: Draft, b: Draft): Draft => {
    const [keep, drop] = a.order < b.order ? [a, b] : [b, a]
    for (const key of drop.holding) {
      keep.holding.add(key)
      tradeOf.set(key, keep)
    }
    drop.holding.clear()
    drop.mergedInto = keep
    return keep
  }

  for (const move of ledger.moves) {
    const key = positionKey(move.accountId, move.instrumentId)
    const owner = tradeOf.get(key)
    const receives = move.transfer && move.after.greaterThan(move.before)
    const from = receives && sending?.txId === move.txId && sending.draft ? rootOf(sending.draft) : undefined
    if (move.transfer && move.after.lessThan(move.before)) sending = { txId: move.txId, draft: owner }

    let draft = owner
    if (move.before.isZero()) {
      if (!move.after.greaterThan(0)) continue
      draft = from ?? open(move)
      draft.holding.add(key)
      tradeOf.set(key, draft)
    } else if (draft && move.after.isZero()) {
      draft.holding.delete(key)
      tradeOf.delete(key)
      if (!move.transfer && draft.holding.size === 0) {
        draft.closeDate = move.date
        draft.closingTxId = move.txId
      }
    } else if (draft && from && from !== draft) {
      draft = join(from, draft)
    }
    if (draft) assigned.push({ draft, move })
  }

  const moves = new Map<Draft, PositionMove[]>()
  const owners = new Map<string, Draft>()
  for (const { draft, move } of assigned) {
    const root = rootOf(draft)
    append(moves, root, move)
    owners.set(`${move.txId}|${positionKey(move.accountId, move.instrumentId)}`, root)
  }
  const realized = new Map<Draft, RealizedEvent[]>()
  for (const event of ledger.realized) {
    const root = owners.get(`${event.txId}|${positionKey(event.accountId, event.instrumentId)}`)
    if (root) append(realized, root, event)
  }

  return drafts
    .filter((draft) => !draft.mergedInto)
    .sort((a, b) => a.openDate.localeCompare(b.openDate) || a.order - b.order)
    .map((draft): Trade => {
      const own = moves.get(draft) ?? []
      const txIds = [...new Set(own.map((move) => move.txId))]
      const txs = txIds.flatMap((id) => byId.get(id) ?? [])
      const buys = txs.filter((tx) => tx.type === 'buy')
      const closing = draft.closingTxId ? byId.get(draft.closingTxId)?.journal : undefined
      return {
        id: draft.id,
        instrumentId: draft.instrumentId,
        accountIds: [...new Set(own.map((move) => move.accountId))],
        openDate: draft.openDate,
        closeDate: draft.closeDate,
        realizedBase: sumBy(realized.get(draft) ?? [], (event) => event.realizedBase),
        holdingDays: draft.closeDate ? daysBetween(draft.openDate, draft.closeDate) : null,
        txIds,
        closingTxId: draft.closingTxId,
        strategy: buys.find((tx) => tx.journal?.strategy)?.journal?.strategy,
        emotion: buys.find((tx) => tx.journal?.emotion)?.journal?.emotion,
        hasStopLoss: buys.some((tx) => tx.journal?.stopLoss),
        mistakes: [...new Set(txs.flatMap((tx) => tx.journal?.mistakes ?? []))],
        reviewed: Boolean(closing?.review?.trim()) || closing?.score !== undefined,
      }
    })
}

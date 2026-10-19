import { monthKey } from './dates'
import { D, sumBy, type Decimal } from './decimal'
import type { Trade } from './trades'
import { MISTAKES, type Mistake } from './types'

export type TradePeriod = 'month' | 'year' | 'all'

export interface TradeStats {
  closed: number
  wins: number
  losses: number
  winRatePct: Decimal | null
  avgWinBase: Decimal | null
  avgLossBase: Decimal | null
  profitFactor: Decimal | null
  expectancyBase: Decimal | null
  totalBase: Decimal
  avgHoldDays: number | null
  avgHoldWinDays: number | null
  avgHoldLossDays: number | null
  maxLossStreak: number
  best: Trade | null
  worst: Trade | null
}

export interface TradeGroup {
  key: string
  count: number
  wins: number
  winRatePct: Decimal
  totalBase: Decimal
  noStopCount: number
}

export interface Observation {
  by: 'strategy' | 'emotion'
  group: TradeGroup
}

// A group needs this many trades before its result says anything about the habit behind it.
const MIN_OBSERVED_TRADES = 5

const isWin = (trade: Trade) => trade.realizedBase.greaterThan(0)

export function closedInPeriod(trades: readonly Trade[], period: TradePeriod, today: string): Trade[] {
  const closed = trades.filter((trade) => trade.closeDate !== null)
  if (period === 'all') return closed
  const prefix = today.slice(0, period === 'month' ? 7 : 4)
  return closed.filter((trade) => trade.closeDate?.startsWith(prefix))
}

function averageDays(trades: readonly Trade[]): number | null {
  const days = trades.flatMap((trade) => trade.holdingDays ?? [])
  if (days.length === 0) return null
  return Math.round(days.reduce((total, d) => total + d, 0) / days.length)
}

export function tradeStats(closed: readonly Trade[]): TradeStats {
  // Array sort is stable, so trades closed on the same day keep the order they came in.
  const byClose = [...closed].sort((a, b) => (a.closeDate ?? '').localeCompare(b.closeDate ?? ''))
  const winners = byClose.filter(isWin)
  const losers = byClose.filter((trade) => !isWin(trade))
  const totalBase = sumBy(byClose, (trade) => trade.realizedBase)
  const grossWin = sumBy(winners, (trade) => trade.realizedBase)
  const grossLoss = sumBy(losers, (trade) => trade.realizedBase.negated())

  let maxLossStreak = 0
  let streak = 0
  for (const trade of byClose) {
    streak = isWin(trade) ? 0 : streak + 1
    maxLossStreak = Math.max(maxLossStreak, streak)
  }

  let best: Trade | null = null
  let worst: Trade | null = null
  for (const trade of byClose) {
    if (!best || trade.realizedBase.greaterThan(best.realizedBase)) best = trade
    if (!worst || trade.realizedBase.lessThan(worst.realizedBase)) worst = trade
  }

  return {
    closed: byClose.length,
    wins: winners.length,
    losses: losers.length,
    winRatePct: byClose.length > 0 ? D(winners.length).div(byClose.length).times(100) : null,
    avgWinBase: winners.length > 0 ? grossWin.div(winners.length) : null,
    avgLossBase: losers.length > 0 ? grossLoss.div(losers.length) : null,
    profitFactor: grossLoss.greaterThan(0) ? grossWin.div(grossLoss) : null,
    expectancyBase: byClose.length > 0 ? totalBase.div(byClose.length) : null,
    totalBase,
    avgHoldDays: averageDays(byClose),
    avgHoldWinDays: averageDays(winners),
    avgHoldLossDays: averageDays(losers),
    maxLossStreak,
    best,
    worst,
  }
}

const groupKey = (trade: Trade, by: 'strategy' | 'emotion' | 'month') =>
  by === 'month' ? monthKey(trade.closeDate ?? '') : (trade[by] ?? '')

export function groupTrades(closed: readonly Trade[], by: 'strategy' | 'emotion' | 'month'): TradeGroup[] {
  const buckets = new Map<string, Trade[]>()
  for (const trade of closed) {
    const key = groupKey(trade, by)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(trade)
    else buckets.set(key, [trade])
  }
  const groups = [...buckets].map(([key, trades]): TradeGroup => {
    const wins = trades.filter(isWin).length
    return {
      key,
      count: trades.length,
      wins,
      winRatePct: D(wins).div(trades.length).times(100),
      totalBase: sumBy(trades, (trade) => trade.realizedBase),
      noStopCount: trades.filter((trade) => !trade.hasStopLoss).length,
    }
  })
  return by === 'month'
    ? groups.sort((a, b) => b.key.localeCompare(a.key))
    : groups.sort((a, b) => b.totalBase.comparedTo(a.totalBase))
}

export function mistakeCounts(closed: readonly Trade[]): { mistake: Mistake; count: number }[] {
  return MISTAKES.map((mistake) => ({ mistake, count: closed.filter((trade) => trade.mistakes.includes(mistake)).length }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count)
}

export function observations(closed: readonly Trade[]): Observation[] {
  return (['strategy', 'emotion'] as const)
    .flatMap((by) =>
      groupTrades(closed, by)
        .filter((group) => group.key !== '' && group.count >= MIN_OBSERVED_TRADES && group.totalBase.lessThan(0))
        .map((group): Observation => ({ by, group })),
    )
    .sort((a, b) => a.group.totalBase.comparedTo(b.group.totalBase))
}

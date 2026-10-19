import { describe, expect, it } from 'vitest'
import { daysBetween } from './dates'
import { D } from './decimal'
import { closedInPeriod, groupTrades, mistakeCounts, observations, tradeStats } from './tradeStats'
import type { Trade } from './trades'

const trade = (realized: string, closeDate: string, extra: Partial<Trade> = {}): Trade => ({
  id: `t-${closeDate}`, instrumentId: 'US:AAPL', accountIds: ['acc-1'], openDate: '2024-01-01', closeDate,
  realizedBase: D(realized), holdingDays: daysBetween('2024-01-01', closeDate), txIds: [], closingTxId: null,
  hasStopLoss: false, mistakes: [], reviewed: false, ...extra,
})
const five = [
  trade('1000', '2024-01-05'), trade('-500', '2024-01-08'), trade('2000', '2024-01-11'),
  trade('-300', '2024-01-21'), trade('-200', '2024-01-31'),
]

describe('trade statistics', () => {
  it('adds up a set of closed trades (spec 5.7)', () => {
    const s = tradeStats(five)
    expect([s.closed, s.wins, s.losses, s.maxLossStreak]).toEqual([5, 2, 3, 2])
    expect([s.winRatePct, s.avgWinBase, s.profitFactor, s.expectancyBase, s.totalBase].map((d) => d?.toString())).toEqual(['40', '1500', '3', '400', '2000'])
    expect(s.avgLossBase?.toFixed(2)).toBe('333.33')
    expect([s.avgHoldDays, s.avgHoldWinDays, s.avgHoldLossDays]).toEqual([14, 7, 19])
    expect([s.best?.realizedBase.toString(), s.worst?.realizedBase.toString()]).toEqual(['2000', '-500'])
  })

  it('orders trades by close date for streaks and keeps the first of equal results', () => {
    const shuffled = [five[4], five[2], five[0], five[3], five[1]]
    expect(tradeStats(shuffled).maxLossStreak).toBe(2)
    const tie = [trade('50', '2024-02-02', { id: 'later' }), trade('50', '2024-02-01', { id: 'earlier' }), trade('-5', '2024-02-03', { id: 'a' }), trade('-5', '2024-02-03', { id: 'b' })]
    const s = tradeStats(tie)
    expect([s.best?.id, s.worst?.id]).toEqual(['earlier', 'a'])
  })

  it('shows no ratio it cannot compute', () => {
    const none = tradeStats([])
    expect([none.winRatePct, none.profitFactor, none.expectancyBase, none.avgHoldDays, none.best]).toEqual([null, null, null, null, null])
    expect(tradeStats([trade('100', '2024-01-05')]).profitFactor).toBeNull()
  })

  it('warns about a feeling that loses money over five trades or more', () => {
    const fomo = (r: string, d: string, stop = false) => trade(r, d, { emotion: 'fomo', hasStopLoss: stop })
    const list = [fomo('500', '2024-02-01'), fomo('-1000', '2024-02-02'), fomo('-800', '2024-02-03', true), fomo('-2000', '2024-02-04'), fomo('300', '2024-02-05')]
    const [o] = observations(list)
    expect([o.by, o.group.key, o.group.count, o.group.winRatePct.toString(), o.group.totalBase.toString(), o.group.noStopCount]).toEqual(['emotion', 'fomo', 5, '40', '-3000', 4])
  })

  it('groups trades without a journal as unspecified and never warns about them', () => {
    const losers = Array.from({ length: 6 }, (_, i) => trade('-100', `2024-03-0${i + 1}`))
    expect(groupTrades(losers, 'strategy')).toEqual([expect.objectContaining({ key: '', count: 6 })])
    expect(observations(losers)).toEqual([])
  })

  it('groups by the month a trade closed, newest first', () => {
    expect(groupTrades([trade('1', '2024-03-05'), trade('2', '2024-04-01'), trade('3', '2024-03-31')], 'month').map((g) => [g.key, g.count])).toEqual([
      ['2024-04', 1], ['2024-03', 2],
    ])
  })

  it('counts each mistake once per trade', () => {
    const list = [trade('1', '2024-01-05', { mistakes: ['chased', 'no_stop'] }), trade('-1', '2024-01-06', { mistakes: ['chased'] })]
    expect(mistakeCounts(list)).toEqual([{ mistake: 'chased', count: 2 }, { mistake: 'no_stop', count: 1 }])
  })

  it('filters closed trades by the period they closed in', () => {
    const list = [trade('1', '2024-10-02'), trade('1', '2024-03-01'), trade('1', '2023-12-31'), { ...trade('1', '2024-10-03'), closeDate: null }]
    expect(closedInPeriod(list, 'month', '2024-10-16')).toHaveLength(1)
    expect(closedInPeriod(list, 'year', '2024-10-16')).toHaveLength(2)
    expect(closedInPeriod(list, 'all', '2024-10-16')).toHaveLength(3)
  })
})

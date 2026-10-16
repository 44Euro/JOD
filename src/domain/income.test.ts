import { describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import {
  changePct,
  comparisonRange,
  incomeBuckets,
  incomeByAsset,
  periodRange,
  recentIncome,
  shiftYear,
  sumIncome,
} from './income'
import { computeLedger } from './ledger'

const cashFree = { quantity: undefined, price: undefined }
const baht = { currency: 'THB', fxRate: '1', fxSource: 'same' as const }
const { income } = computeLedger([
  makeTx({ ...cashFree, type: 'dividend', instrumentId: 'US:VOO', amount: '10', tax: '1.5', fxRate: '34', date: '2024-03-05' }),
  makeTx({ ...cashFree, ...baht, type: 'dividend', instrumentId: 'SET:PTT', amount: '1000', tax: '100', date: '2024-11-20' }),
  makeTx({ ...cashFree, ...baht, type: 'interest', instrumentId: undefined, amount: '100', tax: '15', date: '2025-02-10' }),
  makeTx({ ...cashFree, type: 'dividend', instrumentId: 'US:VOO', amount: '12', tax: '1.8', fxRate: '33', date: '2025-03-05' }),
  makeTx({ ...cashFree, ...baht, type: 'dividend', instrumentId: 'SET:PTT', amount: '1200', tax: '120', date: '2025-08-20' }),
])
const today = '2025-10-16'

describe('income periods', () => {
  it('moves a date back one year, landing Feb 29 on Feb 28', () => {
    expect(shiftYear('2025-10-16', -1)).toBe('2024-10-16')
    expect(shiftYear('2024-02-29', -1)).toBe('2023-02-28')
  })

  it('covers this year, the last twelve months, or everything since the first income', () => {
    expect(periodRange('year', today)).toEqual({ from: '2025-01-01', to: today })
    expect(periodRange('12m', today)).toEqual({ from: '2024-11-01', to: today })
    expect(periodRange('all', today, income)).toEqual({ from: '2024-03-05', to: today })
  })

  it('compares with the same days one year earlier', () => {
    expect(comparisonRange('year', today)).toEqual({ from: '2024-01-01', to: '2024-10-16' })
    expect(comparisonRange('12m', today)).toEqual({ from: '2023-11-01', to: '2024-10-16' })
    expect(comparisonRange('all', today)).toEqual(comparisonRange('year', today))
  })
})

describe('income totals', () => {
  it('adds income after tax, the tax withheld and each kind for the period', () => {
    const totals = sumIncome(income, periodRange('year', today))
    expect(totals.netBase.toString()).toBe('1501.6')
    expect(totals.grossBase.toString()).toBe('1696')
    expect(totals.taxBase.toString()).toBe('194.4')
    expect(totals.byKind.dividend.toString()).toBe('1416.6')
    expect(totals.byKind.interest.toString()).toBe('85')
    expect(totals.count).toBe(3)
  })

  it('compares with last year and averages the last twelve months', () => {
    const now = sumIncome(income, periodRange('year', today)).netBase
    const before = sumIncome(income, comparisonRange('year', today)).netBase
    expect(before.toString()).toBe('289')
    expect(changePct(now, before)?.toFixed(2)).toBe('419.58')
    expect(sumIncome(income, periodRange('12m', today)).netBase.div(12).toFixed(2)).toBe('200.13')
    expect(changePct(now, sumIncome([], periodRange('year', today)).netBase)).toBeNull()
  })
})

describe('income buckets', () => {
  it('has twelve months of the year with each kind stacked', () => {
    const months = incomeBuckets(income, 'year', today)
    expect(months.map((m) => m.key)).toHaveLength(12)
    expect(months[0].key).toBe('2025-01')
    expect(months[1].byKind.interest.toString()).toBe('85')
    expect(months[2].byKind.dividend.toString()).toBe('336.6')
    expect(months[7].netBase.toString()).toBe('1080')
    expect(months[11].netBase.toString()).toBe('0')
  })

  it('uses the last twelve months, or whole years for everything', () => {
    expect(incomeBuckets(income, '12m', today)[0]).toMatchObject({ key: '2024-11' })
    expect(incomeBuckets(income, '12m', today)[0].netBase.toString()).toBe('900')
    expect(incomeBuckets(income, 'all', today).map((y) => [y.key, y.netBase.toString()])).toEqual([
      ['2024', '1189'],
      ['2025', '1501.6'],
    ])
  })
})

describe('income by asset', () => {
  it('ranks assets by income and keeps cash interest per account', () => {
    const rows = incomeByAsset(income, periodRange('12m', today))
    expect(rows.map((r) => [r.key, r.netBase.toString(), r.taxBase.toString(), r.kinds])).toEqual([
      ['SET:PTT', '1980', '220', ['dividend']],
      ['US:VOO', '336.6', '59.4', ['dividend']],
      ['cash:acc-1', '85', '15', ['interest']],
    ])
  })

  it('lists the newest income first', () => {
    expect(recentIncome(income, 2).map((e) => e.date)).toEqual(['2025-08-20', '2025-03-05'])
  })
})

import { describe, expect, it } from 'vitest'
import { summarizeInvestor } from '../domain/investor'
import { computeLedger } from '../domain/ledger'
import type { Account, Instrument, Transaction } from '../domain/types'
import { valuePosition } from '../domain/valuation'
import { MarketError, type MarketClient } from '../market/client'
import { makeTx } from '../test/fixtures'
import { chatSuggestions, chatSystem, chatTools, type ChatData } from './chatTools'

const accounts = [
  { id: 'acc-1', name: 'Dime', broker: 'Dime', note: '', createdAt: '' },
  { id: 'acc-2', name: 'Streaming', broker: 'InnovestX', note: '', createdAt: '' },
] as Account[]

const aapl: Instrument = { id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple Inc.', assetType: 'stock', currency: 'USD', lastPrice: '120', lastPriceAt: '2026-11-01' }
const ptt: Instrument = { id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'PTT PCL', assetType: 'stock', currency: 'THB', lastPrice: '34', lastPriceAt: '2026-11-01' }
const baht = { currency: 'THB', fxRate: '1', fxSource: 'same' as const }

const portfolio = [
  makeTx({ instrumentId: 'US:AAPL', quantity: '10', price: '100', fxRate: '35', date: '2025-01-10' }),
  makeTx({ ...baht, accountId: 'acc-2', instrumentId: 'SET:PTT', quantity: '100', price: '30', date: '2025-02-01' }),
  makeTx({ type: 'dividend', instrumentId: 'US:AAPL', quantity: undefined, price: undefined, amount: '5', tax: '0.75', fxRate: '34', date: '2026-03-01' }),
]

function snapshot(transactions: Transaction[], instruments: Instrument[]): ChatData {
  const rates = { USD: '33', THB: '1' }
  const ledger = computeLedger(transactions)
  const byId = new Map(instruments.map((i) => [i.id, i]))
  const valuations = ledger.positions.map((p) => valuePosition(p, byId.get(p.instrumentId)?.lastPrice, rates[p.currency as 'USD' | 'THB']))
  const investor = summarizeInvestor({ transactions, ledger, valuations, rates })
  return { accounts, instruments, transactions, base: 'THB', ledger, valuations, investor, today: '2026-11-02' }
}

function fakeMarket(overrides: Partial<MarketClient> = {}) {
  const asked: unknown[][] = []
  const market = {
    quotes: async (ids: string[]) => {
      asked.push(['quotes', ids])
      return ids.map((id) => ({ id, price: '190.5', currency: 'USD', at: '2026-11-01T20:00:00Z', previousClose: '180', previousCloseAt: '2026-10-31', source: 'Yahoo' }))
    },
    news: async (symbols: string[]) => {
      asked.push(['news', symbols])
      return [{ id: 'n1', headline: 'Apple beats', source: 'Reuters', url: 'https://x', publishedAt: '2026-11-01T12:00:00Z', symbols: ['AAPL'] }]
    },
    earnings: async (from: string, to: string) => {
      asked.push(['earnings', from, to])
      return [
        { symbol: 'AAPL', date: '2026-11-05', time: 'after', epsEstimate: '1.6', epsActual: null },
        { symbol: 'ZZZ', date: '2026-11-06', time: null, epsEstimate: null, epsActual: null },
      ]
    },
    financials: async (symbol: string) => {
      asked.push(['financials', symbol])
      const periods = ['2021', '2022', '2023', '2024', '2025'].map((p) => ({ period: `FY${p}`, end: `${p}-09-30`, revenue: '1', netIncome: '1', freeCashFlow: '1' }))
      return { symbol, name: 'Apple Inc.', currency: 'USD' as const, shares: '15000000000', annual: periods, quarterly: periods }
    },
    ...overrides,
  } as unknown as MarketClient
  return { market, asked }
}

function tool(name: string, data = snapshot(portfolio, [aapl, ptt]), market = fakeMarket().market) {
  const found = chatTools(data, market).find((t) => t.name === name)
  if (!found) throw new Error(`no ${name}`)
  return found
}

describe('chat tools over the portfolio', () => {
  it('sums the portfolio up with the gain split into price and currency', async () => {
    const overview = (await tool('portfolio_overview').run({})) as Record<string, unknown>
    expect(overview).toMatchObject({ baseCurrency: 'THB', today: '2026-11-02', value: '43000', holdings: '43000', moneyInvested: '37855.5', holdingsCount: 2 })
    expect(overview.gain).toMatchObject({ priceUnrealized: '7400', currencyUnrealized: '-2400', income: '144.5' })
  })

  it('lists holdings largest first with their share and where the gain came from', async () => {
    const rows = (await tool('holdings').run({})) as Record<string, unknown>[]
    expect(rows.map((r) => r.symbol)).toEqual(['AAPL', 'PTT'])
    expect(rows[0]).toEqual({
      symbol: 'AAPL',
      name: 'Apple Inc.',
      market: 'US',
      account: 'Dime',
      units: '10',
      currency: 'USD',
      averageCost: '100',
      lastPrice: '120',
      priceDate: '2026-11-01',
      value: '39600',
      sharePct: '92.09',
      unrealized: '4600',
      fromPrice: '7000',
      fromCurrency: '-2400',
    })
  })

  it('gives income this year, over twelve months and expected ahead', async () => {
    const income = (await tool('income').run({})) as { thisYear: string; last12Months: string; byAsset: unknown[]; expected: { month: string }[] }
    expect([income.thisYear, income.last12Months]).toEqual(['144.5', '144.5'])
    expect(income.byAsset).toEqual([{ symbol: 'AAPL', net: '144.5' }])
    expect(income.expected.map((m) => m.month)).toContain('2027-03')
  })

  it('lists the latest transactions, optionally of one symbol', async () => {
    const latest = (await tool('transactions').run({ limit: 1 })) as Record<string, unknown>[]
    expect(latest).toEqual([{ date: '2026-03-01', type: 'dividend', symbol: 'AAPL', account: 'Dime', amount: '5', currency: 'USD', fees: '0', tax: '0.75' }])
    const ofPtt = (await tool('transactions').run({ symbol: 'ptt' })) as Record<string, unknown>[]
    expect(ofPtt.map((r) => [r.type, r.units, r.price])).toEqual([['buy', '100', '30']])
  })
})

describe('chat tools over the market', () => {
  it('asks the JOD server for quotes and refuses ids it cannot ask about', async () => {
    const { market, asked } = fakeMarket()
    const quotes = tool('market_quotes', undefined, market)
    expect(await quotes.run({ ids: ['us:aapl'] })).toEqual([{ id: 'US:AAPL', price: '190.5', currency: 'USD', previousClose: '180', changePct: '5.83', at: '2026-11-01T20:00:00Z', source: 'Yahoo' }])
    expect(asked).toEqual([['quotes', ['US:AAPL']]])
    const problem = 'ids must be 1 to 10 ids like US:AAPL or SET:PTT.'
    await expect(quotes.run({ ids: ['AAPL'] })).rejects.toThrow(problem)
    await expect(quotes.run({ ids: Array.from({ length: 11 }, (_, i) => `US:A${i}`) })).rejects.toThrow(problem)
    await expect(quotes.run(undefined)).rejects.toThrow(problem)
  })

  it('reads news and earnings of held US symbols unless others are asked for', async () => {
    const { market, asked } = fakeMarket()
    const news = (await tool('market_news', undefined, market).run({})) as { headline: string }[]
    expect(news[0]).toEqual({ headline: 'Apple beats', source: 'Reuters', publishedAt: '2026-11-01T12:00:00Z', symbols: ['AAPL'], url: 'https://x' })
    await tool('market_news', undefined, market).run({ symbols: ['nvda'] })
    const earnings = await tool('market_earnings', undefined, market).run({})
    expect(earnings).toEqual([{ symbol: 'AAPL', date: '2026-11-05', time: 'after', epsEstimate: '1.6', epsActual: null }])
    expect(asked).toEqual([
      ['news', ['AAPL']],
      ['news', ['NVDA']],
      ['earnings', '2026-11-02', '2026-11-15'],
    ])
  })

  it('gives the last four years and quarters of a US company', async () => {
    const result = (await tool('company_financials').run({ symbol: 'aapl' })) as { annual: { period: string }[]; quarterly: unknown[] }
    expect(result.annual.map((p) => p.period)).toEqual(['FY2022', 'FY2023', 'FY2024', 'FY2025'])
    expect(result.quarterly).toHaveLength(4)
    await expect(tool('company_financials').run({})).rejects.toThrow('symbol must be a US ticker like AAPL.')
  })

  it('says when the JOD server has not switched a source on', async () => {
    const { market } = fakeMarket({ news: () => Promise.reject(new MarketError(503)) })
    await expect(tool('market_news', undefined, market).run({})).rejects.toThrow('This JOD server has not switched this data on.')
  })
})

describe('chatSuggestions', () => {
  it('asks about the largest holding, the currency effect and news of held US shares', () => {
    expect(chatSuggestions(snapshot(portfolio, [aapl, ptt]))).toEqual([
      'AAPL ใหญ่ที่สุดในพอร์ต กระจุกตัวเกินไปไหม',
      'ค่าเงินทำให้พอร์ตได้หรือเสียไปเท่าไร',
      'มีข่าวอะไรของ AAPL บ้าง',
    ])
  })

  it('fills in plain questions when there is no foreign money or no holdings', () => {
    expect(chatSuggestions(snapshot([portfolio[1]], [ptt]))).toEqual([
      'PTT ใหญ่ที่สุดในพอร์ต กระจุกตัวเกินไปไหม',
      'สรุปพอร์ตของฉันให้หน่อย',
      'ปันผล 12 เดือนข้างหน้าน่าจะได้เท่าไร',
    ])
    expect(chatSuggestions(snapshot([], []))).toEqual(['ข่าวหุ้นต่างประเทศวันนี้มีอะไรบ้าง', 'หุ้นไหนประกาศงบสัปดาห์นี้', 'ราคา NVDA ตอนนี้เท่าไร'])
  })
})

it('tells the model the date, the base currency and to take figures only from tools', () => {
  const system = chatSystem('2026-11-02', 'THB')
  expect(system).toContain('Today is 2026-11-02')
  expect(system).toContain('THB')
  expect(system).toContain('never guess')
})

import type { ChatTool } from '../ai/chat'
import { addDays } from '../domain/dates'
import { D, type Decimal } from '../domain/decimal'
import { dividendCalendar } from '../domain/dividendCalendar'
import { incomeByAsset, periodRange, sumIncome } from '../domain/income'
import { positionValueBase, type InvestorSummary } from '../domain/investor'
import type { Ledger } from '../domain/ledger'
import { portfolioReturn } from '../domain/returns'
import type { Account, Instrument, Transaction } from '../domain/types'
import type { PositionValuation } from '../domain/valuation'
import { MarketError, type MarketClient } from '../market/client'
import { t } from '../i18n'

// What the chat may read of the person's data: the same figures the screens show, worked out on this device.
export interface ChatData {
  accounts: readonly Account[]
  instruments: readonly Instrument[]
  transactions: readonly Transaction[]
  base: string
  ledger: Ledger
  valuations: readonly PositionValuation[]
  investor: InvestorSummary
  today: string
}

export const TOOL_LABELS: Record<string, string> = {
  portfolio_overview: t('พอร์ต'),
  holdings: t('สินทรัพย์ที่ถือ'),
  income: t('ปันผล ดอกเบี้ย'),
  transactions: t('รายการ'),
  market_quotes: t('ราคาตลาด'),
  market_news: t('ข่าว'),
  market_earnings: t('ปฏิทินงบ'),
  company_financials: t('งบจาก SEC'),
}

export function chatSystem(today: string, base: string): string {
  return [
    `You are the assistant inside JOD, the person's own investment journal app. Today is ${today}. Amounts in their portfolio are in ${base} unless a currency is named.`,
    "Use the tools to read the person's portfolio (kept on their device) and market data from the JOD server. Every figure about their portfolio or the market must come from a tool result in this conversation: never guess or make up a number. When a tool cannot answer, say what is missing.",
    'Answer in the language of the question (usually Thai), briefly: a few sentences, or a short list with "- ". Plain text only: no headings, tables, bold or other markdown.',
    'Explain and compare, but do not tell the person to buy or sell a particular security; you are not their licensed adviser.',
  ].join('\n\n')
}

const money = (value: Decimal | null | undefined) => (value ? value.toDecimalPlaces(2).toString() : null)
const ID = /^(US|SET):[A-Z0-9.-]{1,12}$/
const TICKER = /^[A-Z0-9.-]{1,12}$/
const NO_INPUT = { type: 'object', properties: {} }
const TICKERS = { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'US tickers such as AAPL.' }

function fields(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
}

function tickers(value: unknown): string[] | null {
  if (value === undefined) return null
  const list = Array.isArray(value) ? value.map((v) => String(v).trim().toUpperCase()) : []
  if (list.length > 10 || !list.every((s) => TICKER.test(s))) throw new Error('symbols must be up to 10 US tickers like AAPL.')
  return list
}

async function fromMarket<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    if (error instanceof MarketError && error.status === 503) throw new Error('This JOD server has not switched this data on.')
    throw new Error('The JOD server could not get this data now.')
  }
}

function heldUs(data: ChatData): string[] {
  const held = new Set(data.ledger.positions.filter((p) => p.quantity.greaterThan(0)).map((p) => p.instrumentId))
  return data.instruments.filter((i) => held.has(i.id) && i.market === 'US').map((i) => i.symbol)
}

// Largest first, by value today in the base currency, across every account that holds it.
function bySize(valuations: readonly PositionValuation[]): string[] {
  const totals = new Map<string, Decimal>()
  for (const v of valuations) totals.set(v.position.instrumentId, (totals.get(v.position.instrumentId) ?? D(0)).plus(positionValueBase(v)))
  return [...totals].sort((a, b) => b[1].comparedTo(a[1])).map(([id]) => id)
}

export function chatTools(data: ChatData, market: MarketClient): ChatTool[] {
  const instrument = new Map(data.instruments.map((i) => [i.id, i]))
  const symbolOf = (id: string | undefined) => (id ? (instrument.get(id)?.symbol ?? id.split(':')[1] ?? id) : undefined)
  const accountOf = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? id
  const { worth, invested, gain } = data.investor

  return [
    {
      name: 'portfolio_overview',
      description: "The person's whole portfolio today: value, holdings, cash, money put in, the gain split by where it came from, and the return.",
      schema: NO_INPUT,
      run: async () => {
        const ret = portfolioReturn(data.investor.flows, worth.totalBase, data.today)
        return {
          baseCurrency: data.base,
          today: data.today,
          value: money(worth.totalBase),
          holdings: money(worth.holdingsBase),
          cash: money(worth.cashBase),
          moneyInvested: money(invested.totalBase),
          gain: {
            total: money(gain.totalBase),
            priceUnrealized: money(gain.unrealizedPriceBase),
            currencyUnrealized: money(gain.unrealizedFxBase),
            realized: money(gain.realizedBase),
            income: money(gain.incomeBase),
            fees: money(gain.otherFeesBase),
            currencyOnCash: money(gain.cashFxBase),
          },
          returnSinceStartPct: money(ret.sinceStartPct),
          annualReturnPct: ret.annualized ? money(ret.annualPct) : null,
          startDate: ret.startDate,
          holdingsCount: new Set(data.ledger.positions.filter((p) => p.quantity.greaterThan(0)).map((p) => p.instrumentId)).size,
          accounts: data.accounts.length,
          holdingsWithoutPrice: worth.unpricedCount,
          currenciesWithoutRate: worth.missingRates,
        }
      },
    },
    {
      name: 'holdings',
      description: `Each holding, largest first: units, average cost and last price in its own currency; value and unrealized gain in ${data.base}, split into the part from the price and the part from the exchange rate; and its share of all holdings.`,
      schema: NO_INPUT,
      run: async () =>
        [...data.valuations]
          .filter((v) => v.position.quantity.greaterThan(0))
          .sort((a, b) => positionValueBase(b).comparedTo(positionValueBase(a)))
          .map((v) => {
            const info = instrument.get(v.position.instrumentId)
            const value = positionValueBase(v)
            return {
              symbol: symbolOf(v.position.instrumentId),
              name: info?.name,
              market: info?.market,
              account: accountOf(v.position.accountId),
              units: v.position.quantity.toString(),
              currency: v.position.currency,
              averageCost: money(v.avgCostQuote),
              lastPrice: money(v.lastPrice),
              priceDate: info?.lastPriceAt?.slice(0, 10) ?? null,
              value: money(value),
              sharePct: worth.holdingsBase.isZero() ? null : money(value.div(worth.holdingsBase).times(100)),
              unrealized: money(v.unrealizedBase),
              fromPrice: money(v.priceEffectBase),
              fromCurrency: money(v.fxEffectBase),
            }
          }),
    },
    {
      name: 'income',
      description: `Dividends and interest after withholding tax, in ${data.base}: this calendar year, the last 12 months, the last 12 months by asset, and what the next 12 months may bring judged from the last 12 months and the units held now.`,
      schema: NO_INPUT,
      run: async () => {
        const events = data.ledger.income
        const twelve = periodRange('12m', data.today)
        return {
          thisYear: money(sumIncome(events, periodRange('year', data.today)).netBase),
          last12Months: money(sumIncome(events, twelve).netBase),
          // An asset is summed across accounts; only interest on cash, which has no asset, names its account.
          byAsset: incomeByAsset(events, twelve).map((row) => ({ symbol: symbolOf(row.instrumentId), account: row.accountId ? accountOf(row.accountId) : undefined, net: money(row.netBase) })),
          expected: dividendCalendar(data.ledger, data.today)
            .filter((m) => m.items.length > 0)
            .map((m) => ({ month: m.month, total: money(m.totalBase), alreadyReceived: m.items.every((i) => i.received) })),
        }
      },
    },
    {
      name: 'transactions',
      description: 'The latest recorded transactions, newest first, optionally of one symbol. Amounts are in the transaction currency.',
      schema: {
        type: 'object',
        properties: { symbol: { type: 'string', description: 'Only this symbol, e.g. AAPL or PTT.' }, limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many; 20 when left out.' } },
      },
      run: async (input) => {
        const { symbol, limit } = fields(input)
        const wanted = typeof symbol === 'string' && symbol.trim() ? symbol.trim().toUpperCase() : null
        const count = Math.min(Math.max(Math.trunc(Number(limit ?? 20)) || 20, 1), 50)
        return [...data.transactions]
          .filter((tx) => !wanted || symbolOf(tx.instrumentId)?.toUpperCase() === wanted)
          .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
          .slice(0, count)
          .map((tx) => ({
            date: tx.date,
            type: tx.type,
            symbol: symbolOf(tx.instrumentId),
            account: accountOf(tx.accountId),
            units: tx.quantity,
            price: tx.price,
            amount: tx.amount,
            currency: tx.currency,
            fees: tx.fees,
            tax: tx.tax,
          }))
      },
    },
    {
      name: 'market_quotes',
      description: 'Latest prices of US and Thai shares from the JOD server (Yahoo, about 15 minutes late), with the previous close.',
      schema: {
        type: 'object',
        properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10, description: 'Ids like US:AAPL or SET:PTT.' } },
        required: ['ids'],
      },
      run: async (input) => {
        const raw = fields(input).ids
        const ids = Array.isArray(raw) ? raw.map((id) => String(id).trim().toUpperCase()) : []
        if (ids.length === 0 || ids.length > 10 || !ids.every((id) => ID.test(id))) throw new Error('ids must be 1 to 10 ids like US:AAPL or SET:PTT.')
        const quotes = await fromMarket(() => market.quotes(ids))
        return quotes.map((q) => ({
          id: q.id,
          price: q.price,
          currency: q.currency,
          previousClose: q.previousClose,
          changePct: q.previousClose && !D(q.previousClose).isZero() ? money(D(q.price).minus(q.previousClose).div(q.previousClose).times(100)) : null,
          at: q.at,
          source: q.source,
        }))
      },
    },
    {
      name: 'market_news',
      description: 'Recent English news headlines from the JOD server (Finnhub) for US tickers; the US shares held when none are given, general market news when none are held.',
      schema: { type: 'object', properties: { symbols: TICKERS } },
      run: async (input) => {
        const symbols = tickers(fields(input).symbols) ?? heldUs(data).slice(0, 10)
        const news = await fromMarket(() => market.news(symbols))
        return news.slice(0, 10).map((n) => ({ headline: n.headline, source: n.source, publishedAt: n.publishedAt, symbols: n.symbols, url: n.url }))
      },
    },
    {
      name: 'market_earnings',
      description: 'US earnings announcements in the next 14 days from the JOD server (Finnhub), for the given tickers or else the US shares held.',
      schema: { type: 'object', properties: { symbols: TICKERS } },
      run: async (input) => {
        const asked = tickers(fields(input).symbols)
        const symbols = new Set(asked ?? heldUs(data))
        const events = await fromMarket(() => market.earnings(data.today, addDays(data.today, 13)))
        return events.filter((e) => symbols.size === 0 || symbols.has(e.symbol)).slice(0, 30)
      },
    },
    {
      name: 'company_financials',
      description: "A US company's revenue, net income and free cash flow for its last four fiscal years and quarters, and its shares outstanding, from SEC filings via the JOD server. Amounts in USD.",
      schema: { type: 'object', properties: { symbol: { type: 'string', description: 'A US ticker such as AAPL.' } }, required: ['symbol'] },
      run: async (input) => {
        const symbol = String(fields(input).symbol ?? '').trim().toUpperCase()
        if (!TICKER.test(symbol)) throw new Error('symbol must be a US ticker like AAPL.')
        const facts = await fromMarket(() => market.financials(symbol))
        return { name: facts.name, currency: facts.currency, shares: facts.shares, annual: facts.annual.slice(-4), quarterly: facts.quarterly.slice(-4) }
      },
    },
  ]
}

// Three questions drawn from the person's own data, then plain ones to make up three.
export function chatSuggestions(data: ChatData): string[] {
  const largest = bySize(data.valuations.filter((v) => v.position.quantity.greaterThan(0)))[0]
  const foreign = data.ledger.positions.some((p) => p.quantity.greaterThan(0) && p.currency !== data.base)
  const us = bySize(data.valuations)
    .filter((id) => id.startsWith('US:'))
    .map((id) => data.instruments.find((i) => i.id === id)?.symbol ?? id.slice(3))
    .slice(0, 3)
  const own = [
    largest && t('{0} ใหญ่ที่สุดในพอร์ต กระจุกตัวเกินไปไหม', data.instruments.find((i) => i.id === largest)?.symbol ?? largest.split(':')[1]),
    foreign && t('ค่าเงินทำให้พอร์ตได้หรือเสียไปเท่าไร'),
    us.length > 0 && t('มีข่าวอะไรของ {0} บ้าง', us.join(', ')),
  ].filter((s): s is string => Boolean(s))
  const plain = largest
    ? [t('สรุปพอร์ตของฉันให้หน่อย'), t('ปันผล 12 เดือนข้างหน้าน่าจะได้เท่าไร'), t('ข่าวหุ้นต่างประเทศวันนี้มีอะไรบ้าง')]
    : [t('ข่าวหุ้นต่างประเทศวันนี้มีอะไรบ้าง'), t('หุ้นไหนประกาศงบสัปดาห์นี้'), t('ราคา NVDA ตอนนี้เท่าไร')]
  return [...own, ...plain].slice(0, 3)
}

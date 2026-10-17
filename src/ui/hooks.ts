import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { db } from '../db/db'
import { getSettings } from '../db/repo'
import { summarizeInvestor } from '../domain/investor'
import { computeLedger } from '../domain/ledger'
import type { Transaction } from '../domain/types'
import { latestRecordedRate, summarizePortfolio, valuePosition } from '../domain/valuation'
import { useFxProvider } from '../fx/context'
import { getFxQuote, peekCachedQuote, type FxQuote } from '../fx/fxService'
import { fmtDate } from './format'

export function useAppData() {
  return useLiveQuery(async () => {
    const [accounts, instruments, transactions, settings] = await Promise.all([
      db.accounts.orderBy('name').toArray(),
      db.instruments.toArray(),
      db.transactions.toArray(),
      getSettings(db),
    ])
    return { accounts, instruments, transactions, settings }
  }, [])
}

export type AppData = NonNullable<ReturnType<typeof useAppData>>

export function useLedger(data: AppData | undefined) {
  return useMemo(() => (data ? computeLedger(data.transactions) : null), [data])
}

export interface RateInfo {
  rate: string
  note: string
}

export interface LatestRates {
  rates: Record<string, RateInfo>
  // False while a currency has not been looked up yet, which is different from a lookup that found no rate.
  ready: boolean
  // True once every rate comes from a finished lookup rather than a cached rate shown while it runs. A screen can
  // show the cached rate, but nothing may be stored from it.
  confirmed: boolean
}

interface Lookup {
  base: string
  rates: Record<string, RateInfo>
  settled: readonly string[]
  confirmed: readonly string[]
}

const NO_TRANSACTIONS: Transaction[] = []
const BASE_RATE: RateInfo = { rate: '1', note: '' }

function ecbRate(quote: FxQuote): RateInfo {
  return { rate: quote.rate, note: `ECB ${fmtDate(quote.rateDate)}` }
}

function sameRate(a: RateInfo | undefined, b: RateInfo | null): boolean {
  return a === undefined ? b === null : b !== null && a.rate === b.rate && a.note === b.note
}

export function useLatestRates(
  currencies: readonly string[],
  baseCurrency: string,
  transactions: readonly Transaction[],
): LatestRates {
  const provider = useFxProvider()
  const [lookup, setLookup] = useState<Lookup>({ base: baseCurrency, rates: {}, settled: [], confirmed: [] })
  const wanted = [...new Set(currencies)].sort().join(',')
  const known = lookup.base === baseCurrency ? lookup : null

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller

    function settle(currency: string, info: RateInfo | null, confirmed: boolean) {
      if (signal.aborted) return
      setLookup((prev) => {
        const same = prev.base === baseCurrency
        const settled = same ? prev.settled : []
        const sure = same ? prev.confirmed : []
        if (settled.includes(currency) && (!confirmed || sure.includes(currency)) && sameRate(prev.rates[currency], info)) return prev
        const rates = { ...(same ? prev.rates : {}) }
        if (info) rates[currency] = info
        else delete rates[currency]
        return {
          base: baseCurrency,
          rates,
          settled: [...new Set([...settled, currency])],
          confirmed: confirmed ? [...new Set([...sure, currency])] : sure,
        }
      })
    }

    // The cached rate of any age is shown at once; getFxQuote then keeps it if it is fresh and refreshes it if not.
    async function lookUp(currency: string) {
      let cached: FxQuote | null = null
      try {
        cached = await peekCachedQuote(db, currency, baseCurrency)
        if (cached) settle(currency, ecbRate(cached), false)
        settle(currency, ecbRate(await getFxQuote(db, provider, currency, baseCurrency, 'latest', new Date(), signal)), true)
      } catch {
        const recorded = latestRecordedRate(transactions, currency)
        const fallback = cached ? ecbRate(cached) : recorded ? { rate: recorded, note: 'เรทล่าสุดที่บันทึกไว้' } : null
        settle(currency, fallback, true)
      }
    }

    for (const currency of wanted ? wanted.split(',') : []) {
      if (currency !== baseCurrency) void lookUp(currency)
    }
    return () => controller.abort()
  }, [wanted, baseCurrency, provider, transactions])

  return useMemo(() => {
    const list = wanted ? wanted.split(',') : []
    const rates: Record<string, RateInfo> = {}
    for (const currency of list) {
      const info = currency === baseCurrency ? BASE_RATE : known?.rates[currency]
      if (info) rates[currency] = info
    }
    return {
      rates,
      ready: list.every((c) => c === baseCurrency || known?.settled.includes(c)),
      confirmed: list.every((c) => c === baseCurrency || known?.confirmed.includes(c)),
    }
  }, [wanted, baseCurrency, known])
}

export function usePortfolio(data: AppData | undefined) {
  const ledger = useLedger(data)
  const currencies = useMemo(
    () => (ledger ? [...ledger.positions.map((p) => p.currency), ...ledger.cash.map((c) => c.currency)] : []),
    [ledger],
  )
  const { rates, ready, confirmed } = useLatestRates(
    currencies,
    data?.settings.baseCurrency ?? 'THB',
    data?.transactions ?? NO_TRANSACTIONS,
  )
  const valuations = useMemo(() => {
    if (!ledger || !data) return []
    const prices = new Map(data.instruments.map((i) => [i.id, i.lastPrice]))
    return ledger.positions.map((p) => valuePosition(p, prices.get(p.instrumentId), rates[p.currency]?.rate))
  }, [ledger, data, rates])
  const summary = useMemo(() => summarizePortfolio(valuations), [valuations])
  return { ledger, valuations, summary, rates, ready, confirmed }
}

export function useInvestor(data: AppData | undefined) {
  const portfolio = usePortfolio(data)
  const { ledger, valuations, rates, ready } = portfolio
  // Totals worked out from rates that are still on their way are wrong, so none are offered until they are in.
  const investor = useMemo(() => {
    if (!data || !ledger || !ready) return null
    const rateValues = Object.fromEntries(Object.entries(rates).map(([currency, info]) => [currency, info.rate]))
    return summarizeInvestor({ transactions: data.transactions, ledger, valuations, rates: rateValues })
  }, [data, ledger, valuations, rates, ready])
  return { ...portfolio, investor }
}

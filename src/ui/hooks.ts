import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { db } from '../db/db'
import { getSettings } from '../db/repo'
import { computeLedger } from '../domain/ledger'
import type { Transaction } from '../domain/types'
import { latestRecordedRate, summarizePortfolio, valuePosition } from '../domain/valuation'
import { useFxProvider } from '../fx/context'
import { getFxQuote } from '../fx/fxService'
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

const NO_TRANSACTIONS: Transaction[] = []

export function useLatestRates(
  currencies: readonly string[],
  baseCurrency: string,
  transactions: readonly Transaction[],
): Record<string, RateInfo> {
  const provider = useFxProvider()
  const [rates, setRates] = useState<Record<string, RateInfo>>({})
  const wanted = [...new Set(currencies)].sort().join(',')

  useEffect(() => {
    let cancelled = false
    const list = wanted ? wanted.split(',') : []
    Promise.all(
      list.map(async (currency): Promise<[string, RateInfo] | null> => {
        try {
          const quote = await getFxQuote(db, provider, currency, baseCurrency, 'latest')
          return [currency, { rate: quote.rate, note: quote.source === 'same' ? '' : `ECB ${fmtDate(quote.rateDate)}` }]
        } catch {
          const recorded = latestRecordedRate(transactions, currency)
          return recorded ? [currency, { rate: recorded, note: 'เรทล่าสุดที่บันทึกไว้' }] : null
        }
      }),
    ).then((rows) => {
      if (!cancelled) setRates(Object.fromEntries(rows.filter((row) => row !== null)))
    })
    return () => {
      cancelled = true
    }
  }, [wanted, baseCurrency, provider, transactions])

  return rates
}

export function usePortfolio(data: AppData | undefined) {
  const ledger = useLedger(data)
  const currencies = useMemo(
    () => (ledger ? [...ledger.positions.map((p) => p.currency), ...ledger.cash.map((c) => c.currency)] : []),
    [ledger],
  )
  const rates = useLatestRates(currencies, data?.settings.baseCurrency ?? 'THB', data?.transactions ?? NO_TRANSACTIONS)
  const valuations = useMemo(() => {
    if (!ledger || !data) return []
    const prices = new Map(data.instruments.map((i) => [i.id, i.lastPrice]))
    return ledger.positions.map((p) => valuePosition(p, prices.get(p.instrumentId), rates[p.currency]?.rate))
  }, [ledger, data, rates])
  const summary = useMemo(() => summarizePortfolio(valuations), [valuations])
  return { ledger, valuations, summary, rates }
}

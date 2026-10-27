import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { db } from '../db/db'
import { MarketError } from '../market/client'
import { heldInstruments } from '../prices/run'
import { useLedger, type AppData } from './hooks'

export type MarketState<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'failed' } | { status: 'off' }

// One fetch per key; an answer that arrives after the screen moved on to another key is dropped.
export function useMarket<T>(key: string, load: () => Promise<T>): MarketState<T> {
  const [answer, setAnswer] = useState<{ key: string; state: MarketState<T> } | null>(null)
  useEffect(() => {
    let current = true
    load().then(
      (data) => current && setAnswer({ key, state: { status: 'ready', data } }),
      (error: unknown) => current && setAnswer({ key, state: { status: error instanceof MarketError && error.status === 503 ? 'off' : 'failed' } }),
    )
    return () => {
      current = false
    }
    // The key names what is loaded, so a new load function for the same key is the same request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return answer?.key === key ? answer.state : { status: 'loading' }
}

// The US symbols the person holds now and watches, for news and the earnings calendar.
export function useMySymbols(data: AppData | undefined): { held: string[]; watched: string[] } {
  const ledger = useLedger(data)
  const watchlist = useLiveQuery(() => db.watchlist.toArray(), [])
  return useMemo(() => {
    const held = ledger && data ? heldInstruments(ledger, data.instruments).filter((i) => i.market === 'US').map((i) => i.symbol) : []
    const watched = (watchlist ?? []).filter((w) => w.market === 'US').map((w) => w.symbol)
    return { held, watched }
  }, [ledger, data, watchlist])
}

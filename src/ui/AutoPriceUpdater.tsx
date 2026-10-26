import { useEffect } from 'react'
import { AUTO_PRICES_STORAGE_KEY, readLocal, useLocal, writeLocal } from '../ai/apiKey'
import { db } from '../db/db'
import { todayLocal } from '../domain/dates'
import { DEFAULT_BENCHMARK, heldInstruments, runPriceUpdate, usePriceSources } from '../prices/run'
import { useAppData, useLedger } from './hooks'

const LAST_RUN_KEY = 'jod-auto-prices-last'

// Opt-in, because it tells the price sources which assets are held. Runs once a day, on the first open with data.
export function AutoPriceUpdater() {
  const enabled = useLocal(AUTO_PRICES_STORAGE_KEY) === 'on'
  const data = useAppData()
  const ledger = useLedger(data)
  const sources = usePriceSources()
  const ready = enabled && data !== undefined && ledger !== null

  useEffect(() => {
    if (!ready || !data || !ledger) return
    const today = todayLocal()
    if (readLocal(LAST_RUN_KEY) === today) return
    writeLocal(LAST_RUN_KEY, today)
    void runPriceUpdate(db, heldInstruments(ledger, data.instruments), sources, data.settings.benchmarkSymbol ?? DEFAULT_BENCHMARK, today).catch(() => {})
    // Runs once per day: later changes to data must not start another round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  return null
}

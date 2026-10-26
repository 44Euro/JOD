import type { JodDB } from '../db/db'
import { setInstrumentPrice } from '../db/repo'
import { USD_PEGGED } from '../domain/currencies'
import type { Instrument } from '../domain/types'
import type { PriceSource } from './providers'

export interface PriceUpdateResult {
  updated: string[]
  // No source covers these (Thai shares, funds), so they stay manual.
  manual: string[]
  failed: string[]
}

const sameMoney = (a: string, b: string) => a === b || (a === 'USD' && USD_PEGGED.includes(b)) || (b === 'USD' && USD_PEGGED.includes(a))

// One asset at a time, so a free plan's rate limit is not hit by a burst; a failure leaves that price as it was.
export async function updatePrices(
  db: JodDB,
  instruments: readonly Instrument[],
  sources: readonly PriceSource[],
  now: Date = new Date(),
  signal?: AbortSignal,
): Promise<PriceUpdateResult> {
  const result: PriceUpdateResult = { updated: [], manual: [], failed: [] }
  for (const instrument of instruments) {
    signal?.throwIfAborted()
    const source = sources.find((s) => s.covers(instrument))
    if (!source) {
      result.manual.push(instrument.symbol)
      continue
    }
    try {
      const quote = await source.quote(instrument, signal)
      if (!quote || !sameMoney(quote.currency, instrument.currency)) {
        result.failed.push(instrument.symbol)
        continue
      }
      await setInstrumentPrice(db, instrument.id, quote.price, now)
      result.updated.push(instrument.symbol)
    } catch {
      if (signal?.aborted) throw signal.reason
      result.failed.push(instrument.symbol)
    }
  }
  return result
}

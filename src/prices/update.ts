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

// One asset at a time, so a free plan's rate limit is not hit by a burst. Each source that covers an asset is tried in
// turn, so the user's own keys still work when the JOD server cannot be reached; a failure leaves the price as it was.
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
    const covering = sources.filter((s) => s.covers(instrument))
    if (covering.length === 0) {
      result.manual.push(instrument.symbol)
      continue
    }
    let updated = false
    for (const source of covering) {
      try {
        const quote = await source.quote(instrument, signal)
        if (!quote || !sameMoney(quote.currency, instrument.currency)) continue
        await setInstrumentPrice(db, instrument.id, quote.price, quote.at ? new Date(quote.at) : now, {
          source: quote.source ?? source.name,
          previousPrice: quote.previousClose,
          previousPriceAt: quote.previousCloseAt,
        })
        updated = true
        break
      } catch {
        if (signal?.aborted) throw signal.reason
      }
    }
    result[updated ? 'updated' : 'failed'].push(instrument.symbol)
  }
  return result
}

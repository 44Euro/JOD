import { useMemo } from 'react'
import { COINGECKO_KEY_STORAGE_KEY, useLocal } from '../ai/apiKey'
import type { JodDB } from '../db/db'
import { recordBenchmark } from '../db/repo'
import type { Ledger } from '../domain/ledger'
import type { Instrument } from '../domain/types'
import { marketClient } from '../market/client'
import { createCoinGecko, createJodServer, type PriceSource } from './providers'
import { updatePrices, type PriceUpdateResult } from './update'
import { t } from '../i18n'

export const DEFAULT_BENCHMARK = 'SPY'

export function usePriceSources(): PriceSource[] {
  const gecko = useLocal(COINGECKO_KEY_STORAGE_KEY)
  return useMemo(() => [createJodServer(marketClient), createCoinGecko(undefined, gecko)], [gecko])
}

export function heldInstruments(ledger: Ledger, instruments: readonly Instrument[]): Instrument[] {
  const held = new Set(ledger.positions.filter((p) => p.quantity.gt(0)).map((p) => p.instrumentId))
  return instruments.filter((i) => held.has(i.id))
}

// Prices of everything held, then the benchmark's price for today's row when a source can quote it.
export async function runPriceUpdate(
  db: JodDB,
  held: readonly Instrument[],
  sources: readonly PriceSource[],
  benchmarkSymbol: string,
  today: string,
  now: Date = new Date(),
): Promise<PriceUpdateResult> {
  const result = await updatePrices(db, held, sources, now)
  const benchmark: Instrument = { id: `US:${benchmarkSymbol}`, market: 'US', symbol: benchmarkSymbol, name: benchmarkSymbol, assetType: 'etf', currency: 'USD' }
  for (const source of sources.filter((s) => s.covers(benchmark))) {
    const quote = await source.quote(benchmark).catch(() => null)
    if (!quote) continue
    await recordBenchmark(db, today, benchmarkSymbol, quote.price)
    break
  }
  return result
}

export function describeUpdate(result: PriceUpdateResult): string {
  const parts = [t('อัปเดต {0} ตัว', result.updated.length)]
  if (result.failed.length > 0) parts.push(t('ดึงไม่ได้: {0}', result.failed.join(', ')))
  if (result.manual.length > 0) parts.push(t('ไม่มีแหล่งราคาอัตโนมัติ กรอกเอง: {0}', result.manual.join(', ')))
  return parts.join(' · ')
}

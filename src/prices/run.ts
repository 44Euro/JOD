import { useMemo } from 'react'
import { COINGECKO_KEY_STORAGE_KEY, FINNHUB_KEY_STORAGE_KEY, useLocal } from '../ai/apiKey'
import type { JodDB } from '../db/db'
import { recordBenchmark } from '../db/repo'
import type { Ledger } from '../domain/ledger'
import type { Instrument } from '../domain/types'
import { createCoinGecko, createFinnhub, type PriceSource } from './providers'
import { updatePrices, type PriceUpdateResult } from './update'
import { t } from '../i18n'

export const DEFAULT_BENCHMARK = 'SPY'

export function usePriceSources(): PriceSource[] {
  const finnhub = useLocal(FINNHUB_KEY_STORAGE_KEY)
  const gecko = useLocal(COINGECKO_KEY_STORAGE_KEY)
  return useMemo(() => [createCoinGecko(undefined, gecko), createFinnhub(finnhub)], [finnhub, gecko])
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
  const source = sources.find((s) => s.covers(benchmark))
  if (source) {
    const quote = await source.quote(benchmark).catch(() => null)
    if (quote) await recordBenchmark(db, today, benchmarkSymbol, quote.price)
  }
  return result
}

// A US share left manual only lacks the user's Finnhub key, which is worth saying apart from assets no source covers.
export function describeUpdate(result: PriceUpdateResult, held: readonly Instrument[]): string {
  const us = new Set(held.filter((i) => i.market === 'US').map((i) => i.symbol))
  const needKey = result.manual.filter((s) => us.has(s))
  const manual = result.manual.filter((s) => !us.has(s))
  const parts = [t('อัปเดต {0} ตัว', result.updated.length)]
  if (result.failed.length > 0) parts.push(t('ดึงไม่ได้: {0}', result.failed.join(', ')))
  if (needKey.length > 0) parts.push(t('ใส่ key Finnhub ในหน้าตั้งค่าเพื่อดึง: {0}', needKey.join(', ')))
  if (manual.length > 0) parts.push(t('ไม่มีแหล่งราคาอัตโนมัติ กรอกเอง: {0}', manual.join(', ')))
  return parts.join(' · ')
}

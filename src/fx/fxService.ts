import type { JodDB } from '../db/db'
import { supportsAutoFx } from '../domain/currencies'
import { todayLocal } from '../domain/dates'
import { FxUnavailableError, type FxProvider } from './frankfurter'

export interface FxQuote {
  rate: string
  rateDate: string
  source: 'same' | 'auto'
}

const LATEST_TTL_MS = 6 * 60 * 60 * 1000

export async function getFxQuote(
  db: JodDB,
  provider: FxProvider,
  from: string,
  to: string,
  date: string | 'latest',
  now: Date = new Date(),
): Promise<FxQuote> {
  const today = todayLocal(now)
  if (from === to) return { rate: '1', rateDate: date === 'latest' ? today : date, source: 'same' }
  if (!supportsAutoFx(from) || !supportsAutoFx(to)) {
    throw new FxUnavailableError(`ไม่มีเรทอัตโนมัติสำหรับ ${from}/${to} กรุณากรอกเรทเอง`)
  }

  // The ECB publishes once per working day, so only past dates are final and safe to cache forever.
  const isFinal = date !== 'latest' && date < today
  const requested = isFinal ? date : 'latest'
  const key = `${from}|${to}|${requested}`
  const cached = await db.fxRates.get(key)
  const fresh = cached && (isFinal || now.getTime() - Date.parse(cached.fetchedAt) < LATEST_TTL_MS)
  if (cached && fresh) return { rate: cached.rate, rateDate: cached.rateDate, source: 'auto' }

  try {
    const result = await provider.getRate(from, to, requested)
    await db.fxRates.put({ key, ...result, fetchedAt: now.toISOString() })
    return { ...result, source: 'auto' }
  } catch (error) {
    if (cached) return { rate: cached.rate, rateDate: cached.rateDate, source: 'auto' }
    throw error
  }
}

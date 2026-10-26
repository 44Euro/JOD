import type { JodDB } from '../db/db'
import { supportsAutoFx, USD_PEGGED } from '../domain/currencies'
import { todayLocal } from '../domain/dates'
import { FxUnavailableError, type FxProvider } from './frankfurter'
import { t } from '../i18n'

export interface FxQuote {
  rate: string
  rateDate: string
  source: 'same' | 'auto'
}

const LATEST_TTL_MS = 6 * 60 * 60 * 1000

// The newest cached rate for a pair whatever its age, so a screen can start from it while a refresh is on its way.
export async function peekCachedQuote(db: JodDB, from: string, to: string): Promise<FxQuote | null> {
  const cached = await db.fxRates.get(`${from}|${to}|latest`)
  return cached ? { rate: cached.rate, rateDate: cached.rateDate, source: 'auto' } : null
}

export async function getFxQuote(
  db: JodDB,
  provider: FxProvider,
  from: string,
  to: string,
  date: string | 'latest',
  now: Date = new Date(),
  signal?: AbortSignal,
): Promise<FxQuote> {
  const today = todayLocal(now)
  if (from === to) return { rate: '1', rateDate: date === 'latest' ? today : date, source: 'same' }
  if (!supportsAutoFx(from) || !supportsAutoFx(to)) {
    throw new FxUnavailableError(t('ไม่มีเรทอัตโนมัติสำหรับ {0}/{1} กรุณากรอกเรทเอง', from, to))
  }

  // The ECB publishes once per working day, so only past dates are final and safe to cache forever.
  const isFinal = date !== 'latest' && date < today
  const requested = isFinal ? date : 'latest'
  const key = `${from}|${to}|${requested}`
  const cached = await db.fxRates.get(key)
  const fresh = cached && (isFinal || now.getTime() - Date.parse(cached.fetchedAt) < LATEST_TTL_MS)
  if (cached && fresh) return { rate: cached.rate, rateDate: cached.rateDate, source: 'auto' }

  try {
    const result = await provider.getRate(from, to, requested, signal)
    // A caller that has gone away must not leave behind a row that the next reader takes for a fresh rate.
    signal?.throwIfAborted()
    await db.fxRates.put({ key, ...result, fetchedAt: now.toISOString() })
    return { ...result, source: 'auto' }
  } catch (error) {
    if (cached && !signal?.aborted) return { rate: cached.rate, rateDate: cached.rateDate, source: 'auto' }
    throw error
  }
}

// A dollar-pegged coin has no rate of its own, so the dollar's stands in for it; when the dollar has none either, the
// reason is the coin's own.
export async function quoteWithPegFallback(
  db: JodDB,
  provider: FxProvider,
  from: string,
  to: string,
  date: string,
): Promise<{ quote: FxQuote; borrowed: boolean }> {
  try {
    return { quote: await getFxQuote(db, provider, from, to, date), borrowed: false }
  } catch (error) {
    const dollarFor = (currency: string) => (USD_PEGGED.includes(currency) ? 'USD' : currency)
    if (dollarFor(from) === from && dollarFor(to) === to) throw error
    const quote = await getFxQuote(db, provider, dollarFor(from), dollarFor(to), date).catch(() => {
      throw error
    })
    return { quote, borrowed: true }
  }
}

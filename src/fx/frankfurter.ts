import { t } from '../i18n'
export interface FxRateResult {
  rate: string
  rateDate: string
}

export interface FxProvider {
  getRate(from: string, to: string, date: string | 'latest', signal?: AbortSignal): Promise<FxRateResult>
}

export class FxUnavailableError extends Error {
  name = 'FxUnavailableError'
}

// A hung connection never rejects by itself, and the stale-cache fallback only runs once this rejects.
const REQUEST_TIMEOUT_MS = 8000

// AbortSignal.timeout and AbortSignal.any are missing from older Safari, so the timeout and the caller's signal
// are combined by hand; a browser without them would otherwise never load a rate.
export function timeLimited(caller: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onCallerAbort = () => controller.abort(caller?.reason)
  if (caller?.aborted) controller.abort(caller.reason)
  else caller?.addEventListener('abort', onCallerAbort, { once: true })
  return {
    signal: controller.signal,
    done() {
      clearTimeout(timer)
      caller?.removeEventListener('abort', onCallerAbort)
    },
  }
}

export function createFrankfurterProvider(
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
  baseUrl = 'https://api.frankfurter.dev/v1',
  timeoutMs = REQUEST_TIMEOUT_MS,
): FxProvider {
  return {
    async getRate(from, to, date, signal) {
      const url = `${baseUrl}/${date}?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`
      const limit = timeLimited(signal, timeoutMs)
      try {
        let response: Response
        try {
          response = await fetchFn(url, { signal: limit.signal })
        } catch {
          throw new FxUnavailableError(t('เชื่อมต่อแหล่งเรทไม่ได้ (ออฟไลน์อยู่หรือเปล่า?) กรุณากรอกเรทเอง'))
        }
        if (!response.ok) throw new FxUnavailableError(t('ไม่มีเรท {0}/{1} ของวันที่ {2} กรุณากรอกเรทเอง', from, to, date))
        const body = (await response.json().catch(() => null)) as { date: string; rates?: Record<string, number> } | null
        const value = body?.rates?.[to]
        if (!body || value === undefined) throw new FxUnavailableError(t('ไม่มีเรท {0}/{1} กรุณากรอกเรทเอง', from, to))
        return { rate: String(value), rateDate: body.date }
      } finally {
        limit.done()
      }
    },
  }
}

export interface FxRateResult {
  rate: string
  rateDate: string
}

export interface FxProvider {
  getRate(from: string, to: string, date: string | 'latest'): Promise<FxRateResult>
}

export class FxUnavailableError extends Error {
  name = 'FxUnavailableError'
}

export function createFrankfurterProvider(
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
  baseUrl = 'https://api.frankfurter.dev/v1',
): FxProvider {
  return {
    async getRate(from, to, date) {
      const url = `${baseUrl}/${date}?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`
      let response: Response
      try {
        response = await fetchFn(url)
      } catch {
        throw new FxUnavailableError('เชื่อมต่อแหล่งเรทไม่ได้ (ออฟไลน์อยู่หรือเปล่า?) กรุณากรอกเรทเอง')
      }
      if (!response.ok) throw new FxUnavailableError(`ไม่มีเรท ${from}/${to} ของวันที่ ${date} กรุณากรอกเรทเอง`)
      const body = (await response.json().catch(() => null)) as { date: string; rates?: Record<string, number> } | null
      const value = body?.rates?.[to]
      if (!body || value === undefined) throw new FxUnavailableError(`ไม่มีเรท ${from}/${to} กรุณากรอกเรทเอง`)
      return { rate: String(value), rateDate: body.date }
    },
  }
}

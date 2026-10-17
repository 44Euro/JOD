import { FxUnavailableError, type FxProvider } from '../fx/frankfurter'

// rates: { 'USD|THB': '35.1' }. Requests for 'latest' resolve to latestDate.
export function fakeFxProvider(rates: Record<string, string>, latestDate = '2024-01-15') {
  const calls: string[] = []
  const provider: FxProvider = {
    async getRate(from, to, date) {
      calls.push(`${from}|${to}|${date}`)
      const rate = rates[`${from}|${to}`]
      if (!rate) throw new FxUnavailableError(`ไม่มีเรท ${from}/${to} กรุณากรอกเรทเอง`)
      return { rate, rateDate: date === 'latest' ? latestDate : date }
    },
  }
  return { provider, calls }
}

// Answers only after release() is called, to look at a screen while the network is still out.
export function lateFxProvider(rates: Record<string, string>, latestDate = '2024-01-15') {
  const inner = fakeFxProvider(rates, latestDate).provider
  const signals: (AbortSignal | undefined)[] = []
  let requests = 0
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const provider: FxProvider = {
    async getRate(from, to, date, signal) {
      requests += 1
      signals.push(signal)
      await gate
      return inner.getRate(from, to, date, signal)
    },
  }
  return { provider, release, signals, requested: () => requests }
}

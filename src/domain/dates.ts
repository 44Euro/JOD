const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const [, y, m, d] = match.map(Number)
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

export function monthKey(date: string): string {
  return date.slice(0, 7)
}

// Both dates parse as UTC midnight, so daylight saving never shifts the count.
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
}

// lastPriceAt is a UTC timestamp; comparing its UTC date with the local today would count a price typed
// at 06:00 in Bangkok as a day older than it is.
export function priceAgeDays(updatedAt: string | undefined, today: string): number | null {
  if (!updatedAt) return null
  return daysBetween(todayLocal(new Date(updatedAt)), today)
}

// The current month and the eleven before it, oldest first, as YYYY-MM keys.
export function lastTwelveMonths(today: string): string[] {
  const [y, m] = today.split('-').map(Number)
  return Array.from({ length: 12 }, (_, i) => {
    const date = new Date(Date.UTC(y, m - 12 + i, 1))
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + days))
  return next.toISOString().slice(0, 10)
}

// The US week the earnings calendar shows: Monday to Friday of today's week, or of the coming one at the weekend.
export function tradingWeek(today: string): string[] {
  const [y, m, d] = today.split('-').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const monday = addDays(today, weekday === 0 ? 1 : weekday === 6 ? 2 : 1 - weekday)
  return [0, 1, 2, 3, 4].map((i) => addDays(monday, i))
}

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

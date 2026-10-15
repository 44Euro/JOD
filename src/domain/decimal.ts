import Decimal from 'decimal.js'

// toExpNeg/toExpPos keep values like 0.00000001 BTC out of exponential notation,
// because amounts are stored as plain decimal strings.
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -30, toExpPos: 40 })

export { Decimal }

export function D(value?: Decimal.Value | null): Decimal {
  if (value === undefined || value === null || value === '') return new Decimal(0)
  return new Decimal(value)
}

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/

export function isDecimalString(value: string): boolean {
  return DECIMAL_PATTERN.test(value)
}

// Broker statements are usually copied with thousand separators, e.g. "1,234.50".
export function parseDecimalInput(raw: string): string | null {
  const cleaned = raw.replace(/[,\s]/g, '')
  if (!isDecimalString(cleaned)) return null
  return new Decimal(cleaned).toString()
}

export function sumBy<T>(items: readonly T[], pick: (item: T) => Decimal): Decimal {
  return items.reduce((total, item) => total.plus(pick(item)), new Decimal(0))
}

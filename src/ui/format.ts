import { D, type Decimal } from '../domain/decimal'

type Value = Decimal | string | null | undefined

const MINUS = '−'
const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

const formats = new Map<string, Intl.NumberFormat>()

function numberFormat(minDigits: number, maxDigits: number): Intl.NumberFormat {
  const key = `${minDigits}:${maxDigits}`
  let cached = formats.get(key)
  if (!cached) {
    cached = new Intl.NumberFormat('th-TH', { minimumFractionDigits: minDigits, maximumFractionDigits: maxDigits })
    formats.set(key, cached)
  }
  return cached
}

// The sign comes from the rounded value, so −0.004 shown with two digits reads "0.00", not "−0.00".
function parts(value: Decimal, minDigits: number, maxDigits: number, plus = false): [sign: string, digits: string] {
  const rounded = value.toDecimalPlaces(maxDigits)
  const sign = rounded.lessThan(0) ? MINUS : plus && rounded.greaterThan(0) ? '+' : ''
  return [sign, numberFormat(minDigits, maxDigits).format(rounded.abs().toNumber())]
}

function format(value: Decimal, minDigits: number, maxDigits: number, plus = false): string {
  return parts(value, minDigits, maxDigits, plus).join('')
}

function isEmpty(value: Value): value is null | undefined | '' {
  return value === null || value === undefined || value === ''
}

export function fmtNumber(value: Value, maxDigits = 2): string {
  return isEmpty(value) ? '—' : format(D(value), 0, maxDigits)
}

export function fmtMoney(value: Value, currency?: string): string {
  if (isEmpty(value)) return '—'
  const text = format(D(value), 2, 2)
  return currency ? `${text} ${currency}` : text
}

export function fmtSigned(value: Value, digits = 2): string {
  return isEmpty(value) ? '—' : format(D(value), digits, digits, true)
}

// Some crypto tokens cost a tiny fraction of a unit, so prices below one keep up to 8 decimals.
export function fmtPrice(value: Value): string {
  if (isEmpty(value)) return '—'
  const n = D(value)
  return format(n, 2, n.abs().lessThan(1) ? 8 : 4)
}

// Rates below one (JPY, VND and the like) would read as 0.00 with two decimals.
export function fmtRate(value: Value): string {
  if (isEmpty(value)) return '—'
  const n = D(value)
  return n.abs().lessThan(1) ? format(n, 4, 6) : format(n, 2, 2)
}

export function fmtValue(value: Value): string {
  return isEmpty(value) ? '—' : format(D(value), 0, 0)
}

export function fmtPct(value: Value): string {
  return isEmpty(value) ? '—' : `${fmtNumber(value, 2)}%`
}

export function plClass(value: Value): string {
  if (isEmpty(value)) return ''
  const n = D(value)
  return n.greaterThan(0) ? 'text-gain' : n.lessThan(0) ? 'text-loss' : ''
}

export function fmtHeadline(value: Value, currency: string): string {
  if (isEmpty(value)) return '—'
  const [sign, digits] = parts(D(value), 0, 0)
  return currency === 'THB' ? `${sign}฿${digits}` : `${sign}${digits} ${currency}`
}

// Broker statements use the Gregorian year, so the app does too; only tax years add the Buddhist year.
export function fmtDate(iso: string | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

export function fmtDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${fmtDate(iso)}`
}

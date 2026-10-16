import { D, type Decimal } from '../domain/decimal'

type Value = Decimal | string | null | undefined

const MINUS = '−'
const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

function fixed(digits: number) {
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

const money = fixed(2)
const whole = fixed(0)

function isEmpty(value: Value): value is null | undefined | '' {
  return value === null || value === undefined || value === ''
}

export function fmtNumber(value: Value, maxDigits = 2): string {
  if (isEmpty(value)) return '—'
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: maxDigits }).format(D(value).toNumber())
}

export function fmtMoney(value: Value, currency?: string): string {
  if (isEmpty(value)) return '—'
  const n = D(value)
  const text = `${n.lessThan(0) ? MINUS : ''}${money.format(n.abs().toNumber())}`
  return currency ? `${text} ${currency}` : text
}

export function fmtSigned(value: Value, digits = 2): string {
  if (isEmpty(value)) return '—'
  const n = D(value)
  const sign = n.greaterThan(0) ? '+' : n.lessThan(0) ? MINUS : ''
  return `${sign}${(digits === 2 ? money : fixed(digits)).format(n.abs().toNumber())}`
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
  const text = whole.format(D(value).toNumber())
  return currency === 'THB' ? `฿${text}` : `${text} ${currency}`
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

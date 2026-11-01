import { D, type Decimal } from '../domain/decimal'
import { t } from '../i18n'

type Value = Decimal | string | null | undefined

const MINUS = '−'
const WEEKDAYS = [t('อาทิตย์'), t('จันทร์'), t('อังคาร'), t('พุธ'), t('พฤหัสบดี'), t('ศุกร์'), t('เสาร์')]
const MONTHS = [t('ม.ค.'), t('ก.พ.'), t('มี.ค.'), t('เม.ย.'), t('พ.ค.'), t('มิ.ย.'), t('ก.ค.'), t('ส.ค.'), t('ก.ย.'), t('ต.ค.'), t('พ.ย.'), t('ธ.ค.')]

export const HIDDEN_NUMBER = '•••'

// The formatters are plain functions, not hooks, so the privacy switch reaches them through this store. Pages subscribe to it
// (useAppData does) and render again in place when it changes.
let numbersHidden = false
const listeners = new Set<() => void>()

export function setNumbersHidden(hidden: boolean): void {
  if (hidden === numbersHidden) return
  numbersHidden = hidden
  for (const listener of listeners) listener()
}

export function getNumbersHidden(): boolean {
  return numbersHidden
}

export function subscribeNumbersHidden(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

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
  if (isEmpty(value)) return '—'
  return numbersHidden ? HIDDEN_NUMBER : format(D(value), 0, maxDigits)
}

// An amount that was exchanged reads as the broker wrote it: whole numbers bare, anything else with both decimals.
export function fmtAmount(value: Value): string {
  if (isEmpty(value)) return '—'
  if (numbersHidden) return HIDDEN_NUMBER
  const rounded = D(value).toDecimalPlaces(2)
  return rounded.isInteger() ? format(rounded, 0, 0) : format(rounded, 2, 2)
}

export function currencyMark(base: string): string {
  return base === 'THB' ? t('฿') : base
}

export function fmtMoney(value: Value, currency?: string): string {
  if (isEmpty(value)) return '—'
  const text = numbersHidden ? HIDDEN_NUMBER : format(D(value), 2, 2)
  return currency ? `${text} ${currency}` : text
}

export function fmtSigned(value: Value, digits = 2): string {
  if (isEmpty(value)) return '—'
  return numbersHidden ? HIDDEN_NUMBER : format(D(value), digits, digits, true)
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
  if (isEmpty(value)) return '—'
  return numbersHidden ? HIDDEN_NUMBER : format(D(value), 0, 0)
}

// A number that is not an amount of money or a quantity held, such as a fee rate or an average price, which stays readable.
export function fmtPlain(value: Value, maxDigits = 2): string {
  return isEmpty(value) ? '—' : format(D(value), 0, maxDigits)
}

// A ratio such as the profit factor says nothing about how much money there is, so it stays visible.
export function fmtRatio(value: Value): string {
  return isEmpty(value) ? '—' : format(D(value), 2, 2)
}

export function fmtPct(value: Value, digits = 2, minDigits = 0): string {
  return isEmpty(value) ? '—' : `${format(D(value), minDigits, digits)}%`
}

export function fmtSignedPct(value: Value, digits = 1): string {
  return isEmpty(value) ? '—' : `${format(D(value), digits, digits, true)}%`
}

// No income in the last twelve months reads as "—" like in the mocks, not as a misleading "0%"; the mocks
// always show one decimal so a column of yields lines up ("3.0%", "0.9%").
export function fmtYield(value: Value): string {
  return isEmpty(value) || D(value).isZero() ? '—' : `${format(D(value), 1, 1)}%`
}

export function plClass(value: Value): string {
  if (isEmpty(value)) return ''
  const n = D(value)
  return n.greaterThan(0) ? 'text-gain' : n.lessThan(0) ? 'text-loss' : ''
}

export function fmtHeadline(value: Value, currency: string): string {
  if (isEmpty(value)) return '—'
  const [sign, digits] = numbersHidden ? ['', HIDDEN_NUMBER] : parts(D(value), 0, 0)
  return currency === 'THB' ? t('{0}฿{1}', sign, digits) : `${sign}${digits} ${currency}`
}

// Broker statements use the Gregorian year, so the app does too; only tax years add the Buddhist year.
export function fmtDate(iso: string | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

// Month keys are YYYY-MM.
export function fmtMonth(key: string, withYear = false): string {
  const [y, m] = key.split('-').map(Number)
  return withYear ? `${MONTHS[m - 1]} ${y}` : MONTHS[m - 1]
}

export function fmtDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${fmtDate(iso)}`
}

// A time of today only needs the clock; an older one carries its date too, in the device's own time zone.
export function fmtWhen(iso: string, today: string): string {
  const at = new Date(iso)
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  const [y, m, d] = [at.getFullYear(), at.getMonth() + 1, at.getDate()]
  const day = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return day === today ? time : `${fmtDate(day)} ${time}`
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

// Filings run to hundreds of billions; 416.2B reads at a glance where a full figure would not fit a phone.
export function fmtCompact(value: string | null): string {
  return value === null ? '—' : compact.format(Number(value)).replace('-', '−')
}

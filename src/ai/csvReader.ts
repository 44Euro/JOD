import { isIsoDate } from '../domain/dates'
import { D, parseDecimalInput } from '../domain/decimal'
import { t } from '../i18n'
import type { Extraction, ExtractedRow, RowField, RowKind } from './extraction'

type Column = 'date' | 'symbol' | 'side' | 'quantity' | 'price' | 'amount' | 'fees' | 'tax' | 'currency' | 'lastPrice' | 'name'

// Header names seen in Thai and foreign broker exports, matched after lower-casing and dropping spaces and dots.
const HEADERS: Record<Column, string[]> = {
  date: ['date', 'tradedate', 'transactiondate', 'executiondate', 'วันที่', 'วันที่ทำรายการ', 'วันที่ซื้อขาย', 'วันที่ทำการซื้อขาย'],
  symbol: ['symbol', 'ticker', 'stock', 'code', 'instrument', 'security', 'asset', 'coin', 'หลักทรัพย์', 'ชื่อหลักทรัพย์', 'หุ้น', 'ชื่อหุ้น', 'สัญลักษณ์'],
  side: ['side', 'action', 'type', 'transactiontype', 'buy/sell', 'b/s', 'ประเภท', 'ประเภทรายการ', 'ซื้อ/ขาย', 'รายการ'],
  quantity: ['quantity', 'qty', 'shares', 'units', 'volume', 'amountofshares', 'จำนวน', 'จำนวนหุ้น', 'จำนวนหน่วย', 'ปริมาณ'],
  price: ['price', 'avgprice', 'averageprice', 'avgcost', 'averagecost', 'costperunit', 'executedprice', 'ราคา', 'ราคาเฉลี่ย', 'ต้นทุนเฉลี่ย', 'ราคาที่ได้', 'ราคาต่อหน่วย'],
  amount: ['amount', 'netamount', 'total', 'value', 'grossamount', 'มูลค่า', 'จำนวนเงิน', 'มูลค่ารวม', 'ยอดเงิน'],
  fees: ['fee', 'fees', 'commission', 'brokerage', 'ค่าธรรมเนียม', 'ค่าคอม', 'ค่าคอมมิชชั่น'],
  tax: ['tax', 'vat', 'withholdingtax', 'wht', 'ภาษี', 'ภาษีหัก', 'ภาษีมูลค่าเพิ่ม'],
  currency: ['currency', 'ccy', 'สกุลเงิน', 'สกุล'],
  lastPrice: ['marketprice', 'lastprice', 'currentprice', 'ราคาตลาด', 'ราคาล่าสุด', 'ราคาปัจจุบัน'],
  name: ['name', 'description', 'ชื่อ'],
}

const KINDS: [RegExp, RowKind][] = [
  [/^(buy|b|bought|ซื้อ)$/, 'buy'],
  [/^(sell|s|sold|ขาย)$/, 'sell'],
  [/(dividend|^div$|ปันผล)/, 'dividend'],
  [/(interest|ดอกเบี้ย)/, 'interest'],
]

function key(header: string): string {
  return header.toLowerCase().replace(/[\s._-]/g, '')
}

export function splitCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = [',', '\t', ';'].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ',')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell)
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  row.push(cell)
  if (row.some((c) => c.trim() !== '')) rows.push(row)
  return rows.map((r) => r.map((c) => c.replace(/^﻿/, '').trim()))
}

// A two-digit year from 40 to 99 can only be a Buddhist one in a journal kept today (2540–2599 is 1997–2056), and
// one below 40 a Gregorian one, so 15/10/67 is 2024 and 15/10/24 is 2024 too.
function fullYear(raw: string): number {
  const year = Number(raw)
  if (raw.length <= 2) return year >= 40 ? 2500 + year - 543 : 2000 + year
  return year > 2400 ? year - 543 : year
}

// Returns the date and whether day and month could be told apart. Slash dates are read day first, as Thai brokers
// write them, unless the numbers only work month first.
export function parseLooseDate(raw: string): { date: string | null; sure: boolean } {
  const text = raw.trim().split(/[\sT]/)[0]
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  if (iso) {
    const date = `${fullYear(iso[1])}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
    return isIsoDate(date) ? { date, sure: true } : { date: null, sure: false }
  }
  const parts = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text)
  if (!parts) return { date: null, sure: false }
  const [a, b] = [Number(parts[1]), Number(parts[2])]
  const year = fullYear(parts[3])
  const [day, month] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b]
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return isIsoDate(date) ? { date, sure: a > 12 || b > 12 || a === b } : { date: null, sure: false }
}

// Exports write money as "$1,234.50", "1 234.50 THB" or "(12.00)" for a charge; only the size is kept, since the
// row's kind already says which way the money went.
export function parseLooseNumber(raw: string): string | null {
  const cleaned = raw.replace(/[()฿$€£¥]/g, '').replace(/\b[A-Z]{3}\b/g, '').replace(/^\+/, '').trim()
  if (!cleaned) return null
  const parsed = parseDecimalInput(cleaned.replace(/\s/g, ''))
  return parsed === null ? null : D(parsed).abs().toString()
}

function kindOf(raw: string): RowKind | null {
  const text = raw.trim().toLowerCase()
  return KINDS.find(([pattern]) => pattern.test(text))?.[1] ?? null
}

export function findColumns(header: readonly string[]): Partial<Record<Column, number>> {
  const columns: Partial<Record<Column, number>> = {}
  header.forEach((cell, index) => {
    const k = key(cell)
    const column = (Object.keys(HEADERS) as Column[]).find((c) => columns[c] === undefined && HEADERS[c].includes(k))
    if (column) columns[column] = index
  })
  return columns
}

const SKIPPED = t('ข้ามบางแถวที่ไม่รู้ว่าเป็นซื้อ ขาย หรือปันผล')

// Reads a broker export without any AI: columns are found by their header, so the numbers come out exactly as the
// file has them. A file with dates is a list of orders; one without is a list of holdings.
export function readCsv(text: string): Extraction {
  const [header = [], ...body] = splitCsv(text)
  const columns = findColumns(header)
  const problems: string[] = []
  if (columns.symbol === undefined && columns.side === undefined) {
    return { source: 'other', rows: [], statedTotal: null, statedTotalCurrency: null, costIncludesFees: null, problems: [t('ไม่พบคอลัมน์ชื่อหลักทรัพย์ในไฟล์ ลองให้ Claude อ่านแทน หรือกรอกเอง')] }
  }
  const holdings = columns.date === undefined
  const cell = (row: string[], column: Column) => (columns[column] === undefined ? '' : (row[columns[column]!] ?? ''))
  const rows: ExtractedRow[] = []
  for (const line of body) {
    const kind = holdings ? 'opening' : columns.side === undefined ? 'buy' : kindOf(cell(line, 'side'))
    if (!kind) {
      if (!problems.includes(SKIPPED)) problems.push(SKIPPED)
      continue
    }
    const uncertain = new Set<RowField>()
    if (!holdings && columns.side === undefined) uncertain.add('quantity')
    const number = (column: Column & RowField) => {
      const raw = cell(line, column)
      const value = parseLooseNumber(raw)
      if (raw && value === null) uncertain.add(column)
      return value
    }
    let date: string | null = null
    if (!holdings) {
      const parsed = parseLooseDate(cell(line, 'date'))
      date = parsed.date
      if (!parsed.sure) uncertain.add('date')
    }
    const symbol = cell(line, 'symbol').toUpperCase() || null
    if (!symbol && kind !== 'interest') continue
    rows.push({
      kind,
      market: symbol && /^[A-Z]{2,}\d{2}$/.test(symbol) ? 'SET' : null,
      symbol,
      name: cell(line, 'name'),
      date,
      quantity: number('quantity'),
      price: number('price'),
      amount: number('amount'),
      fees: number('fees'),
      tax: number('tax'),
      currency: cell(line, 'currency').toUpperCase() || null,
      lastPrice: number('lastPrice'),
      uncertain: [...uncertain],
      note: '',
    })
  }
  if (!holdings && columns.side === undefined && rows.length > 0) problems.push(t('ไฟล์ไม่บอกว่าซื้อหรือขาย แอปตั้งเป็นซื้อไว้ ตรวจทุกแถว'))
  return { source: holdings ? 'portfolio' : 'orders', rows, statedTotal: null, statedTotalCurrency: null, costIncludesFees: null, problems }
}

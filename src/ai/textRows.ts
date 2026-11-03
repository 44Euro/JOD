import { D } from '../domain/decimal'
import { parseLooseDate, parseLooseNumber } from './csvReader'
import { t } from '../i18n'
import type { Extraction, ExtractedRow, RowKind } from './extraction'

const CURRENCIES = new Set(['THB', 'USD', 'USDT', 'USDC', 'HKD', 'JPY', 'SGD', 'CNY', 'EUR', 'GBP'])
const NOT_SYMBOLS = new Set(['BUY', 'SELL', 'TOTAL', 'AVG', 'COST', 'QTY', 'PRICE', 'VALUE', 'MARKET', 'P/L', 'PL', 'DATE', 'FEE', 'VAT', 'TAX', 'NET'])

export const OCR_NOTE = t('อ่านในเครื่อง ตัวเลขทุกช่องถูกทำเครื่องหมายไว้ ตรวจกับรูปก่อนบันทึก')

function symbolIn(tokens: readonly string[]): string | null {
  for (const token of tokens) {
    const word = token.replace(/[^A-Za-z0-9.]/g, '')
    if (/^[A-Z][A-Z0-9.]{0,9}$/.test(word) && !CURRENCIES.has(word) && !NOT_SYMBOLS.has(word)) return word
  }
  return null
}

function kindIn(line: string, dated: boolean): RowKind {
  const text = line.toLowerCase()
  if (/(^|\s)(sell|sold)(\s|$)|ขาย/.test(text)) return 'sell'
  if (/dividend|ปันผล/.test(text)) return 'dividend'
  if (/interest|ดอกเบี้ย/.test(text)) return 'interest'
  if (/(^|\s)(buy|bought)(\s|$)|ซื้อ/.test(text)) return 'buy'
  return dated ? 'buy' : 'opening'
}

interface Parsed {
  symbol: string | null
  date: string | null
  numbers: string[]
  // A signed amount in brackets, which Dime prints as a holding's profit.
  profit: string | null
  line: string
}

function parseLine(line: string): Parsed {
  const tokens = line.split(/\s+/).filter(Boolean)
  let date: string | null = null
  const numbers: string[] = []
  for (const token of tokens) {
    const asDate = /\d[/.-]\d/.test(token) && !/^\d+\.\d+$/.test(token) ? parseLooseDate(token).date : null
    if (asDate) {
      date ??= asDate
      continue
    }
    // Percent changes, signed day changes and bracketed profits are not quantities or prices.
    if (/%$/.test(token) || /^\(?[+−-]\d/.test(token)) continue
    const value = /\d/.test(token) && !/[A-Za-z]{2}\d|^[A-Z]+$/.test(token) ? parseLooseNumber(token) : null
    if (value !== null) numbers.push(value)
  }
  const profit = /\(\s*([+−-])\s*(\d[\d,]*(?:\.\d+)?)/.exec(line)
  return { symbol: symbolIn(tokens), date, numbers, profit: profit && `${profit[1] === '+' ? '' : '-'}${profit[2].replace(/,/g, '')}`, line }
}

function blankRow(kind: RowKind, symbol: string): ExtractedRow {
  return {
    kind,
    market: /^[A-Z]{2,}\d{2}$/.test(symbol) ? 'SET' : null,
    symbol,
    name: '',
    date: null,
    quantity: null,
    price: null,
    amount: null,
    fees: null,
    tax: null,
    currency: null,
    lastPrice: null,
    value: null,
    uncertain: [],
    note: '',
  }
}

const positive = (value: string | undefined) => value !== undefined && D(value).gt(0)

// Turns OCR or PDF text into rows. Screens put the figures in a fixed order (quantity, then average cost or price, then
// the latest price), and a phone often wraps the figures onto the line under the symbol, so such a pair is read as one.
// Dime's list shows a value with the profit in brackets on the next line instead, and an opened holding labels its
// units and price on one line and its average and total cost further down. Nothing here is certain, so every figure
// is marked for checking.
export function rowsFromLines(lines: readonly string[]): Extraction {
  const parsed = lines.map((l) => l.trim()).filter(Boolean).map(parseLine)
  const rows: ExtractedRow[] = []
  const bare = new Set<ExtractedRow>()
  let holder: string | null = null
  for (let i = 0; i < parsed.length; i += 1) {
    let current = parsed[i]
    const next = parsed[i + 1]
    if (current.symbol) holder = current.symbol
    // OCR spaces out Thai letters and splits ำ into its two marks.
    else if (holder && /จำนวนหุ้น/.test(current.line.replace(/\s/g, '').replace(/\u0e4d\u0e32/g, 'ำ'))) {
      const found: number[] = []
      for (let j = i + 1; j < parsed.length && !parsed[j].symbol && found.length < 2; j += 1) if (parsed[j].numbers.length >= 2) found.push(j)
      if (found.length < 2) continue
      const [units, price] = parsed[found[0]].numbers
      const [average] = parsed[found[1]].numbers
      if (rows.at(-1)?.symbol === holder) rows.pop()
      if (positive(units) && positive(average)) {
        rows.push({ ...blankRow('opening', holder), quantity: units, price: average, lastPrice: price, uncertain: ['quantity', 'price', 'lastPrice'] })
      }
      i = found[1]
      continue
    }
    // The up arrow beside a gain is often read as a 7 after the value.
    const lone = current.numbers.length === 1 || (current.numbers.length === 2 && /^\d$/.test(current.numbers[1]))
    const profitAt = [i + 1, i + 2].find((j) => parsed[j]?.profit && parsed.slice(i + 1, j + 1).every((p) => !p.symbol))
    if (current.symbol && lone && profitAt !== undefined) {
      const value = current.numbers[0]
      const cost = D(value).minus(parsed[profitAt].profit!)
      if (cost.gt(0)) {
        rows.push({ ...blankRow('opening', current.symbol), value, amount: cost.toString(), uncertain: ['amount', 'value'] })
        i = profitAt
        continue
      }
    }
    if (current.symbol && current.numbers.length < 2 && next && !next.symbol && next.numbers.length >= 2) {
      current = { ...current, date: current.date ?? next.date, numbers: [...current.numbers, ...next.numbers], line: `${current.line} ${next.line}` }
      i += 1
    }
    if (!current.symbol) continue
    const kind = kindIn(current.line, current.date !== null)
    const units = kind === 'opening' || kind === 'buy' || kind === 'sell'
    if (units ? current.numbers.length < 2 : current.numbers.length < 1) continue
    const [first, second, third] = current.numbers
    // A stray mark read as a symbol tends to come with a 0 beside it.
    if (units && !(positive(first) && positive(second))) continue
    const lastPrice = kind === 'opening' ? (third ?? null) : null
    const row: ExtractedRow = {
      ...blankRow(kind, current.symbol),
      date: kind === 'opening' ? null : current.date,
      quantity: units ? first : null,
      price: units ? second : null,
      amount: units ? null : first,
      lastPrice,
      uncertain: units ? ['quantity', 'price', ...(kind === 'opening' ? (lastPrice ? (['lastPrice'] as const) : []) : (['date'] as const))] : ['amount', 'date'],
    }
    rows.push(row)
    bare.add(row)
  }
  // A screen keeps one layout, so on a screen of values a line of bare figures is a holding cut off at its edge.
  const kept = rows.some((r) => r.value !== null) ? rows.filter((r) => !bare.has(r)) : rows
  const dated = kept.some((r) => r.kind !== 'opening')
  return {
    source: dated ? 'orders' : 'portfolio',
    rows: kept,
    statedTotal: null,
    statedTotalCurrency: null,
    costIncludesFees: null,
    problems: kept.length > 0 ? [OCR_NOTE] : [t('อ่านรายการจากไฟล์นี้ไม่ได้ ลองรูปที่ชัดขึ้น ให้ Claude อ่าน หรือกรอกเอง')],
  }
}

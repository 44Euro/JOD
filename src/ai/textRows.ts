import { parseLooseDate, parseLooseNumber } from './csvReader'
import type { Extraction, ExtractedRow, RowKind } from './extraction'

const CURRENCIES = new Set(['THB', 'USD', 'USDT', 'USDC', 'HKD', 'JPY', 'SGD', 'CNY', 'EUR', 'GBP'])
const NOT_SYMBOLS = new Set(['BUY', 'SELL', 'TOTAL', 'AVG', 'COST', 'QTY', 'PRICE', 'VALUE', 'MARKET', 'P/L', 'PL', 'DATE', 'FEE', 'VAT', 'TAX', 'NET'])

export const OCR_NOTE = 'อ่านในเครื่อง ตัวเลขทุกช่องถูกทำเครื่องหมายไว้ ตรวจกับรูปก่อนบันทึก'

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
    // Percent changes and signed day changes are not quantities or prices.
    if (/%$/.test(token) || /^[+−-]\d/.test(token)) continue
    const value = /\d/.test(token) && !/[A-Za-z]{2}\d|^[A-Z]+$/.test(token) ? parseLooseNumber(token) : null
    if (value !== null) numbers.push(value)
  }
  return { symbol: symbolIn(tokens), date, numbers, line }
}

// Turns OCR or PDF text into rows. Screens put the figures in a fixed order (quantity, then average cost or price, then
// the latest price), and a phone often wraps the figures onto the line under the symbol, so such a pair is read as one.
// Nothing here is certain, so every figure is marked for checking.
export function rowsFromLines(lines: readonly string[]): Extraction {
  const parsed = lines.map((l) => l.trim()).filter(Boolean).map(parseLine)
  const rows: ExtractedRow[] = []
  for (let i = 0; i < parsed.length; i += 1) {
    let current = parsed[i]
    const next = parsed[i + 1]
    if (current.symbol && current.numbers.length < 2 && next && !next.symbol && next.numbers.length >= 2) {
      current = { symbol: current.symbol, date: current.date ?? next.date, numbers: [...current.numbers, ...next.numbers], line: `${current.line} ${next.line}` }
      i += 1
    }
    if (!current.symbol) continue
    const kind = kindIn(current.line, current.date !== null)
    const units = kind === 'opening' || kind === 'buy' || kind === 'sell'
    if (units ? current.numbers.length < 2 : current.numbers.length < 1) continue
    const [first, second, third] = current.numbers
    rows.push({
      kind,
      market: /^[A-Z]{2,}\d{2}$/.test(current.symbol) ? 'SET' : null,
      symbol: current.symbol,
      name: '',
      date: kind === 'opening' ? null : current.date,
      quantity: units ? first : null,
      price: units ? second : null,
      amount: units ? null : first,
      fees: null,
      tax: null,
      currency: null,
      lastPrice: kind === 'opening' ? (third ?? null) : null,
      uncertain: units ? ['quantity', 'price', ...(kind === 'opening' ? [] : (['date'] as const))] : ['amount', 'date'],
      note: '',
    })
  }
  const dated = rows.some((r) => r.kind !== 'opening')
  return {
    source: dated ? 'orders' : 'portfolio',
    rows,
    statedTotal: null,
    statedTotalCurrency: null,
    costIncludesFees: null,
    problems: rows.length > 0 ? [OCR_NOTE] : ['อ่านรายการจากไฟล์นี้ไม่ได้ ลองรูปที่ชัดขึ้น ให้ Claude อ่าน หรือกรอกเอง'],
  }
}

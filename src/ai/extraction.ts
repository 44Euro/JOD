import { isIsoDate } from '../domain/dates'
import { parseDecimalInput } from '../domain/decimal'
import { IMPORT_SOURCES, MARKETS, type ImportSource, type Market } from '../domain/types'
import { t } from '../i18n'

export const ROW_KINDS = ['opening', 'buy', 'sell', 'dividend', 'interest'] as const
export type RowKind = (typeof ROW_KINDS)[number]

export const ROW_FIELDS = ['market', 'symbol', 'date', 'quantity', 'price', 'amount', 'fees', 'tax', 'currency', 'lastPrice'] as const
export type RowField = (typeof ROW_FIELDS)[number]

const DECIMAL_FIELDS = ['quantity', 'price', 'amount', 'fees', 'tax', 'lastPrice'] as const

export interface ExtractedRow {
  kind: RowKind
  market: Market | null
  symbol: string | null
  name: string
  date: string | null
  quantity: string | null
  price: string | null
  amount: string | null
  fees: string | null
  tax: string | null
  currency: string | null
  lastPrice: string | null
  uncertain: RowField[]
  note: string
}

export interface Extraction {
  source: ImportSource
  rows: ExtractedRow[]
  statedTotal: string | null
  statedTotalCurrency: string | null
  costIncludesFees: boolean | null
  problems: string[]
}

const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] })
const text = { type: 'string' }

export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['source', 'rows', 'statedTotal', 'statedTotalCurrency', 'costIncludesFees', 'problems'],
  properties: {
    source: { type: 'string', enum: [...IMPORT_SOURCES] },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', ...ROW_FIELDS, 'name', 'uncertain', 'note'],
        properties: {
          kind: { type: 'string', enum: [...ROW_KINDS] },
          market: nullable({ type: 'string', enum: [...MARKETS] }),
          symbol: nullable(text),
          name: text,
          date: nullable(text),
          quantity: nullable(text),
          price: nullable(text),
          amount: nullable(text),
          fees: nullable(text),
          tax: nullable(text),
          currency: nullable(text),
          lastPrice: nullable(text),
          uncertain: { type: 'array', items: { type: 'string', enum: [...ROW_FIELDS] } },
          note: text,
        },
      },
    },
    statedTotal: nullable(text),
    statedTotalCurrency: nullable(text),
    costIncludesFees: nullable({ type: 'boolean' }),
    problems: { type: 'array', items: text },
  },
} as const

export function extractionPrompt(today: string): string {
  return `You read screenshots, statements and exported files from investment brokers for a Thai investment journal.
Today is ${today}. Return every holding or transaction you can see as one row.

Kinds of row:
- opening: a holding shown on a portfolio screen (symbol, quantity, average cost as price, latest price as lastPrice). Its date is null.
- buy / sell: an executed order or trade confirmation (date, quantity, price per unit, fees, tax).
- dividend / interest: cash received (date, amount before tax, tax withheld).

Rules:
- Numbers are plain decimal strings with "." as the decimal point and no thousand separators, e.g. "1234.50". Fees and tax are positive.
- Never guess a number. When a digit or a value is unreadable, set it to null, add the field to "uncertain" and say what is wrong in "note" in Thai.
- Also list in "uncertain" any field you read but are not sure of.
- Dates are YYYY-MM-DD in the Gregorian calendar. Thai brokers write Buddhist-era years (15/10/67 or 15/10/2567 is 2024-10-15): subtract 543. US brokers write month/day/year.
- market is one of ${MARKETS.join(', ')}. Thai shares and Thai DRs such as AAPL80 or NVDA19 are SET. Thai mutual funds are FUND. Coins are CRYPTO.
- currency is the ISO code the amounts are in (THB, USD, USDT and so on).
- statedTotal is the total the source itself prints for the rows you returned (total cost of the holdings, or the total of the orders), as a decimal string, or null if none is printed.
- costIncludesFees: for a portfolio screen, whether its average cost includes commission when the screen says so, otherwise null.
- problems: short Thai sentences about anything the user must check, such as cut-off rows or a file that is not from a broker.
- Leave out account numbers and personal names.`
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

// Buddhist-era years are 543 ahead; the model is told to convert them, and a year it left as is gets converted here.
export function normaliseDate(raw: string | null): string | null {
  if (!raw) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!match) return null
  const year = Number(match[1])
  const iso = `${year > 2400 ? year - 543 : year}-${match[2]}-${match[3]}`
  return isIsoDate(iso) ? iso : null
}

function parseRow(value: unknown): ExtractedRow | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (!ROW_KINDS.includes(raw.kind as RowKind)) return null
  const uncertain = new Set(
    Array.isArray(raw.uncertain) ? raw.uncertain.filter((f): f is RowField => ROW_FIELDS.includes(f as RowField)) : [],
  )
  const row: ExtractedRow = {
    kind: raw.kind as RowKind,
    market: MARKETS.includes(raw.market as Market) ? (raw.market as Market) : null,
    symbol: stringOrNull(raw.symbol)?.toUpperCase() ?? null,
    name: stringOrNull(raw.name) ?? '',
    date: null,
    quantity: null,
    price: null,
    amount: null,
    fees: null,
    tax: null,
    currency: stringOrNull(raw.currency)?.toUpperCase() ?? null,
    lastPrice: null,
    uncertain: [],
    note: stringOrNull(raw.note) ?? '',
  }
  const date = stringOrNull(raw.date)
  row.date = normaliseDate(date)
  if (date && !row.date) uncertain.add('date')
  for (const field of DECIMAL_FIELDS) {
    const rawValue = stringOrNull(raw[field])
    const parsed = rawValue === null ? null : parseDecimalInput(rawValue)
    if (rawValue !== null && parsed === null) uncertain.add(field)
    row[field] = parsed
  }
  row.uncertain = ROW_FIELDS.filter((f) => uncertain.has(f))
  return row
}

export class ExtractionError extends Error {
  name = 'ExtractionError'
}

export function parseExtraction(json: unknown): Extraction {
  if (typeof json !== 'object' || json === null) throw new ExtractionError(t('AI ตอบกลับมาในรูปแบบที่อ่านไม่ได้'))
  const raw = json as Record<string, unknown>
  if (!Array.isArray(raw.rows)) throw new ExtractionError(t('AI ตอบกลับมาในรูปแบบที่อ่านไม่ได้'))
  const rows = raw.rows.map(parseRow).filter((row): row is ExtractedRow => row !== null)
  const total = stringOrNull(raw.statedTotal)
  return {
    source: IMPORT_SOURCES.includes(raw.source as ImportSource) ? (raw.source as ImportSource) : 'other',
    rows,
    statedTotal: total === null ? null : parseDecimalInput(total),
    statedTotalCurrency: stringOrNull(raw.statedTotalCurrency)?.toUpperCase() ?? null,
    costIncludesFees: typeof raw.costIncludesFees === 'boolean' ? raw.costIncludesFees : null,
    problems: Array.isArray(raw.problems) ? raw.problems.filter((p): p is string => typeof p === 'string' && p.trim() !== '') : [],
  }
}

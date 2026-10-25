import type { Extraction, RowField, RowKind } from '../ai/extraction'
import { MARKET_CURRENCY } from '../domain/currencies'
import { D, Decimal, parseDecimalInput } from '../domain/decimal'
import { computeLedger } from '../domain/ledger'
import { instrumentKey, type AssetType, type FxSource, type Instrument, type Market, type Transaction } from '../domain/types'
import { validateSymbol } from '../domain/validation'
import { fmtDate } from './format'
import { TX_TYPE_LABELS } from './labels'
import { issueText } from './transactionText'

// Every value is the text in its input, so the review can hold half-typed numbers.
export interface ReviewRow {
  key: string
  include: boolean
  kind: RowKind
  market: Market
  symbol: string
  name: string
  date: string
  quantity: string
  price: string
  amount: string
  fees: string
  tax: string
  currency: string
  lastPrice: string
  fxRate: string
  fxSource: FxSource
  uncertain: RowField[]
  note: string
  duplicate: string
}

export interface OpeningRate {
  rate: string
  source: 'manual' | 'estimated'
}

export interface ReviewContext {
  accountId: string
  baseCurrency: string
  transactions: readonly Transaction[]
  instruments: readonly Instrument[]
}

export function usesUnits(kind: RowKind): boolean {
  return kind === 'opening' || kind === 'buy' || kind === 'sell'
}

export function needsSymbol(kind: RowKind): boolean {
  return kind !== 'interest'
}

function guessMarket(currency: string | null): Market {
  if (currency === 'THB') return 'SET'
  if (currency === 'USDT' || currency === 'USDC') return 'CRYPTO'
  return 'US'
}

export function instrumentIdOf(row: Pick<ReviewRow, 'kind' | 'market' | 'symbol'>): string | undefined {
  return needsSymbol(row.kind) && row.symbol.trim() ? instrumentKey(row.market, row.symbol) : undefined
}

// Typed numbers may carry thousand separators, as the form allows.
const num = (value: string): string | null => (value.trim() ? parseDecimalInput(value) : null)

const sameNumber = (a: string | undefined, b: string) => {
  const typed = num(b)
  return a !== undefined && typed !== null && D(a).eq(typed)
}

// A record already in the account that this row probably repeats, described the way the review shows it. A holding
// from a portfolio screen repeats any buy or carried-in holding of the same asset, since those already count it.
export function findDuplicate(row: ReviewRow, ctx: ReviewContext): string {
  const instrumentId = instrumentIdOf(row)
  const mine = ctx.transactions.filter((tx) => tx.accountId === ctx.accountId)
  const match =
    row.kind === 'opening'
      ? mine
          .filter((tx) => tx.instrumentId === instrumentId && (tx.type === 'buy' || tx.type === 'opening'))
          .sort((a, b) => a.date.localeCompare(b.date))[0]
      : mine.find(
          (tx) =>
            tx.type === row.kind &&
            tx.date === row.date &&
            (row.kind === 'interest' ? tx.currency === row.currency : tx.instrumentId === instrumentId) &&
            (usesUnits(row.kind) ? sameNumber(tx.quantity, row.quantity) : sameNumber(tx.amount, row.amount)),
        )
  return match ? `อาจซ้ำกับรายการ${TX_TYPE_LABELS[match.type]} ${fmtDate(match.date)} ที่มีอยู่แล้ว` : ''
}

export function toReviewRows(extraction: Extraction, ctx: ReviewContext): ReviewRow[] {
  return extraction.rows.map((raw, index) => {
    const uncertain = new Set(raw.uncertain)
    const market = raw.market ?? guessMarket(raw.currency)
    if (!raw.market) uncertain.add('market')
    const known = raw.symbol ? ctx.instruments.find((i) => i.id === instrumentKey(market, raw.symbol!)) : undefined
    const currency = raw.currency ?? known?.currency ?? MARKET_CURRENCY[market]
    if (!raw.currency) uncertain.add('currency')
    const row: ReviewRow = {
      key: `row-${index}`,
      include: true,
      kind: raw.kind,
      market,
      symbol: raw.symbol ?? '',
      name: raw.name,
      date: raw.kind === 'opening' ? '' : (raw.date ?? ''),
      quantity: raw.quantity ?? '',
      price: raw.price ?? '',
      amount: raw.amount ?? '',
      fees: raw.fees ?? '',
      tax: raw.tax ?? '',
      currency,
      lastPrice: raw.lastPrice ?? '',
      fxRate: currency === ctx.baseCurrency ? '1' : '',
      fxSource: currency === ctx.baseCurrency ? 'same' : 'auto',
      uncertain: [...uncertain],
      note: raw.note,
      duplicate: '',
    }
    row.duplicate = findDuplicate(row, ctx)
    row.include = !row.duplicate
    return row
  })
}

const positive = (value: string) => {
  const parsed = num(value)
  return parsed !== null && D(parsed).gt(0)
}
const notNegative = (value: string) => {
  const parsed = num(value)
  return value.trim() === '' || (parsed !== null && !D(parsed).isNegative())
}

// What still has to be filled in before the row can be written. A holding takes its rate from the shared opening
// rate of its currency, so only the other rows need a rate of their own.
export function rowProblems(row: ReviewRow, baseCurrency: string): string[] {
  const problems: string[] = []
  if (needsSymbol(row.kind)) problems.push(...validateSymbol(row.symbol))
  if (row.kind !== 'opening' && !row.date) problems.push('ใส่วันที่')
  if (usesUnits(row.kind)) {
    if (!positive(row.quantity)) problems.push('จำนวนต้องมากกว่า 0')
    if (!positive(row.price)) problems.push(row.kind === 'opening' ? 'ใส่ทุนเฉลี่ย' : 'ใส่ราคา')
  } else if (!positive(row.amount)) problems.push('ใส่จำนวนเงิน')
  if (!notNegative(row.fees) || !notNegative(row.tax)) problems.push('ค่าธรรมเนียมและภาษีต้องไม่ติดลบ')
  if (!/^[A-Z]{3,5}$/.test(row.currency)) problems.push('ใส่สกุลเงิน')
  if (row.kind !== 'opening' && row.currency !== baseCurrency && !positive(row.fxRate)) problems.push('ใส่เรท')
  return problems
}

// The value each row stands for in the source: cost for holdings and orders, cash for income.
export function rowValue(row: ReviewRow): Decimal | null {
  if (usesUnits(row.kind)) return positive(row.quantity) && positive(row.price) ? D(num(row.quantity)).times(D(num(row.price))) : null
  return positive(row.amount) ? D(num(row.amount)) : null
}

export type TotalCheck = { state: 'none' } | { state: 'match' | 'mismatch'; stated: Decimal; counted: Decimal; currency: string }

// Average costs are rounded on screen, so the sum may miss the printed total by a little; half a percent covers that.
export function checkTotal(rows: readonly ReviewRow[], extraction: Pick<Extraction, 'statedTotal' | 'statedTotalCurrency'>): TotalCheck {
  if (!extraction.statedTotal || rows.length === 0) return { state: 'none' }
  const currency = extraction.statedTotalCurrency ?? rows[0].currency
  const counted = rows.filter((r) => r.currency === currency).reduce((sum, r) => sum.plus(rowValue(r) ?? 0), D(0))
  const stated = D(extraction.statedTotal)
  const tolerance = Decimal.max(D('0.01'), stated.abs().times('0.005'))
  return { state: counted.minus(stated).abs().lte(tolerance) ? 'match' : 'mismatch', stated, counted, currency }
}

export function guessAssetType(market: Market, symbol: string): AssetType {
  if (market === 'CRYPTO') return 'crypto'
  if (market === 'FUND') return 'fund'
  if (market === 'BOND') return 'bond'
  if (market === 'GOLD') return 'gold'
  // Thai DRs carry the issuer's number after the foreign symbol, e.g. AAPL80 or NVDA19.
  if (market === 'SET' && /^[A-Z]{2,}\d{2}$/.test(symbol)) return 'dr'
  return 'stock'
}

export interface BuildContext extends ReviewContext {
  batchId: string
  openingDate: string
  openingRates: Readonly<Record<string, OpeningRate>>
  now: Date
  newId: () => string
}

export interface BuiltImport {
  transactions: Transaction[]
  instruments: Instrument[]
  prices: { id: string; price: string }[]
  errors: string[]
}

const orZero = (value: string) => num(value) ?? '0'

// Builds the records of the ticked rows. Like the form, it refuses anything the ledger would skip, so every record
// written counts.
export function buildImport(rows: readonly ReviewRow[], ctx: BuildContext): BuiltImport {
  const chosen = rows.filter((r) => r.include)
  const errors: string[] = []
  for (const row of chosen) {
    for (const problem of rowProblems(row, ctx.baseCurrency)) errors.push(`${row.symbol || TX_TYPE_LABELS[row.kind]}: ${problem}`)
  }
  const openingCurrencies = new Set(chosen.filter((r) => r.kind === 'opening' && r.currency !== ctx.baseCurrency).map((r) => r.currency))
  for (const currency of openingCurrencies) {
    if (!positive(ctx.openingRates[currency]?.rate ?? '')) errors.push(`ใส่เรทเฉลี่ยตอนซื้อของ ${currency}`)
  }
  if (chosen.some((r) => r.kind === 'opening') && !ctx.openingDate) errors.push('ใส่วันที่ของยอดยกมา')
  if (errors.length > 0) return { transactions: [], instruments: [], prices: [], errors: [...new Set(errors)] }

  const instruments = new Map<string, Instrument>()
  const transactions = chosen.map((row, index): Transaction => {
    const instrumentId = instrumentIdOf(row)
    if (instrumentId && !ctx.instruments.some((i) => i.id === instrumentId) && !instruments.has(instrumentId)) {
      const symbol = row.symbol.trim().toUpperCase()
      instruments.set(instrumentId, {
        id: instrumentId,
        market: row.market,
        symbol,
        name: row.name.trim() || symbol,
        assetType: guessAssetType(row.market, symbol),
        currency: row.currency,
      })
    }
    const isBase = row.currency === ctx.baseCurrency
    const opening = row.kind === 'opening' ? ctx.openingRates[row.currency] : undefined
    const fxRate = isBase ? '1' : (num(opening ? opening.rate : row.fxRate) as string)
    const fxSource: FxSource = isBase ? 'same' : opening ? opening.source : row.fxSource
    // Records are a millisecond apart so they keep the order the source listed them in.
    const createdAt = new Date(ctx.now.getTime() + index).toISOString()
    return {
      id: ctx.newId(),
      accountId: ctx.accountId,
      type: row.kind,
      date: row.kind === 'opening' ? ctx.openingDate : row.date,
      instrumentId,
      quantity: usesUnits(row.kind) ? (num(row.quantity) as string) : undefined,
      price: usesUnits(row.kind) ? (num(row.price) as string) : undefined,
      amount: usesUnits(row.kind) ? undefined : (num(row.amount) as string),
      currency: row.currency,
      fees: orZero(row.fees),
      tax: orZero(row.tax),
      fxRate,
      fxSource,
      referenceFxRate: fxSource === 'estimated' ? fxRate : undefined,
      importBatchId: ctx.batchId,
      note: row.note.trim(),
      createdAt,
      updatedAt: createdAt,
    }
  })
  const ids = new Set(transactions.map((t) => t.id))
  const ledgerErrors = computeLedger([...ctx.transactions, ...transactions])
    .issues.filter((issue) => ids.has(issue.txId))
    .map((issue) => {
      const row = chosen[transactions.findIndex((t) => t.id === issue.txId)]
      return `${row.symbol || TX_TYPE_LABELS[row.kind]}: ${issueText(issue)}`
    })
  if (ledgerErrors.length > 0) return { transactions: [], instruments: [], prices: [], errors: [...new Set(ledgerErrors)] }
  return { transactions, instruments: [...instruments.values()], prices: latestPrices(chosen), errors: [] }
}

// The latest price a portfolio screen shows for each asset, for the "update prices" choice.
export function latestPrices(rows: readonly ReviewRow[]): { id: string; price: string }[] {
  const prices = new Map<string, string>()
  for (const row of rows) {
    const id = instrumentIdOf(row)
    if (id && positive(row.lastPrice)) prices.set(id, num(row.lastPrice) as string)
  }
  return [...prices].map(([id, price]) => ({ id, price }))
}

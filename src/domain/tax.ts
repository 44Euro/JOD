import { addDays } from './dates'
import { D, Decimal } from './decimal'
import type { Ledger } from './ledger'
import { fifoByAccount } from './lots'
import type { Instrument, TaxFund, Transaction } from './types'

// Holding periods and deduction limits as the Revenue Department set them for purchases from 2024. They change with
// the law, so the report says which year's rules it uses and asks the user to check.
export const TAX_RULES_YEAR = 2024
export const TAX_FUND_RULES: Record<TaxFund, { years: number; pctOfIncome: number; cap: number; label: string }> = {
  SSF: { years: 10, pctOfIncome: 30, cap: 200_000, label: 'SSF' },
  RMF: { years: 5, pctOfIncome: 30, cap: 500_000, label: 'RMF' },
  THAIESG: { years: 5, pctOfIncome: 30, cap: 300_000, label: 'ThaiESG' },
}
// SSF, RMF, provident fund and other retirement savings together.
export const RETIREMENT_COMBINED_CAP = 500_000

export function taxFundOf(instrument: Pick<Instrument, 'taxFund' | 'symbol' | 'name' | 'assetType'>): TaxFund | null {
  if (instrument.taxFund) return instrument.taxFund
  if (instrument.assetType !== 'fund') return null
  const text = `${instrument.symbol} ${instrument.name}`.toUpperCase()
  if (/THAI ?ESG|TESG/.test(text)) return 'THAIESG'
  if (/SSF/.test(text)) return 'SSF'
  if (/RMF/.test(text)) return 'RMF'
  return null
}

function plusYears(date: string, years: number): string {
  const [y, m, d] = date.split('-').map(Number)
  // 29 February has no match in most years; the day after 28 February is the safe reading.
  return m === 2 && d === 29 ? addDays(`${y + years}-02-28`, 1) : `${y + years}${date.slice(4)}`
}

export interface FundLotStatus {
  instrumentId: string
  kind: TaxFund
  txId: string
  boughtOn: string
  quantity: Decimal
  freeFrom: string
}

export interface FundBreach {
  instrumentId: string
  kind: TaxFund
  saleTxId: string
  soldOn: string
  boughtOn: string
  quantity: Decimal
  freeFrom: string
}

// Units still held with the day they may be sold without losing the deduction, and sales that came too early, matched
// first in, first out as the fund houses count them. RMF's age-55 condition depends on the holder and is left to the user.
export function taxFundStatus(
  transactions: readonly Transaction[],
  instruments: readonly Instrument[],
): { lots: FundLotStatus[]; breaches: FundBreach[] } {
  const lots: FundLotStatus[] = []
  const breaches: FundBreach[] = []
  for (const instrument of instruments) {
    const kind = taxFundOf(instrument)
    if (!kind) continue
    const years = TAX_FUND_RULES[kind].years
    for (const result of fifoByAccount(transactions, instrument.id).values()) {
      for (const lot of result.lots) {
        lots.push({ instrumentId: instrument.id, kind, txId: lot.txId, boughtOn: lot.date, quantity: lot.quantity, freeFrom: plusYears(lot.date, years) })
      }
      for (const sale of result.sales) {
        for (const part of sale.from) {
          const freeFrom = plusYears(part.date, years)
          if (sale.date < freeFrom) {
            breaches.push({ instrumentId: instrument.id, kind, saleTxId: sale.txId, soldOn: sale.date, boughtOn: part.date, quantity: part.quantity, freeFrom })
          }
        }
      }
    }
  }
  return { lots: lots.sort((a, b) => a.freeFrom.localeCompare(b.freeFrom)), breaches }
}

export interface FundPurchases {
  kind: TaxFund
  boughtBase: Decimal
  // The deductible part given the year's income, or null when no income was entered.
  deductibleBase: Decimal | null
}

export function fundPurchases(
  year: number,
  transactions: readonly Transaction[],
  instruments: readonly Instrument[],
  income: Decimal | null,
): { rows: FundPurchases[]; retirementOverCap: boolean } {
  const kindOf = new Map(instruments.flatMap((i) => (taxFundOf(i) ? [[i.id, taxFundOf(i)!] as const] : [])))
  const bought = new Map<TaxFund, Decimal>()
  for (const tx of transactions) {
    const kind = tx.instrumentId ? kindOf.get(tx.instrumentId) : undefined
    if (!kind || tx.type !== 'buy' || !tx.date.startsWith(`${year}-`)) continue
    const cost = D(tx.quantity).times(D(tx.price)).plus(D(tx.fees)).times(tx.fxRate)
    bought.set(kind, (bought.get(kind) ?? D(0)).plus(cost))
  }
  const rows = [...bought].map(([kind, boughtBase]) => {
    const rule = TAX_FUND_RULES[kind]
    const limit = income ? Decimal.min(income.times(rule.pctOfIncome).div(100), rule.cap) : null
    return { kind, boughtBase, deductibleBase: limit ? Decimal.min(boughtBase, limit) : null }
  })
  const retirement = rows.filter((r) => r.kind !== 'THAIESG').reduce((s, r) => s.plus(r.deductibleBase ?? r.boughtBase), D(0))
  return { rows, retirementOverCap: retirement.gt(RETIREMENT_COMBINED_CAP) }
}

export interface IncomeLine {
  grossBase: Decimal
  taxBase: Decimal
  count: number
}

// Thai dividends and interest are paid in baht by Thai companies and funds, with tax withheld at source; anything in
// another currency is foreign income, which becomes taxable when brought into Thailand.
export function incomeForTax(year: number, ledger: Ledger, instruments: readonly Instrument[]): Record<'thaiDividend' | 'thaiInterest' | 'foreign', IncomeLine> {
  const thaiMarkets = new Set(['SET', 'FUND', 'BOND', 'GOLD'])
  const marketOf = new Map(instruments.map((i) => [i.id, i.market]))
  const out = {
    thaiDividend: { grossBase: D(0), taxBase: D(0), count: 0 },
    thaiInterest: { grossBase: D(0), taxBase: D(0), count: 0 },
    foreign: { grossBase: D(0), taxBase: D(0), count: 0 },
  }
  for (const e of ledger.income) {
    if (!e.date.startsWith(`${year}-`) || e.kind === 'receive_asset') continue
    const thai = e.currency === 'THB' && (!e.instrumentId || thaiMarkets.has(marketOf.get(e.instrumentId) ?? 'SET'))
    const line = !thai ? out.foreign : e.kind === 'dividend' ? out.thaiDividend : out.thaiInterest
    line.grossBase = line.grossBase.plus(e.grossBase)
    line.taxBase = line.taxBase.plus(e.taxBase)
    line.count += 1
  }
  return out
}

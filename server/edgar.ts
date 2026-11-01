// What large holders and company insiders file with SEC: 13F information tables (funds' quarter-end holdings) and
// Form 4 (an insider's trade). Both are XML; tags may carry a namespace prefix.

export interface Holding {
  cusip: string
  issuer: string
  shares: number
  value: number
}

export interface Move extends Holding {
  change: 'new' | 'add' | 'reduce' | 'exit' | 'same'
  sharesChange: number
  valueChange: number
}

export interface InsiderTrade {
  owner: string
  role: string
  date: string
  side: 'buy' | 'sell'
  shares: string
  price: string
}

const tag = (xml: string, name: string) => new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml)?.[1].trim() ?? ''
const all = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'g'))].map((m) => m[1])
// Form 4 wraps most values one level down: <transactionDate><value>2025-10-02</value></transactionDate>.
const valueOf = (xml: string, name: string) => {
  const inner = tag(xml, name)
  return inner.includes('<') ? tag(inner, 'value') : inner
}

// A fund often reports one security in several rows (one per manager); options are left out.
export function parseInfoTable(xml: string): Holding[] {
  const holdings = new Map<string, Holding>()
  for (const row of all(xml, 'infoTable')) {
    if (tag(row, 'putCall')) continue
    const cusip = tag(row, 'cusip')
    const shares = Number(tag(row, 'sshPrnamt'))
    const value = Number(tag(row, 'value'))
    const seen = holdings.get(cusip)
    holdings.set(cusip, seen ? { ...seen, shares: seen.shares + shares, value: seen.value + value } : { cusip, issuer: tag(row, 'nameOfIssuer'), shares, value })
  }
  return [...holdings.values()]
}

// The latest quarter's positions in its own order, then those sold out since the quarter before.
export function compareHoldings(latest: readonly Holding[], previous: readonly Holding[]): Move[] {
  const before = new Map(previous.map((h) => [h.cusip, h]))
  const now = new Set(latest.map((h) => h.cusip))
  const kept: Move[] = latest.map((h) => {
    const prior = before.get(h.cusip)
    const sharesChange = h.shares - (prior?.shares ?? 0)
    const change = !prior ? 'new' : sharesChange > 0 ? 'add' : sharesChange < 0 ? 'reduce' : 'same'
    return { ...h, change, sharesChange, valueChange: h.value - (prior?.value ?? 0) }
  })
  const exits: Move[] = previous
    .filter((h) => !now.has(h.cusip))
    .map((h) => ({ ...h, shares: 0, value: 0, change: 'exit', sharesChange: -h.shares, valueChange: -h.value }))
  return [...kept, ...exits]
}

const yes = (flag: string) => flag === '1' || flag.toLowerCase() === 'true'

// Only buys and sells on the open market (codes P and S); grants, option exercises and tax withholding say little about
// what an insider thinks of the price.
export function parseForm4(xml: string): InsiderTrade[] {
  const owner = tag(tag(xml, 'reportingOwnerId'), 'rptOwnerName')
  const relationship = tag(xml, 'reportingOwnerRelationship')
  const role = tag(relationship, 'officerTitle') || (yes(tag(relationship, 'isDirector')) ? 'Director' : yes(tag(relationship, 'isTenPercentOwner')) ? '10% owner' : '')
  return all(tag(xml, 'nonDerivativeTable'), 'nonDerivativeTransaction').flatMap((t): InsiderTrade[] => {
    const code = tag(tag(t, 'transactionCoding'), 'transactionCode')
    if (code !== 'P' && code !== 'S') return []
    return [{ owner, role, date: valueOf(t, 'transactionDate'), side: code === 'P' ? 'buy' : 'sell', shares: valueOf(t, 'transactionShares'), price: valueOf(t, 'transactionPricePerShare') }]
  })
}

const STOP = new Set(['INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LIMITED', 'PLC', 'LP', 'LLC', 'HOLDINGS', 'HOLDING', 'GROUP', 'THE', 'NV', 'SA', 'AG', 'NEW', 'DEL', 'COM'])

// 13F names (APPLE INC) and SEC company titles (Apple Inc., MOODYS CORP /DE/) differ in case, punctuation and suffixes;
// what is left after dropping those usually matches. Abbreviated names (BANK AMER CORP) do not, and stay unmatched.
export function normalizeName(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/\/[A-Z]{2}\/?/g, ' ')
    .replace(/&/g, ' AND ')
    .replace(/[.,'()/-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const kept: string[] = []
  for (let i = 0; i < words.length; i++) {
    if (words[i] === 'CLASS' || words[i] === 'CL') i++
    else if (!STOP.has(words[i])) kept.push(words[i])
  }
  return kept.join(' ')
}

// One entry of SEC's company_tickers.json.
export interface SecCompany {
  cik_str: number
  ticker: string
  title: string
}

export function nameIndex(companies: Record<string, SecCompany>): Map<string, string> {
  const index = new Map<string, string>()
  for (const { ticker, title } of Object.values(companies)) {
    const key = normalizeName(title)
    if (key && !index.has(key)) index.set(key, ticker)
  }
  return index
}

export function tickerOf(index: ReadonlyMap<string, string>, issuer: string): string | null {
  return index.get(normalizeName(issuer)) ?? null
}

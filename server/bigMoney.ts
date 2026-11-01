import { compareHoldings, parseForm4, parseInfoTable, tickerOf, type InsiderTrade, type Move } from './edgar.ts'
import { parseHouseIndex, parsePtrText, readZipEntry, type HouseFiling, type HouseTrade } from './house.ts'

// Well-known funds whose quarterly 13F holdings JOD follows; SEC's own name for each is what the app shows.
export const FUND_CIKS = ['1067983', '1350694', '1649339', '1697748', '1336528', '1037389', '1167483', '1040273', '1536411', '1656456']

const HOUSE = 'https://disclosures-clerk.house.gov/public_disc'
const DAY = 86_400_000
// A filed document never changes (an amendment is a new filing), so it is kept as long as the cache allows.
const FILED_TTL = 30 * DAY
const SUBMISSIONS_TTL = 6 * 3_600_000
const HOUSE_REPORTS = 40
const TOP_MOVES = 5
const CONGRESS_SHOWN = 30
const FORMS_4 = 12

export interface FundMove {
  issuer: string
  ticker: string | null
  shares: string
  value: string
  change: Move['change']
  sharesChange: string
  valueChange: string
}

export interface FundReport {
  cik: string
  name: string
  period: string
  filedAt: string
  moves: FundMove[]
}

export interface CongressTrade extends HouseTrade {
  member: string
  state: string
  filedAt: string
  url: string
}

export interface Insider extends InsiderTrade {
  filedAt: string
}

// Null where a source is off (SEC without SEC_USER_AGENT) or has never answered.
export interface BigMoney {
  funds: FundReport[] | null
  congress: CongressTrade[] | null
}

export interface BigMoneyFor {
  holders: (FundMove & { fund: string; period: string; filedAt: string })[] | null
  insiders: Insider[] | null
  congress: CongressTrade[]
}

type Get = (url: string, ttl: number, options?: { userAgent?: string; body?: 'json' | 'text' | 'bytes'; reduce?: (body: never) => unknown }) => Promise<unknown>
type Submissions = { name: string; filings: { recent: { accessionNumber: string[]; form: string[]; filingDate: string[]; reportDate: string[]; primaryDocument: string[] } } }

export function createBigMoney({
  get,
  now,
  secUserAgent,
  readPdf,
  companies,
}: {
  get: Get
  now: () => number
  secUserAgent: string
  readPdf: (pdf: Uint8Array) => Promise<string>
  companies: () => Promise<{ cik: Map<string, number>; names: Map<string, string> }>
}) {
  const sec = { userAgent: secUserAgent }
  // What was read last, so a source that fails on a later day still shows its last good data.
  let lastFunds: FundReport[] | null = null
  let lastCongress: CongressTrade[] | null = null

  const submissions = (cik: string) => get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, '0')}.json`, SUBMISSIONS_TTL, sec) as Promise<Submissions>
  const folder = (cik: string, accession: string) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}`

  async function infoTable(cik: string, accession: string) {
    const index = (await get(`${folder(cik, accession)}/index.json`, FILED_TTL, sec)) as { directory: { item: { name: string }[] } }
    const file = index.directory.item.map((i) => i.name).find((name) => name.endsWith('.xml') && name !== 'primary_doc.xml')
    return file ? ((await get(`${folder(cik, accession)}/${file}`, FILED_TTL, { ...sec, body: 'text', reduce: parseInfoTable })) as ReturnType<typeof parseInfoTable>) : []
  }

  async function fund(cik: string): Promise<FundReport | null> {
    const { name, filings } = await submissions(cik)
    const rows = filings.recent.form.flatMap((form, i) => (form === '13F-HR' ? [i] : [])).slice(0, 2)
    if (rows.length === 0) return null
    const [latest, previous] = await Promise.all(rows.map((i) => infoTable(cik, filings.recent.accessionNumber[i])))
    const { names } = await companies()
    return {
      cik,
      name,
      period: filings.recent.reportDate[rows[0]],
      filedAt: filings.recent.filingDate[rows[0]],
      moves: compareHoldings(latest, previous ?? []).map((m) => ({
        issuer: m.issuer,
        ticker: tickerOf(names, m.issuer),
        shares: String(m.shares),
        value: String(m.value),
        change: m.change,
        sharesChange: String(m.sharesChange),
        valueChange: String(m.valueChange),
      })),
    }
  }

  // One fund at a time keeps SEC's ten-requests-a-second limit far away; a fund that fails is left out this time.
  async function funds(): Promise<FundReport[]> {
    const reports: FundReport[] = []
    for (const cik of FUND_CIKS) {
      const report = await fund(cik).catch(() => null)
      if (report) reports.push(report)
    }
    if (reports.length === 0) throw new Error('no 13F could be read')
    return reports
  }

  async function houseFilings(): Promise<HouseFiling[]> {
    const year = new Date(now()).getUTCFullYear()
    const years = await Promise.allSettled(
      [year, year - 1].map((y) => get(`${HOUSE}/financial-pdfs/${y}FD.zip`, DAY, { body: 'bytes', reduce: (zip: Uint8Array) => parseHouseIndex(readZipEntry(zip, `${y}FD.xml`) ?? '') })),
    )
    if (years.every((y) => y.status === 'rejected')) throw (years[0] as PromiseRejectedResult).reason
    return years.flatMap((y) => (y.status === 'fulfilled' ? (y.value as HouseFiling[]) : [])).sort((a, b) => b.filedAt.localeCompare(a.filedAt) || b.docId.localeCompare(a.docId))
  }

  async function congress(): Promise<CongressTrade[]> {
    const trades: CongressTrade[] = []
    for (const filing of (await houseFilings()).slice(0, HOUSE_REPORTS)) {
      const url = `${HOUSE}/ptr-pdfs/${filing.year}/${filing.docId}.pdf`
      const read = (await get(url, FILED_TTL, { body: 'bytes', reduce: async (pdf: Uint8Array) => parsePtrText(await readPdf(pdf)) }).catch(() => [])) as HouseTrade[]
      trades.push(...read.map((t) => ({ ...t, member: filing.name, state: filing.state, filedAt: filing.filedAt, url })))
    }
    return trades
  }

  async function insiders(symbol: string): Promise<Insider[]> {
    const cik = (await companies()).cik.get(symbol.replace(/\./g, '-'))
    if (!cik) return []
    const { filings } = await submissions(String(cik))
    const rows = filings.recent.form.flatMap((form, i) => (form === '4' ? [i] : [])).slice(0, FORMS_4)
    const found: Insider[] = []
    for (const i of rows) {
      // The listed document is SEC's rendering (xslF345X05/…); the raw XML has the same name one folder up.
      const doc = filings.recent.primaryDocument[i].replace(/^xsl[^/]+\//, '')
      const trades = (await get(`${folder(String(cik), filings.recent.accessionNumber[i])}/${doc}`, FILED_TTL, { ...sec, body: 'text', reduce: parseForm4 }).catch(() => [])) as InsiderTrade[]
      found.push(...trades.map((t) => ({ ...t, filedAt: filings.recent.filingDate[i] })))
    }
    return found
  }

  async function read(): Promise<BigMoney> {
    const [f, c] = await Promise.allSettled([secUserAgent ? funds() : Promise.resolve(null), congress()])
    if (f.status === 'fulfilled' && f.value) lastFunds = f.value
    if (c.status === 'fulfilled') lastCongress = c.value
    return { funds: secUserAgent ? lastFunds : null, congress: lastCongress }
  }

  return {
    async bigMoney(): Promise<BigMoney> {
      const { funds, congress } = await read()
      return {
        funds:
          funds?.map((r) => ({
            ...r,
            moves: r.moves
              .filter((m) => m.change !== 'same')
              .sort((a, b) => Math.abs(Number(b.valueChange)) - Math.abs(Number(a.valueChange)))
              .slice(0, TOP_MOVES),
          })) ?? null,
        congress: congress?.slice(0, CONGRESS_SHOWN) ?? null,
      }
    },
    async bigMoneyFor(symbol: string): Promise<BigMoneyFor> {
      const { funds, congress } = await read()
      return {
        holders: funds?.flatMap((r) => r.moves.filter((m) => m.ticker === symbol).map((m) => ({ ...m, fund: r.name, period: r.period, filedAt: r.filedAt }))) ?? null,
        insiders: secUserAgent ? await insiders(symbol).catch(() => []) : null,
        congress: (congress ?? []).filter((t) => t.ticker === symbol),
      }
    },
    async warmUp(): Promise<void> {
      await read()
    },
  }
}

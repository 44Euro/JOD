// @vitest-environment node
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createMarket } from './market.ts'

function zip(name: string, text: string): Uint8Array {
  const data = deflateRawSync(Buffer.from(text))
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(8, 8)
  header.writeUInt32LE(data.length, 18)
  header.writeUInt32LE(text.length, 22)
  header.writeUInt16LE(name.length, 26)
  return new Uint8Array(Buffer.concat([header, Buffer.from(name), data]))
}

const member = (last: string, type: string, date: string, docId: string) =>
  `<Member><Last>${last}</Last><First>Pat</First><Suffix /><FilingType>${type}</FilingType><StateDst>NJ05</StateDst><Year>2026</Year><FilingDate>${date}</FilingDate><DocID>${docId}</DocID></Member>`
const houseIndex = `<FinancialDisclosure>${member('Older', 'P', '3/1/2026', '200')}${member('Newer', 'P', '3/9/2026', '201')}${member('Other', 'C', '3/9/2026', '300')}</FinancialDisclosure>`
const reports: Record<string, string> = {
  '200': 'JT Apple Inc. - Common Stock (AAPL) [ST] P 02/02/2026 02/20/2026 $1,001 - $15,000\nF S: New',
  '201': 'SP NVIDIA Corporation - Common Stock (NVDA) [ST] S 03/01/2026 03/05/2026 $15,001 - $50,000\nF S: New\nJT Apple Inc. - Common Stock (AAPL) [ST] S (partial) 03/02/2026 03/05/2026 $1,001 - $15,000\nF S: New',
}

const companies = { '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, '1': { cik_str: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' } }
const infoRow = (issuer: string, cusip: string, value: number, shares: number) =>
  `<infoTable><nameOfIssuer>${issuer}</nameOfIssuer><cusip>${cusip}</cusip><value>${value}</value><shrsOrPrnAmt><sshPrnamt>${shares}</sshPrnamt></shrsOrPrnAmt></infoTable>`
const berkshire = {
  name: 'BERKSHIRE HATHAWAY INC',
  filings: {
    recent: {
      accessionNumber: ['0000950123-26-000002', '0000950123-26-000009', '0000950123-25-000001'],
      form: ['13F-HR', '4', '13F-HR'],
      filingDate: ['2026-08-14', '2026-08-01', '2026-05-15'],
      reportDate: ['2026-06-30', '', '2026-03-31'],
      primaryDocument: ['primary_doc.xml', 'xslF345X05/form4.xml', 'primary_doc.xml'],
    },
  },
}
const apple = {
  name: 'Apple Inc.',
  filings: { recent: { accessionNumber: ['0000320193-26-000077'], form: ['4'], filingDate: ['2026-10-03'], reportDate: [''], primaryDocument: ['xslF345X05/wk-form4.xml'] } },
}
const form4 =
  '<ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>COOK TIMOTHY D</rptOwnerName></reportingOwnerId><reportingOwnerRelationship><officerTitle>CEO</officerTitle></reportingOwnerRelationship></reportingOwner><nonDerivativeTable><nonDerivativeTransaction><transactionDate><value>2026-10-01</value></transactionDate><transactionCoding><transactionCode>S</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>1000</value></transactionShares><transactionPricePerShare><value>250</value></transactionPricePerShare></transactionAmounts></nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>'

function sources(extra: Record<string, unknown> = {}) {
  const asked: string[] = []
  const routes: Record<string, unknown> = {
    '2026FD.zip': zip('2026FD.xml', houseIndex),
    '/2026/200.pdf': new TextEncoder().encode('200'),
    '/2026/201.pdf': new TextEncoder().encode('201'),
    'company_tickers.json': companies,
    'CIK0001067983.json': berkshire,
    'CIK0000320193.json': apple,
    '000095012326000002/index.json': { directory: { item: [{ name: 'primary_doc.xml' }, { name: 'berkshire-q2.xml' }] } },
    '000095012326000002/berkshire-q2.xml': `<informationTable>${infoRow('APPLE INC', '037833100', 60e9, 280e6)}${infoRow('BANK AMER CORP', '060505104', 30e9, 600e6)}${infoRow('NEW CO', '999999999', 5e9, 1e6)}</informationTable>`,
    '000095012325000001/index.json': { directory: { item: [{ name: 'q1.xml' }] } },
    '000095012325000001/q1.xml': `<informationTable>${infoRow('APPLE INC', '037833100', 70e9, 300e6)}${infoRow('BANK AMER CORP', '060505104', 30e9, 600e6)}${infoRow('OLD CO', '888888888', 2e9, 5e6)}</informationTable>`,
    '000032019326000077/wk-form4.xml': form4,
    ...extra,
  }
  const fetchFn = (async (url: string | URL | Request) => {
    asked.push(String(url))
    const hit = Object.entries(routes).find(([part]) => String(url).includes(part))?.[1]
    if (hit === undefined || hit === 500) return new Response('no', { status: hit === 500 ? 500 : 404 })
    if (hit instanceof Uint8Array) return new Response(hit)
    return new Response(typeof hit === 'string' ? hit : JSON.stringify(hit))
  }) as typeof fetch
  const readPdf = async (pdf: Uint8Array) => reports[new TextDecoder().decode(pdf)] ?? ''
  return { fetchFn, readPdf, asked }
}

const now = () => Date.parse('2026-10-31T00:00:00Z')

describe('big money', () => {
  it('gathers House trades from the newest reports first', async () => {
    const { fetchFn, readPdf } = sources()
    const { congress } = await createMarket({ fetchFn, readPdf, now }).bigMoney()
    expect(congress?.map((t) => [t.member, t.ticker, t.type, t.filedAt])).toEqual([
      ['Pat Newer', 'NVDA', 'sell', '2026-03-09'],
      ['Pat Newer', 'AAPL', 'partial', '2026-03-09'],
      ['Pat Older', 'AAPL', 'buy', '2026-03-01'],
    ])
    expect(congress?.[0].url).toBe('https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/201.pdf')
  })

  it("ranks each fund's biggest moves between its last two 13Fs", async () => {
    const { fetchFn, readPdf } = sources()
    const { funds } = await createMarket({ fetchFn, readPdf, now, secUserAgent: 'JOD test ops@example.test' }).bigMoney()
    expect(funds).toHaveLength(1)
    expect(funds?.[0]).toMatchObject({ cik: '1067983', name: 'BERKSHIRE HATHAWAY INC', period: '2026-06-30', filedAt: '2026-08-14' })
    expect(funds?.[0].moves.map((m) => [m.issuer, m.ticker, m.change, m.sharesChange])).toEqual([
      ['APPLE INC', 'AAPL', 'reduce', '-20000000'],
      ['NEW CO', null, 'new', '1000000'],
      ['OLD CO', null, 'exit', '-5000000'],
    ])
  })

  it('still serves House trades when SEC is off', async () => {
    const { fetchFn, readPdf, asked } = sources()
    const result = await createMarket({ fetchFn, readPdf, now }).bigMoney()
    expect(result.funds).toBeNull()
    expect(result.congress).toHaveLength(3)
    expect(asked.some((u) => u.includes('sec.gov'))).toBe(false)
  })

  it('keeps the last House trades it read when the site fails later', async () => {
    const first = sources()
    let clock = now()
    const market = createMarket({ fetchFn: (u, o) => first.fetchFn(u, o), readPdf: first.readPdf, now: () => clock })
    await market.bigMoney()
    const down = sources({ '2026FD.zip': 500 })
    first.fetchFn = down.fetchFn
    clock += 2 * 86_400_000
    expect((await market.bigMoney()).congress).toHaveLength(3)
  })

  it('finds holders, insiders and House trades for one symbol', async () => {
    const { fetchFn, readPdf } = sources()
    const result = await createMarket({ fetchFn, readPdf, now, secUserAgent: 'JOD test ops@example.test' }).bigMoneyFor('AAPL')
    expect(result.holders?.map((h) => [h.fund, h.change, h.shares])).toEqual([['BERKSHIRE HATHAWAY INC', 'reduce', '280000000']])
    expect(result.insiders).toEqual([{ owner: 'COOK TIMOTHY D', role: 'CEO', date: '2026-10-01', side: 'sell', shares: '1000', price: '250', filedAt: '2026-10-03' }])
    expect(result.congress.map((t) => t.type)).toEqual(['partial', 'buy'])
  })
})

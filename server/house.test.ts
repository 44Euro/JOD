// @vitest-environment node
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseHouseIndex, parsePtrText, readZipEntry } from './house.ts'

// A zip with each entry deflated and its sizes in the local header, as the House Clerk's yearly index is built.
function zip(entries: Record<string, string>): Uint8Array {
  const parts: Buffer[] = []
  for (const [name, text] of Object.entries(entries)) {
    const data = deflateRawSync(Buffer.from(text))
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(8, 8)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(text.length, 22)
    header.writeUInt16LE(name.length, 26)
    parts.push(header, Buffer.from(name), data)
  }
  return new Uint8Array(Buffer.concat(parts))
}

const member = (last: string, first: string, type: string, date: string, docId: string, suffix = '') =>
  `<Member><Prefix /><Last>${last}</Last><First>${first}</First><Suffix>${suffix}</Suffix><FilingType>${type}</FilingType><StateDst>NJ05</StateDst><Year>2026</Year><FilingDate>${date}</FilingDate><DocID>${docId}</DocID></Member>`

describe('House index', () => {
  it('reads one entry of the yearly zip', () => {
    const file = zip({ '2026FD.txt': 'plain', '2026FD.xml': '﻿<FinancialDisclosure></FinancialDisclosure>' })
    expect(readZipEntry(file, '2026FD.xml')).toBe('<FinancialDisclosure></FinancialDisclosure>')
    expect(readZipEntry(file, 'missing.xml')).toBeNull()
  })

  it('lists the periodic transaction reports newest first', () => {
    const xml = `<FinancialDisclosure>${member('Gottheimer', 'Josh', 'P', '1/7/2026', '20033756')}${member('Aaron', 'Richard', 'W', '4/15/2026', '8068')}${member('Yakym', 'Rudy C.', 'P', '10/20/2026', '20035691', 'III')}</FinancialDisclosure>`
    expect(parseHouseIndex(xml)).toEqual([
      { docId: '20035691', name: 'Rudy C. Yakym III', state: 'NJ05', filedAt: '2026-10-20', year: 2026 },
      { docId: '20033756', name: 'Josh Gottheimer', state: 'NJ05', filedAt: '2026-01-07', year: 2026 },
    ])
  })
})

describe('House report text', () => {
  // The form's small-caps labels come out of the PDF as their capitals followed by NUL characters.
  const status = (word: string) => `F\u0000\u0000\u0000\u0000\u0000 S\u0000\u0000\u0000\u0000\u0000: ${word}`
  const account = 'S\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000 O\u0000: Morgan Stanley - Select UMA Account # 1'
  const text = [
    'Filing ID #20033756',
    'Name: Hon. Josh Gottheimer',
    'ID Owner Asset Transaction Date Notification Amount Cap.',
    'Type Date Gains >',
    'JT Air Products and Chemicals, Inc. S (partial) 12/08/2025 01/07/2026 $15,001 -',
    'Common Stock (APD) [ST] $50,000',
    status('New'),
    account,
    'JT Cheniere Energy, Inc. Common Stock S 12/12/2025 01/07/2026 $1,001 - $15,000',
    '(LNG) [ST]',
    status('New'),
    account,
    'JT M3 INC UNSP/ADR (MTHRY) [ST] S 12/05/2025 01/07/2026 $1,001 - $15,000',
    status('New'),
    'SP Apple Inc. - Common Stock (AAPL) [ST] P 09/12/2025 09/30/2025 $250,001 - $500,000',
    'D\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000: Bought for a long-term holding',
    status('Amended'),
    'JT Call options on NVIDIA (NVDA) [OP] P 09/12/2025 09/30/2025 $15,001 - $50,000',
    status('New'),
    'Treasury Bill (6-Week, Matures P 10/20/2026 10/20/2026 $15,001 -',
    '12/3/2026) [GS] $50,000',
    status('New'),
    'SP Berkshire Hathaway Inc. Class B (BRK.B) [ST] E 03/02/2026 03/20/2026 Over $50,000,000',
    status('New'),
    'I CERTIFY that the statements I have made are true.',
  ].join('\n')

  it('reads each stock trade with its ticker, side, dates and amount band', () => {
    expect(parsePtrText(text)).toEqual([
      { ticker: 'APD', asset: 'Air Products and Chemicals, Inc. Common Stock', type: 'partial', tradedAt: '2025-12-08', notifiedAt: '2026-01-07', amount: '$15,001 – $50,000' },
      { ticker: 'LNG', asset: 'Cheniere Energy, Inc. Common Stock', type: 'sell', tradedAt: '2025-12-12', notifiedAt: '2026-01-07', amount: '$1,001 – $15,000' },
      { ticker: 'MTHRY', asset: 'M3 INC UNSP/ADR', type: 'sell', tradedAt: '2025-12-05', notifiedAt: '2026-01-07', amount: '$1,001 – $15,000' },
      { ticker: 'AAPL', asset: 'Apple Inc. - Common Stock', type: 'buy', tradedAt: '2025-09-12', notifiedAt: '2025-09-30', amount: '$250,001 – $500,000' },
      { ticker: 'BRK.B', asset: 'Berkshire Hathaway Inc. Class B', type: 'exchange', tradedAt: '2026-03-02', notifiedAt: '2026-03-20', amount: 'Over $50,000,000' },
    ])
  })

  it('finds nothing in a report with no text', () => {
    expect(parsePtrText('')).toEqual([])
    expect(parsePtrText('Filing ID #1\nName: Hon. Someone')).toEqual([])
  })
})

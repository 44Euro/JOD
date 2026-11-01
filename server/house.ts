import { inflateRawSync } from 'node:zlib'

// US House members' periodic transaction reports, from the Clerk's public disclosure site: a yearly zip index and one
// PDF per report. The PDFs are forms printed to PDF, so the parsing below reads their text layout and may need
// adjusting when the Clerk changes the form; reports filed on paper are images and give no text.

export interface HouseFiling {
  docId: string
  name: string
  state: string
  filedAt: string
  year: number
}

export interface HouseTrade {
  ticker: string
  asset: string
  type: 'buy' | 'sell' | 'partial' | 'exchange'
  tradedAt: string
  notifiedAt: string
  amount: string
}

export function readZipEntry(zip: Uint8Array, name: string): string | null {
  const bytes = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength)
  let at = 0
  while (at + 30 <= bytes.length && bytes.readUInt32LE(at) === 0x04034b50) {
    const method = bytes.readUInt16LE(at + 8)
    const size = bytes.readUInt32LE(at + 18)
    const nameLength = bytes.readUInt16LE(at + 26)
    const extraLength = bytes.readUInt16LE(at + 28)
    const start = at + 30 + nameLength + extraLength
    if (bytes.toString('utf8', at + 30, at + 30 + nameLength) === name) {
      const data = bytes.subarray(start, start + size)
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8').replace(/^﻿/, '')
    }
    at = start + size
  }
  return null
}

const field = (row: string, tag: string) => /<(\w+)>([^<]*)<\/\1>/.exec(row.slice(row.indexOf(`<${tag}>`)))?.[2].trim() ?? ''
const isoDate = (mdy: string) => {
  const [m, d, y] = mdy.split('/')
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

export function parseHouseIndex(xml: string): HouseFiling[] {
  return [...xml.matchAll(/<Member>([\s\S]*?)<\/Member>/g)]
    .map(([, row]) => row)
    .filter((row) => field(row, 'FilingType') === 'P')
    .map((row) => ({
      docId: field(row, 'DocID'),
      name: [field(row, 'First'), field(row, 'Last'), field(row, 'Suffix')].filter(Boolean).join(' '),
      state: field(row, 'StateDst'),
      filedAt: isoDate(field(row, 'FilingDate')),
      year: Number(field(row, 'Year')),
    }))
    .sort((a, b) => b.filedAt.localeCompare(a.filedAt) || b.docId.localeCompare(a.docId))
}

// The form's small-caps labels keep only their capitals in the text, the rest coming out as NUL characters
// ("Filing Status: New" reads "F S: New"); that line ends each transaction, and the other labels ("S O:" for the
// account, "D:" for a description) are noise.
const STATUS = /^(?:[A-Z]\s+)*[A-Z]\s*:\s*(?:New|Amended)$/
const LABEL = /^(?:[A-Z]\s+)*[A-Z]\s*:\s/
const HEAD = /(?:^|\s)(P|S \(partial\)|S|E)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(Over \$[\d,]+|\$[\d,]+)(?:\s*-)?/
const STOCK = /\(([A-Z][A-Z0-9.-]{0,9})\)\s*\[ST\]/
const TYPES: Record<string, HouseTrade['type']> = { P: 'buy', S: 'sell', 'S (partial)': 'partial', E: 'exchange' }

export function parsePtrText(text: string): HouseTrade[] {
  const blocks: string[][] = [[]]
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\u0000/g, '').trim()
    if (STATUS.test(line)) blocks.push([])
    else if (line && !LABEL.test(line)) blocks.at(-1)!.push(line)
  }
  return blocks.flatMap((lines) => {
    let block = lines.join(' ')
    // The column headings repeat on each page and end with "Gains > $200?"; the transaction starts after them.
    block = block.slice(Math.max(...['Gains >', '$200?'].map((mark) => (block.includes(mark) ? block.lastIndexOf(mark) + mark.length : 0))))
    const head = HEAD.exec(block)
    const stock = STOCK.exec(block)
    if (!head || !stock) return []
    const lower = head[4]
    const upper = /\$[\d,]+/.exec(block.slice(head.index + head[0].length))?.[0]
    const asset = block
      .replace(head[0], ' ')
      .replace(stock[0], ' ')
      .replace(/\$[\d,]+/g, ' ')
      .replace(/^\s*(?:SP|JT|DC)\s/, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return [
      {
        ticker: stock[1],
        asset,
        type: TYPES[head[1]],
        tradedAt: isoDate(head[2]),
        notifiedAt: isoDate(head[3]),
        amount: lower.startsWith('Over') || !upper ? lower : `${lower} – ${upper}`,
      },
    ]
  })
}

// Text lines in reading order: items on one baseline joined left to right, baselines from the top of each page.
export async function pdfText(pdf: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: pdf })
  const doc = await task.promise
  const out: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent()
    const lines = new Map<number, [number, string][]>()
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const y = Math.round(item.transform[5])
      lines.set(y, [...(lines.get(y) ?? []), [item.transform[4], item.str]])
    }
    for (const [, parts] of [...lines].sort((a, b) => b[0] - a[0])) {
      out.push(
        parts
          .sort((a, b) => a[0] - b[0])
          .map(([, s]) => s)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
    }
  }
  await task.destroy()
  return out.join('\n')
}

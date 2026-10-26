import { describe, expect, it } from 'vitest'
import type { PreparedFile } from './files'
import { createLocalReader } from './localReader'

const image: PreparedFile = { kind: 'image', name: 'a.png', mediaType: 'image/png', data: '', width: 1, height: 1, previewUrl: '' }
const pdf: PreparedFile = { kind: 'pdf', name: 's.pdf', data: '', pages: 1 }
const csv: PreparedFile = { kind: 'text', name: 'o.csv', data: 'Date,Symbol,Side,Qty,Price\n2024-10-15,AAPL,Buy,1,100' }

describe('createLocalReader', () => {
  it('reads each kind of file its own way and puts the rows together', async () => {
    const reader = createLocalReader({ recognize: async () => 'VOO 40 455.20', pdfLines: async () => ['15/10/2567 ขาย PTT 100 35.25'] })
    const result = await reader.read([image, pdf, csv], '2026-10-26')
    expect(result.rows.map((r) => [r.kind, r.symbol])).toEqual([['opening', 'VOO'], ['sell', 'PTT'], ['buy', 'AAPL']])
    expect(result.source).toBe('orders')
  })

  it('stops between files once cancelled', async () => {
    const controller = new AbortController()
    const reader = createLocalReader({
      recognize: async () => {
        controller.abort()
        return ''
      },
      pdfLines: async () => [],
    })
    await expect(reader.read([image, csv], '2026-10-26', controller.signal)).rejects.toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import { countPdfPages, estimateCost, estimateTokens, fitWithin, prepareFile, type PreparedFile } from './files'

const phoneShot: PreparedFile = { kind: 'image', name: 'a.png', mediaType: 'image/png', data: '', width: 1170, height: 2532, previewUrl: '' }

describe('fitWithin', () => {
  it('leaves an image within 2576px alone and shrinks a larger one on its long edge', () => {
    expect(fitWithin(1170, 2532)).toEqual({ width: 1170, height: 2532 })
    expect(fitWithin(4032, 3024)).toEqual({ width: 2576, height: 1932 })
  })
})

describe('countPdfPages', () => {
  it('counts page objects but not the page tree', () => {
    const pdf = new TextEncoder().encode('<< /Type /Pages /Kids [...] >> << /Type /Page >> << /Type/Page /Parent 1 >>')
    expect(countPdfPages(pdf)).toBe(2)
    expect(countPdfPages(new TextEncoder().encode('nothing'))).toBe(1)
  })
})

describe('estimateCost', () => {
  it('puts a phone screenshot at about 1–3 baht, as the spec quotes', () => {
    expect(estimateTokens([phoneShot]).input).toBe(1_200 + 3_950)
    expect(estimateCost([phoneShot], 33.5)).toBe(3)
    expect(estimateCost([phoneShot, phoneShot], 33.5)).toBe(5)
  })

  it('costs nothing for no files', () => {
    expect(estimateCost([], 33.5)).toBe(0)
  })
})

describe('prepareFile', () => {
  it('reads a CSV as text and asks for Excel to be saved as CSV', async () => {
    const csv = await prepareFile(new File(['date,symbol\n2024-01-02,AAPL'], 'orders.csv', { type: 'text/csv' }))
    expect(csv).toEqual({ kind: 'text', name: 'orders.csv', data: 'date,symbol\n2024-01-02,AAPL' })
    await expect(prepareFile(new File(['x'], 'book.xlsx'))).rejects.toThrow('บันทึกไฟล์ Excel เป็น CSV ก่อน')
    await expect(prepareFile(new File(['x'], 'clip.mp4', { type: 'video/mp4' }))).rejects.toThrow('ใส่ได้เฉพาะรูป, PDF หรือ CSV')
  })

  it('sends a PDF as base64 with its page count', async () => {
    const pdf = await prepareFile(new File(['%PDF /Type /Page'], 'statement.pdf', { type: 'application/pdf' }))
    expect(pdf).toMatchObject({ kind: 'pdf', pages: 1, data: btoa('%PDF /Type /Page') })
  })
})

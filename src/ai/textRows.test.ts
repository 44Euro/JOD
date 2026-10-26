import { describe, expect, it } from 'vitest'
import { OCR_NOTE, rowsFromLines } from './textRows'

describe('rowsFromLines', () => {
  it('reads a portfolio screen as holdings, skipping percent and day changes, and marks every figure', () => {
    const result = rowsFromLines(['พอร์ตของฉัน', 'VOO 40 455.20 512.30 +12.40 +12.5%', 'AAPL 15 172.40 185.00', 'Total 22,734.60 USD'])
    expect(result.source).toBe('portfolio')
    expect(result.rows.map((r) => [r.kind, r.symbol, r.quantity, r.price, r.lastPrice, r.uncertain])).toEqual([
      ['opening', 'VOO', '40', '455.2', '512.3', ['quantity', 'price']],
      ['opening', 'AAPL', '15', '172.4', '185', ['quantity', 'price']],
    ])
    expect(result.problems).toEqual([OCR_NOTE])
  })

  it('joins figures a phone wrapped onto the line under the symbol', () => {
    const [row] = rowsFromLines(['NVDA', '30 118.50 140.10']).rows
    expect([row.symbol, row.quantity, row.price]).toEqual(['NVDA', '30', '118.5'])
  })

  it('reads dated order lines with their side, Thai words included', () => {
    const rows = rowsFromLines(['15/10/2567 ขาย AAPL80 100 6.05', '10/16/2024 BUY MSFT 2 410.00']).rows
    expect(rows.map((r) => [r.kind, r.symbol, r.market, r.date, r.quantity, r.price])).toEqual([
      ['sell', 'AAPL80', 'SET', '2024-10-15', '100', '6.05'],
      ['buy', 'MSFT', null, '2024-10-16', '2', '410'],
    ])
  })

  it('says it found nothing rather than inventing rows', () => {
    const result = rowsFromLines(['Hello', 'no figures here'])
    expect(result.rows).toEqual([])
    expect(result.problems[0]).toContain('อ่านรายการจากไฟล์นี้ไม่ได้')
  })
})

import { describe, expect, it } from 'vitest'
import { OCR_NOTE, rowsFromLines } from './textRows'

describe('rowsFromLines', () => {
  it('reads a portfolio screen as holdings, skipping percent and day changes, and marks every figure', () => {
    const result = rowsFromLines(['พอร์ตของฉัน', 'VOO 40 455.20 512.30 +12.40 +12.5%', 'AAPL 15 172.40 185.00', 'Total 22,734.60 USD'])
    expect(result.source).toBe('portfolio')
    expect(result.rows.map((r) => [r.kind, r.symbol, r.quantity, r.price, r.lastPrice, r.uncertain])).toEqual([
      ['opening', 'VOO', '40', '455.2', '512.3', ['quantity', 'price', 'lastPrice']],
      ['opening', 'AAPL', '15', '172.4', '185', ['quantity', 'price', 'lastPrice']],
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

  // Dime's list shows each holding's value and its profit in brackets, never its units; OCR adds stray marks between.
  it('reads a holding from its value and bracketed profit when the screen shows no units', () => {
    const rows = rowsFromLines([
      '6 ส ิ น ท ร ั พ ย ์ ม ู ล ค ่ า ส ิ น ท ร ั พ ย ์ (USD) % ก ํ า ไร แล ะ ม ู ล ค ่ า',
      'TSM 118.80 ง -0.52%',
      '© 34.32% = 4,000.16 THB (-0.63 USD)',
      '« AAPL 64.74 7 10.34%',
      '© 18.70% = 21179.76 THB (+6.07 USD)',
      'NVDA 25.72 7 16.02%',
      '653',
      '© 7.42% = 865.88 THB (+3.55 USD)',
      'SCHD 64.56 27.52%',
      '© 18.65% = 2,173.64 THB (+4.52 บ ร ด )',
    ]).rows
    expect(rows.map((r) => [r.kind, r.symbol, r.quantity, r.price, r.value, r.amount, r.lastPrice, r.uncertain])).toEqual([
      ['opening', 'TSM', null, null, '118.8', '119.43', null, ['amount', 'value']],
      ['opening', 'AAPL', null, null, '64.74', '58.67', null, ['amount', 'value']],
      ['opening', 'NVDA', null, null, '25.72', '22.17', null, ['amount', 'value']],
      ['opening', 'SCHD', null, null, '64.56', '60.04', null, ['amount', 'value']],
    ])
  })

  it('reads units, average cost and price under their labels when a holding is opened', () => {
    const rows = rowsFromLines([
      'ane TSM 118.80 ง ษ -0.52%',
      '© 34.32% = 4,002.53 THB (-0.63 USD)',
      'จ ํ า น ว น ห ุ ้ น ค ง เห ล ื อ ร า ค า (USD) ua: % wasu ไว ้ น',
      '0.2980326 398.63',
      '~ -1.85%',
      'dunudaku (USD) ต ้ น ท ุ น ร ว ม (USD)',
      'ซอ - ข า ย',
      '400.7280 119.43',
      '« AAPL 64.74 7 10.34%',
      '๐ 18.70% = 2,181.06 THB (+6.07 USD)',
    ]).rows
    expect(rows.map((r) => [r.symbol, r.quantity, r.price, r.lastPrice, r.value, r.amount, r.uncertain])).toEqual([
      ['TSM', '0.2980326', '400.728', '398.63', null, null, ['quantity', 'price', 'lastPrice']],
      ['AAPL', null, null, null, '64.74', '58.67', ['amount', 'value']],
    ])
  })

  it('leaves out a holding cut off at the edge of a screen of values', () => {
    const rows = rowsFromLines(['SCHD 64.56 27.52%', '๐ 18.65% = 2174.93 THB (+4.52 USD)', 'NVDA 25.72 7 16.02%', '๕ 9']).rows
    expect(rows.map((r) => r.symbol)).toEqual(['SCHD'])
  })

  it('leaves out a holding of no units, which is a stray mark read as a symbol', () => {
    expect(rowsFromLines(['ARO) B ¢ 0 3', 'ARC) B ¢ 0 ๕']).rows).toEqual([])
  })

  it('says it found nothing rather than inventing rows', () => {
    const result = rowsFromLines(['Hello', 'no figures here'])
    expect(result.rows).toEqual([])
    expect(result.problems[0]).toContain('อ่านรายการจากไฟล์นี้ไม่ได้')
  })
})

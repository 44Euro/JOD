import { describe, expect, it } from 'vitest'
import { parseLooseDate, parseLooseNumber, readCsv, splitCsv } from './csvReader'

describe('splitCsv', () => {
  it('reads quoted cells with commas and doubled quotes, and finds a tab delimiter', () => {
    expect(splitCsv('a,b\n"1,234.50","say ""hi"""\r\n')).toEqual([['a', 'b'], ['1,234.50', 'say "hi"']])
    expect(splitCsv('﻿a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('parseLooseDate', () => {
  it('reads Buddhist-era years in full or in two digits', () => {
    expect(parseLooseDate('15/10/2567')).toEqual({ date: '2024-10-15', sure: true })
    expect(parseLooseDate('15/10/67')).toEqual({ date: '2024-10-15', sure: true })
    expect(parseLooseDate('2024-10-15 09:30')).toEqual({ date: '2024-10-15', sure: true })
  })

  it('reads a US month-first date when only that works, and flags a date that could be either', () => {
    expect(parseLooseDate('10/15/2024')).toEqual({ date: '2024-10-15', sure: true })
    expect(parseLooseDate('03/09/2024')).toEqual({ date: '2024-09-03', sure: false })
    expect(parseLooseDate('31/02/2024')).toEqual({ date: null, sure: false })
  })
})

describe('parseLooseNumber', () => {
  it('drops currency marks, separators and the sign of a charge', () => {
    expect(parseLooseNumber('$1,234.50')).toBe('1234.5')
    expect(parseLooseNumber('(12.00)')).toBe('12')
    expect(parseLooseNumber('1 234.5 THB')).toBe('1234.5')
    expect(parseLooseNumber('n/a')).toBeNull()
    expect(parseLooseNumber('')).toBeNull()
  })
})

describe('readCsv', () => {
  it('reads an English order export exactly, with its side, fees and currency', () => {
    const result = readCsv('Trade Date,Symbol,Side,Quantity,Price,Commission,Currency\n10/15/2024,aapl,BUY,10,"172.40",1.50,USD\n10/16/2024,AAPL,Sell,4,180,1,USD')
    expect(result.source).toBe('orders')
    expect(result.rows.map((r) => [r.kind, r.symbol, r.date, r.quantity, r.price, r.fees, r.currency, r.uncertain])).toEqual([
      ['buy', 'AAPL', '2024-10-15', '10', '172.4', '1.5', 'USD', []],
      ['sell', 'AAPL', '2024-10-16', '4', '180', '1', 'USD', []],
    ])
  })

  it('reads a Thai export with Buddhist dates and spots a DR as SET', () => {
    const result = readCsv('วันที่,หลักทรัพย์,ประเภท,จำนวนหุ้น,ราคา,ค่าธรรมเนียม,ภาษี\n15/10/67,AAPL80,ซื้อ,100,"6.05",1.6,0.11\n20/10/67,PTT,ปันผล,,,,10')
    expect(result.rows.map((r) => [r.kind, r.symbol, r.market, r.date, r.quantity, r.tax])).toEqual([
      ['buy', 'AAPL80', 'SET', '2024-10-15', '100', '0.11'],
      ['dividend', 'PTT', null, '2024-10-20', null, '10'],
    ])
  })

  it('treats a file without dates as holdings and keeps the latest price', () => {
    const [row] = readCsv('Symbol,Shares,Average Cost,Market Price\nVOO,40,455.20,512.30').rows
    expect([row.kind, row.quantity, row.price, row.lastPrice, row.date]).toEqual(['opening', '40', '455.2', '512.3', null])
  })

  it('flags what it cannot be sure of instead of guessing', () => {
    const result = readCsv('Date,Symbol,Side,Qty,Price\n03/09/2024,MSFT,Buy,1O,410\n03/10/2024,MSFT,Transfer,1,1')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].uncertain).toEqual(['date', 'quantity'])
    expect(result.rows[0].quantity).toBeNull()
    expect(result.problems).toEqual(['ข้ามบางแถวที่ไม่รู้ว่าเป็นซื้อ ขาย หรือปันผล'])
  })

  it('says when it cannot find the columns it needs', () => {
    expect(readCsv('foo,bar\n1,2').problems[0]).toContain('ไม่พบคอลัมน์ชื่อหลักทรัพย์')
  })
})

import { describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { validateTransaction } from './validation'

const TODAY = '2024-06-30'

describe('validateTransaction', () => {
  it('accepts a complete buy', () => {
    expect(validateTransaction(makeTx(), TODAY)).toEqual([])
  })

  it('rejects zero quantity, negative fees and a missing instrument', () => {
    const errors = validateTransaction(makeTx({ quantity: '0', fees: '-1', instrumentId: undefined }), TODAY)
    expect(errors).toContain('จำนวนหน่วยต้องเป็นตัวเลขมากกว่า 0')
    expect(errors).toContain('ค่าธรรมเนียมต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป')
    expect(errors).toContain('กรุณาระบุหุ้น/สินทรัพย์')
  })

  it('rejects impossible and future dates', () => {
    expect(validateTransaction(makeTx({ date: '2024-02-30' }), TODAY)).toContain('วันที่ไม่ถูกต้อง')
    expect(validateTransaction(makeTx({ date: '2024-07-01' }), TODAY)).toContain('วันที่ต้องไม่เกินวันนี้')
  })

  it('rejects a missing FX rate and numbers that are not plain decimals', () => {
    const errors = validateTransaction(makeTx({ fxRate: '', price: '1e3' }), TODAY)
    expect(errors).toContain('เรทแลกเปลี่ยนต้องเป็นตัวเลขมากกว่า 0')
    expect(errors).toContain('ราคาต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป')
  })

  it('requires a different target currency for conversions', () => {
    const tx = makeTx({ type: 'fx_convert', currency: 'THB', amount: '100', toCurrency: 'THB', toAmount: '3' })
    expect(validateTransaction(tx, TODAY)).toContain('สกุลเงินปลายทางต้องต่างจากต้นทาง')
  })

  it('requires an amount for deposits', () => {
    const tx = makeTx({ type: 'deposit', amount: undefined, instrumentId: undefined })
    expect(validateTransaction(tx, TODAY)).toEqual(['จำนวนเงินต้องเป็นตัวเลขมากกว่า 0'])
  })

  it('requires quantity for an opening holding and an amount for opening cash', () => {
    expect(validateTransaction(makeTx({ type: 'opening', quantity: undefined }), TODAY)).toContain(
      'จำนวนหน่วยต้องเป็นตัวเลขมากกว่า 0',
    )
    const cash = makeTx({ type: 'opening', instrumentId: undefined, quantity: undefined, price: undefined })
    expect(validateTransaction(cash, TODAY)).toEqual(['จำนวนเงินต้องเป็นตัวเลขมากกว่า 0'])
  })

  it('requires a tax year when a withdrawal is sent back to Thailand', () => {
    const tx = makeTx({ type: 'withdraw', instrumentId: undefined, amount: '500', remitToThailand: true })
    expect(validateTransaction(tx, TODAY)).toEqual(['ปีภาษีไม่ถูกต้อง'])
    expect(validateTransaction({ ...tx, taxYear: 2024 }, TODAY)).toEqual([])
  })

  it('accepts interest without an instrument', () => {
    expect(validateTransaction(makeTx({ type: 'interest', instrumentId: undefined, amount: '2' }), TODAY)).toEqual([])
  })
})

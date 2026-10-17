import { describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { previewAfterSave } from './afterSave'

describe('previewAfterSave', () => {
  it('shows how the holding, its average cost and its average rate change', () => {
    const others = [makeTx({ quantity: '10', price: '100', fxRate: '35', date: '2024-01-10' })]
    const tx = makeTx({ quantity: '10', price: '120', fxRate: '33', date: '2024-02-10' })
    const { rows, warning } = previewAfterSave(others, tx, 'THB', 'AAPL')
    expect(rows).toEqual([
      { label: 'AAPL ที่ถือ', before: '10', after: '20' },
      { label: 'ทุนเฉลี่ย (USD)', before: '100', after: '110' },
      { label: 'เรทเฉลี่ยตอนซื้อ', before: '35', after: '33.9091', fx: true },
    ])
    expect(warning).toBeNull()
  })

  it('warns when cash in an account that records deposits would go negative', () => {
    const deposit = makeTx({
      type: 'deposit',
      instrumentId: undefined,
      quantity: undefined,
      price: undefined,
      amount: '500',
      date: '2024-01-05',
    })
    const tx = makeTx({ quantity: '10', price: '100', date: '2024-01-10' })
    const { rows, warning } = previewAfterSave([deposit], tx, 'THB', 'AAPL')
    expect(rows).toContainEqual({ label: 'เงินสด USD', before: '500.00', after: '−500.00' })
    expect(warning).toBe('เงินสด USD จะติดลบ · ลืมบันทึกการแลกเงินหรือฝากเงินหรือเปล่า?')
  })

  it('stays quiet for an account that only records trades', () => {
    const tx = makeTx({ quantity: '10', price: '100', date: '2024-01-10' })
    const { rows, warning } = previewAfterSave([], tx, 'THB', 'AAPL')
    expect(rows.map((row) => row.label)).not.toContain('เงินสด USD')
    expect(warning).toBeNull()
  })

  it('compares an edited transaction against its saved version', () => {
    const saved = makeTx({ id: 'buy-1', quantity: '10', price: '100', fxRate: '35', date: '2024-01-10' })
    const edited = { ...saved, quantity: '12' }
    const { rows } = previewAfterSave([], edited, 'THB', 'AAPL', saved)
    expect(rows[0]).toEqual({ label: 'AAPL ที่ถือ', before: '10', after: '12' })
  })

  it('does not warn about cash that the saved version already pushed below zero', () => {
    const deposit = makeTx({
      type: 'deposit',
      instrumentId: undefined,
      quantity: undefined,
      price: undefined,
      amount: '500',
      date: '2024-01-05',
    })
    const saved = makeTx({ id: 'buy-1', quantity: '10', price: '100', date: '2024-01-10' })
    const { rows, warning } = previewAfterSave([deposit], { ...saved, note: 'edited' }, 'THB', 'AAPL', saved)
    expect(rows.map((row) => row.label)).not.toContain('เงินสด USD')
    expect(warning).toBeNull()
  })
})

describe('previewAfterSave for a transfer', () => {
  const names = new Map([
    ['acc-1', 'Dime US'],
    ['acc-2', 'IBKR'],
  ])
  const buy = makeTx({ quantity: '10', price: '100', fxRate: '35', date: '2024-01-10' })
  const cash = { instrumentId: undefined, quantity: undefined, price: undefined }
  const deposit = makeTx({ ...cash, type: 'deposit', amount: '500', currency: 'THB', fxRate: '1', fxSource: 'same', date: '2024-01-05' })
  const sendCash = (amount: string) =>
    makeTx({ ...cash, type: 'transfer', toAccountId: 'acc-2', amount, currency: 'THB', fxRate: '1', fxSource: 'same', date: '2024-02-01' })

  it('shows the holding on both sides of a share transfer', () => {
    const tx = makeTx({ type: 'transfer', toAccountId: 'acc-2', quantity: '4', price: undefined, date: '2024-02-01' })
    const { rows, warning } = previewAfterSave([buy], tx, 'THB', 'AAPL', undefined, names)
    expect(rows).toEqual([
      { label: 'AAPL ใน Dime US', before: '10', after: '6' },
      { label: 'AAPL ใน IBKR', before: '0', after: '4' },
    ])
    expect(warning).toBeNull()
  })

  it('adds the fee to the sending account when it records cash', () => {
    const usd = makeTx({ ...cash, type: 'deposit', amount: '2000', date: '2024-01-05' })
    const tx = makeTx({ type: 'transfer', toAccountId: 'acc-2', quantity: '4', price: undefined, fees: '2', date: '2024-02-01' })
    const { rows } = previewAfterSave([usd, buy], tx, 'THB', 'AAPL', undefined, names)
    expect(rows.map((row) => row.label)).toEqual(['AAPL ใน Dime US', 'AAPL ใน IBKR', 'เงินสด USD ใน Dime US'])
    expect(rows[2]).toMatchObject({ before: '1,000.00', after: '998.00' })
  })

  it('shows the cash of both accounts for a cash transfer and warns when the sender would go negative', () => {
    const { rows, warning } = previewAfterSave([deposit], sendCash('800'), 'THB', '', undefined, names)
    expect(rows).toEqual([
      { label: 'เงินสด THB ใน Dime US', before: '500.00', after: '−300.00' },
      { label: 'เงินสด THB ใน IBKR', before: '0.00', after: '800.00' },
    ])
    expect(warning).toBe('เงินสด THB จะติดลบ · ลืมบันทึกการแลกเงินหรือฝากเงินหรือเปล่า?')
  })

  it('still shows both sides when the sender only records trades, without a warning', () => {
    const { rows, warning } = previewAfterSave([], sendCash('800'), 'THB', '', undefined, names)
    expect(rows.map((row) => row.label)).toEqual(['เงินสด THB ใน Dime US', 'เงินสด THB ใน IBKR'])
    expect(warning).toBeNull()
  })

  it('compares an edited transfer against its saved version', () => {
    const saved = { ...sendCash('300'), id: 'move-1' }
    const { rows } = previewAfterSave([deposit], { ...saved, amount: '400' }, 'THB', '', saved, names)
    expect(rows[1]).toEqual({ label: 'เงินสด THB ใน IBKR', before: '300.00', after: '400.00' })
  })
})


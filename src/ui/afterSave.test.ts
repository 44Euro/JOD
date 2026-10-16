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
})

import { describe, expect, it } from 'vitest'
import { D } from './decimal'
import { orderFee } from './fees'
import type { FeeTemplate } from './types'

const streaming: FeeTemplate = { currency: 'THB', commissionPct: '0.157', minimum: '50', vatPct: '7', perOrder: '0' }
const bitkub: FeeTemplate = { currency: 'THB', commissionPct: '0.25', minimum: '0', vatPct: '0', perOrder: '0' }
const dime: FeeTemplate = { currency: 'USD', commissionPct: '0', minimum: '0', vatPct: '0', perOrder: '0' }

describe('orderFee', () => {
  it('charges the minimum on a small order and the percentage on a large one, VAT on top', () => {
    expect(orderFee(streaming, D('3500')).toFixed(2)).toBe('53.50')
    expect(orderFee(streaming, D('35000')).toFixed(2)).toBe('58.80')
    expect(orderFee(bitkub, D('10000')).toFixed(2)).toBe('25.00')
    expect(orderFee(dime, D('1000')).toFixed(2)).toBe('0.00')
    expect(orderFee({ ...dime, perOrder: '0.99' }, D('1000')).toFixed(2)).toBe('0.99')
  })

  it('reads empty fields as zero', () => {
    const blank: FeeTemplate = { currency: 'THB', commissionPct: '0.25', minimum: '', vatPct: '', perOrder: '' }
    expect(orderFee(blank, D('10000')).toFixed(2)).toBe('25.00')
  })

  it('rounds half up to two decimals', () => {
    expect(orderFee({ ...bitkub, commissionPct: '0.1' }, D('5')).toFixed(2)).toBe('0.01')
    expect(orderFee({ ...bitkub, commissionPct: '0.1' }, D('4.9')).toFixed(2)).toBe('0.00')
  })
})

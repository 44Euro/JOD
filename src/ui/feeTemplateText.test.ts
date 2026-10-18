import { describe, expect, it } from 'vitest'
import type { FeeTemplate } from '../domain/types'
import { feeTemplateParts, feeTemplateSummary } from './feeTemplateText'

const streaming: FeeTemplate = { currency: 'THB', commissionPct: '0.157', minimum: '50', vatPct: '7', perOrder: '0' }
const bitkub: FeeTemplate = { currency: 'THB', commissionPct: '0.25', minimum: '0', vatPct: '0', perOrder: '0' }
const dime: FeeTemplate = { currency: 'USD', commissionPct: '0', minimum: '0', vatPct: '0', perOrder: '0' }

describe('feeTemplateSummary', () => {
  it('sums a formula up the way the settings mock does', () => {
    expect(feeTemplateSummary(streaming)).toBe('THB · 0.157% +\u00a0VAT\u00a07% · ขั้นต่ำ 50 บาท')
    expect(feeTemplateSummary(dime)).toBe('USD · ค่าคอม 0 ต่อคำสั่ง')
    expect(feeTemplateSummary(bitkub)).toBe('THB · 0.25% ต่อคำสั่ง')
    expect(feeTemplateSummary({ ...dime, perOrder: '0.99' })).toBe('USD · ค่าคอม 0.99 ต่อคำสั่ง')
  })

  it('says what a fixed fee per order is when there is a percentage as well', () => {
    expect(feeTemplateSummary({ currency: 'THB', commissionPct: '0.25', minimum: '10', vatPct: '7', perOrder: '5' })).toBe(
      'THB · 0.25% +\u00a05 ต่อคำสั่ง +\u00a0VAT\u00a07% · ขั้นต่ำ 10 บาท',
    )
    expect(feeTemplateSummary({ currency: 'THB', commissionPct: '0.25', minimum: '0', vatPct: '0', perOrder: '5' })).toBe(
      'THB · 0.25% +\u00a05 ต่อคำสั่ง',
    )
  })

  it('names a minimum in the currency of a foreign formula, and keeps the fixed fee per order beside it', () => {
    expect(feeTemplateSummary({ ...dime, commissionPct: '0.1', minimum: '1.5' })).toBe('USD · 0.1% · ขั้นต่ำ 1.5 USD')
    expect(feeTemplateSummary({ ...dime, minimum: '1', perOrder: '0.99' })).toBe('USD · ค่าคอม 0.99 ต่อคำสั่ง · ขั้นต่ำ 1 USD')
  })

  it('reads empty fields as zero', () => {
    expect(feeTemplateSummary({ currency: 'THB', commissionPct: '', minimum: '', vatPct: '', perOrder: '' })).toBe(
      'THB · ค่าคอม 0 ต่อคำสั่ง',
    )
  })

  it('never says per order more than once', () => {
    const values = ['0', '0.25', '5']
    for (const commissionPct of values) {
      for (const minimum of values) {
        for (const vatPct of values) {
          for (const perOrder of values) {
            const text = feeTemplateSummary({ currency: 'THB', commissionPct, minimum, vatPct, perOrder })
            expect(text.split('ต่อคำสั่ง').length - 1).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })
})

describe('where a summary may break', () => {
  it('keeps VAT with its rate, and a plus with what follows it, so no line ends on a plus', () => {
    const text = feeTemplateSummary({ currency: 'THB', commissionPct: '0.25', minimum: '10', vatPct: '7', perOrder: '5' })
    expect(text).toContain('+\u00a05')
    expect(text).toContain('+\u00a0VAT\u00a07%')
    expect(text.replace(/\u00a0/g, ' ')).toBe('THB · 0.25% + 5 ต่อคำสั่ง + VAT 7% · ขั้นต่ำ 10 บาท')
    expect(text).not.toMatch(/\+ /)
  })
})

describe('feeTemplateParts', () => {
  it('splits the minimum off so it can be kept on one line', () => {
    expect(feeTemplateParts(streaming)).toEqual({ body: 'THB · 0.157% +\u00a0VAT\u00a07%', minimum: '· ขั้นต่ำ 50 บาท' })
    expect(feeTemplateParts(bitkub)).toEqual({ body: 'THB · 0.25% ต่อคำสั่ง', minimum: '' })
    expect(feeTemplateParts({ ...dime, commissionPct: '0.1', minimum: '1.5' })).toEqual({ body: 'USD · 0.1%', minimum: '· ขั้นต่ำ 1.5 USD' })
  })
})

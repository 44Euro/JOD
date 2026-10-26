import { beforeEach, describe, expect, it } from 'vitest'
import { clearErrors, errorReport, logError, readErrors, resetErrorsForTests, scrub } from './log'

beforeEach(resetErrorsForTests)

describe('error log', () => {
  it('keeps the newest problems first, without amounts or record ids', () => {
    logError(new Error('ขาย 5 หน่วย แต่ถืออยู่ 1,234.50'), '#/assets/US%3AAAPL', new Date('2026-10-26T00:00:00Z'))
    logError('plain text', '#/transactions/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed')
    const [newest, older] = readErrors()
    expect(newest.message).toBe('Error: plain text')
    expect(newest.page).toBe('#/transactions/…')
    expect(older.message).toBe('Error: ขาย # หน่วย แต่ถืออยู่ #')
    expect(older.page).toBe('#/assets/…')
  })

  it('keeps at most fifty and can be cleared', () => {
    for (let i = 0; i < 60; i += 1) logError(new Error('x'))
    expect(readErrors()).toHaveLength(50)
    clearErrors()
    expect(readErrors()).toEqual([])
  })

  it('writes a plain report to pass on', () => {
    logError(new Error('boom'), '#/fx', new Date('2026-10-26T00:00:00Z'))
    const report = errorReport(readErrors(), 'TestBrowser')
    expect(report).toContain('Browser: TestBrowser')
    expect(report).toContain('[2026-10-26T00:00:00.000Z] #/fx')
    expect(report).toContain('Error: boom')
  })

  it('blanks every number', () => {
    expect(scrub('balance 12,000.5 THB on 2026-10-26')).toBe('balance # THB on #-#-#')
  })
})

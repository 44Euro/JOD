import { describe, expect, it } from 'vitest'
import { buildNotices } from './notices'

const base = { issuesCount: 0, unpricedCount: 0, staleCount: 0, missingRates: [], dueReviews: [], today: '2026-10-19' }

describe('buildNotices', () => {
  it('reminds to back up after thirty days', () => {
    expect(buildNotices({ ...base, lastBackupAt: '2026-09-19T08:00:00.000Z' })).toEqual([])
    expect(buildNotices({ ...base, lastBackupAt: '2026-09-18T08:00:00.000Z' }).map((n) => n.text)).toEqual(['ไม่ได้สำรองข้อมูลมา 31 วัน'])
  })

  it('asks for a first backup only once there is a month of data', () => {
    expect(buildNotices({ ...base, firstTxCreatedAt: '2026-09-25T00:00:00.000Z' })).toEqual([])
    expect(buildNotices({ ...base, firstTxCreatedAt: '2026-09-01T00:00:00.000Z' }).map((n) => [n.kind, n.text])).toEqual([
      ['backup', 'ยังไม่เคยสำรองข้อมูล'],
    ])
    expect(buildNotices(base)).toEqual([])
  })

  it('puts problems before reminders', () => {
    const kinds = buildNotices({
      ...base,
      issuesCount: 2,
      staleCount: 1,
      unpricedCount: 1,
      missingRates: ['JPY'],
      lastBackupAt: '2026-01-01T00:00:00.000Z',
      dueReviews: [{ id: 'US:VOO', symbol: 'VOO' }],
    }).map((n) => n.kind)
    expect(kinds).toEqual(['issues', 'backup', 'unpriced', 'stale', 'missing_rate', 'review'])
  })

  it('keeps the wording and links of the overview', () => {
    const notices = buildNotices({
      ...base,
      issuesCount: 2,
      unpricedCount: 3,
      staleCount: 1,
      missingRates: ['JPY', 'HKD'],
      lastBackupAt: '2026-01-01T00:00:00.000Z',
      dueReviews: [{ id: 'US:VOO', symbol: 'VOO' }],
    })
    expect(notices.map((n) => [n.tone, n.text, n.linkText, n.to])).toEqual([
      ['warning', 'มี 2 รายการที่คำนวณไม่ได้', 'ไปตรวจสอบ', '/transactions'],
      ['warning', 'ไม่ได้สำรองข้อมูลมา 291 วัน', 'สำรองตอนนี้', '/settings'],
      ['note', 'ยังไม่มีราคาล่าสุด 3 ตัว (นับที่ทุนไปก่อน)', 'กรอกราคา', '/portfolio'],
      ['note', 'ราคา 1 ตัวไม่ได้อัปเดตเกิน 7 วัน', 'อัปเดตราคา', '/portfolio'],
      ['note', 'ยังไม่มีเรทวันนี้ของ JPY, HKD · สินทรัพย์สกุลนี้นับที่ทุน และยังไม่รวมเงินสดสกุลนี้', '', ''],
      ['note', 'ถึงวันทบทวนเหตุผลที่ถือ VOO', 'เปิดดู', '/assets/US%3AVOO'],
    ])
    expect(new Set(notices.map((n) => n.id)).size).toBe(notices.length)
  })

  it('points to opening cash when an account that records cash is below zero', () => {
    const notices = buildNotices({ ...base, issuesCount: 1, negativeCashAccounts: ['Streaming', 'Dime'], lastBackupAt: '2026-01-01T00:00:00.000Z' })
    expect(notices.map((n) => n.kind)).toEqual(['issues', 'cash_gap', 'backup'])
    const gap = notices[1]
    expect([gap.tone, gap.text, gap.linkText, gap.to]).toEqual([
      'warning',
      'เงินสดของ Streaming, Dime ติดลบ · มักเกิดจากการซื้อขายก่อนเริ่มบันทึกเงินสด',
      'กรอกยอดยกมาเงินสด',
      '/transactions/new?type=opening',
    ])
  })
})

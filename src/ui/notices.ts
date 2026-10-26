import { priceAgeDays } from '../domain/dates'
import { assetPath } from './nav'
import { t } from '../i18n'

export type NoticeKind = 'issues' | 'cash_gap' | 'backup' | 'unpriced' | 'stale' | 'missing_rate' | 'review'

export interface Notice {
  id: string
  kind: NoticeKind
  tone: 'warning' | 'note'
  text: string
  to: string
  linkText: string
}

export const BACKUP_REMIND_DAYS = 30

export interface NoticeInput {
  issuesCount: number
  // Accounts that record cash but whose balance is below zero in some currency.
  negativeCashAccounts?: readonly string[]
  lastBackupAt?: string
  firstTxCreatedAt?: string
  unpricedCount: number
  staleCount: number
  missingRates: readonly string[]
  dueReviews: readonly { id: string; symbol: string }[]
  today: string
}

// Everything is kept on this device, so a user who never backs up loses it all with the browser's data (spec 5.8).
function backupNotice({ lastBackupAt, firstTxCreatedAt, today }: NoticeInput): Notice | null {
  const link = { id: 'backup', kind: 'backup', tone: 'warning', to: '/settings', linkText: t('สำรองตอนนี้') } as const
  const sinceBackup = priceAgeDays(lastBackupAt, today)
  if (sinceBackup !== null) {
    return sinceBackup > BACKUP_REMIND_DAYS ? { ...link, text: t('ไม่ได้สำรองข้อมูลมา {0} วัน', sinceBackup) } : null
  }
  const sinceFirst = priceAgeDays(firstTxCreatedAt, today)
  return sinceFirst !== null && sinceFirst > BACKUP_REMIND_DAYS ? { ...link, text: t('ยังไม่เคยสำรองข้อมูล') } : null
}

export function buildNotices(input: NoticeInput): Notice[] {
  const notices: Notice[] = []
  if (input.issuesCount > 0) {
    notices.push({
      id: 'issues',
      kind: 'issues',
      tone: 'warning',
      text: t('มี {0} รายการที่คำนวณไม่ได้', input.issuesCount),
      to: '/transactions',
      linkText: t('ไปตรวจสอบ'),
    })
  }
  const short = input.negativeCashAccounts ?? []
  if (short.length > 0) {
    // Usually trades recorded from before the app was used: the cash the account had then was never entered.
    notices.push({
      id: 'cash_gap',
      kind: 'cash_gap',
      tone: 'warning',
      text: t('เงินสดของ {0} ติดลบ · มักเกิดจากการซื้อขายก่อนเริ่มบันทึกเงินสด', short.join(', ')),
      to: '/transactions/new?type=opening',
      linkText: t('กรอกยอดยกมาเงินสด'),
    })
  }
  const backup = backupNotice(input)
  if (backup) notices.push(backup)
  if (input.unpricedCount > 0) {
    notices.push({
      id: 'unpriced',
      kind: 'unpriced',
      tone: 'note',
      text: t('ยังไม่มีราคาล่าสุด {0} ตัว (นับที่ทุนไปก่อน)', input.unpricedCount),
      to: '/portfolio',
      linkText: t('กรอกราคา'),
    })
  }
  if (input.staleCount > 0) {
    notices.push({
      id: 'stale',
      kind: 'stale',
      tone: 'note',
      text: t('ราคา {0} ตัวไม่ได้อัปเดตเกิน 7 วัน', input.staleCount),
      to: '/portfolio',
      linkText: t('อัปเดตราคา'),
    })
  }
  if (input.missingRates.length > 0) {
    notices.push({
      id: 'missing_rate',
      kind: 'missing_rate',
      tone: 'note',
      text: t('ยังไม่มีเรทวันนี้ของ {0} · สินทรัพย์สกุลนี้นับที่ทุน และยังไม่รวมเงินสดสกุลนี้', input.missingRates.join(', ')),
      to: '',
      linkText: '',
    })
  }
  for (const review of input.dueReviews) {
    notices.push({
      id: `review:${review.id}`,
      kind: 'review',
      tone: 'note',
      text: t('ถึงวันทบทวนเหตุผลที่ถือ {0}', review.symbol),
      to: assetPath(review.id),
      linkText: t('เปิดดู'),
    })
  }
  return notices
}

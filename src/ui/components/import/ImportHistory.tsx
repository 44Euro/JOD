import { useLiveQuery } from 'dexie-react-hooks'
import { Undo2 } from 'lucide-react'
import { useState } from 'react'
import { Alert } from '../../../components/ui/alert'
import { Card } from '../../../components/ui/card'
import { db } from '../../../db/db'
import { undoImport } from '../../../db/repo'
import { todayLocal } from '../../../domain/dates'
import type { Account, ImportSource } from '../../../domain/types'
import { fmtDate } from '../../format'

export const IMPORT_SOURCE_LABELS: Record<ImportSource, string> = {
  portfolio: 'รูปหน้าพอร์ต',
  orders: 'ประวัติคำสั่ง',
  income: 'ปันผลและดอกเบี้ย',
  statement: 'statement',
  other: 'ไฟล์',
}

export function ImportHistory({ accounts }: { accounts: readonly Account[] }) {
  const batches = useLiveQuery(() => db.imports.orderBy('createdAt').reverse().toArray(), [])
  const [message, setMessage] = useState('')
  if (!batches || batches.length === 0) return null
  const names = new Map(accounts.map((a) => [a.id, a.name]))

  async function undo(id: string, count: number) {
    if (!window.confirm(`ยกเลิกการนำเข้าครั้งนี้? รายการที่นำเข้า ${count} รายการจะถูกลบ`)) return
    const removed = await undoImport(db, id)
    setMessage(`ลบ ${removed} รายการจากการนำเข้าครั้งนั้นแล้ว`)
  }

  return (
    <Card className="grid gap-3">
      <h2 className="text-lg font-semibold">ประวัติการนำเข้า</h2>
      {message && <Alert tone="ok">{message}</Alert>}
      <ul>
        {batches.map((batch) => (
          <li
            key={batch.id}
            className="grid gap-x-4 gap-y-0.5 border-t border-muted py-3 first:border-t-0 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <span className="min-w-0">
              <span className="block">
                {fmtDate(todayLocal(new Date(batch.createdAt)))} · {names.get(batch.accountId) ?? 'บัญชีที่ลบไปแล้ว'}
              </span>
              <span className="block text-[12.5px] text-muted-foreground">
                {IMPORT_SOURCE_LABELS[batch.source]} {batch.fileCount} ไฟล์ · {batch.count} รายการ
              </span>
            </span>
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-[13.5px] font-semibold text-primary-ink underline-offset-[3px] hover:underline"
              onClick={() => void undo(batch.id, batch.count)}
            >
              <Undo2 className="size-4" aria-hidden />
              ยกเลิกการนำเข้าครั้งนี้
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

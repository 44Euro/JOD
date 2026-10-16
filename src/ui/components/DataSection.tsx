import { Download, FileSpreadsheet, ShieldCheck, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Alert } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { BackupError, exportBackup, parseBackup, restoreBackup, transactionsToCsv } from '../../db/backup'
import { db } from '../../db/db'
import { saveSettings } from '../../db/repo'
import { daysBetween, todayLocal } from '../../domain/dates'
import { downloadText } from '../download'
import { fmtDate } from '../format'
import type { AppData } from '../hooks'
import { ensurePersistentStorage, type StorageStatus } from '../storage'

const REMIND_AFTER_DAYS = 7

const STORAGE_LABELS: Record<StorageStatus, string> = {
  persisted: 'เบราว์เซอร์จะไม่ลบข้อมูลนี้เอง',
  'not-persisted': 'เบราว์เซอร์อาจลบข้อมูลเมื่อพื้นที่เต็ม · ควรสำรองข้อมูลเป็นประจำ',
  unsupported: 'เบราว์เซอร์นี้ไม่รองรับการป้องกันการลบข้อมูล · ควรสำรองข้อมูลเป็นประจำ',
}

export function DataSection({ data }: { data: AppData }) {
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [storage, setStorage] = useState<StorageStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void ensurePersistentStorage().then((status) => {
      if (!cancelled) setStorage(status)
    })
    return () => {
      cancelled = true
    }
  }, [])
  const lastBackup = data.settings.lastBackupAt
  const age = lastBackup ? daysBetween(lastBackup.slice(0, 10), todayLocal()) : null
  const needsBackup = data.transactions.length > 0 && (age === null || age > REMIND_AFTER_DAYS)

  async function handleExport() {
    const backup = await exportBackup(db)
    downloadText(`jod-backup-${todayLocal()}.json`, JSON.stringify(backup, null, 2), 'application/json')
    await saveSettings(db, { ...data.settings, lastBackupAt: backup.exportedAt })
    setMessage({ tone: 'ok', text: 'สำรองข้อมูลแล้ว' })
  }

  function handleCsv() {
    const csv = transactionsToCsv(data.transactions, data.accounts, data.settings.baseCurrency)
    downloadText(`jod-transactions-${todayLocal()}.csv`, csv, 'text/csv;charset=utf-8')
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const backup = parseBackup(await file.text())
      const count = backup.data.transactions.length
      if (!window.confirm(`กู้คืนจากไฟล์นี้จะแทนที่ข้อมูลทั้งหมดในเครื่อง (ในไฟล์มี ${count} รายการ) ต่อไหม?`)) return
      await restoreBackup(db, backup)
      setMessage({ tone: 'ok', text: `กู้คืนแล้ว ${count} รายการ` })
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof BackupError ? error.message : 'กู้คืนไม่สำเร็จ ข้อมูลเดิมยังอยู่ครบ',
      })
    }
  }

  return (
    <Card className="grid gap-3">
      <div>
        <h2 className="text-lg font-semibold">ข้อมูลของคุณ</h2>
        <p className="text-[12.5px] text-muted-foreground">ข้อมูลทั้งหมดอยู่ในเครื่องนี้เท่านั้น ควรสำรองเป็นไฟล์อย่างสม่ำเสมอ</p>
      </div>
      {needsBackup ? (
        <Alert role="note">{lastBackup ? `สำรองล่าสุด ${fmtDate(lastBackup)} · ${age} วันก่อน` : 'ยังไม่เคยสำรองข้อมูล'}</Alert>
      ) : (
        lastBackup && <p className="text-sm text-muted-foreground">สำรองล่าสุด {fmtDate(lastBackup)}</p>
      )}
      {message &&
        (message.tone === 'error' ? (
          <Alert tone="error">{message.text}</Alert>
        ) : (
          <p role="status" className="text-sm font-semibold text-gain">
            {message.text}
          </p>
        ))}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void handleExport()}>
          <Download aria-hidden />
          สำรองข้อมูล
        </Button>
        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload aria-hidden />
          กู้คืนจากไฟล์
        </Button>
        <Button type="button" variant="outline" onClick={handleCsv}>
          <FileSpreadsheet aria-hidden />
          ส่งออก CSV สำหรับ Excel
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="เลือกไฟล์สำรอง"
          onChange={(e) => void handleImport(e)}
        />
      </div>
      {storage === 'persisted' ? (
        <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          <Badge variant="ok">
            <ShieldCheck aria-hidden />
            ป้องกันแล้ว
          </Badge>
          {STORAGE_LABELS.persisted}
        </p>
      ) : (
        storage && <p className="text-[12.5px] text-warning-fg">{STORAGE_LABELS[storage]}</p>
      )}
    </Card>
  )
}

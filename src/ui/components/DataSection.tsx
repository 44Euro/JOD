import { Download, FileSpreadsheet, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Alert } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { BackupError, exportBackup, parseBackup, restoreBackup, transactionsToCsv } from '../../db/backup'
import { db } from '../../db/db'
import { removeSampleData, saveSettings } from '../../db/repo'
import { hasSampleData } from '../../db/sampleData'
import { daysBetween, todayLocal } from '../../domain/dates'
import { downloadText } from '../download'
import { fmtDate } from '../format'
import type { AppData } from '../hooks'
import { asEncrypted, decryptText, DecryptError, encryptText, type EncryptedFile } from '../../security/crypto'
import { ensurePersistentStorage, type StorageStatus } from '../storage'
import { t } from '../../i18n'

const REMIND_AFTER_DAYS = 7

const STORAGE_LABELS: Record<StorageStatus, string> = {
  persisted: t('เบราว์เซอร์จะไม่ลบข้อมูลนี้เอง'),
  'not-persisted': t('เบราว์เซอร์อาจลบข้อมูลเมื่อพื้นที่เต็ม'),
  unsupported: t('เบราว์เซอร์นี้กันข้อมูลไม่ให้ถูกลบไม่ได้'),
}

export function DataSection({ data }: { data: AppData }) {
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [storage, setStorage] = useState<StorageStatus | null>(null)
  const [seal, setSeal] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [sealed, setSealed] = useState<EncryptedFile | null>(null)
  const [openWith, setOpenWith] = useState('')

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
    if (seal && passphrase.length < 8) {
      setMessage({ tone: 'error', text: t('รหัสผ่านไฟล์สำรองต้องยาวอย่างน้อย 8 ตัวอักษร') })
      return
    }
    const backup = await exportBackup(db)
    const text = JSON.stringify(backup, null, 2)
    if (seal) downloadText(`jod-backup-${todayLocal()}-locked.json`, JSON.stringify(await encryptText(text, passphrase)), 'application/json')
    else downloadText(`jod-backup-${todayLocal()}.json`, text, 'application/json')
    await saveSettings(db, { ...data.settings, lastBackupAt: backup.exportedAt })
    setMessage({ tone: 'ok', text: t('สำรองข้อมูลแล้ว') })
  }

  async function handleRemoveSample() {
    if (!window.confirm(t('ลบข้อมูลตัวอย่างทั้งหมด? ข้อมูลที่คุณบันทึกเองจะอยู่ครบ'))) return
    await removeSampleData(db)
    setMessage({ tone: 'ok', text: t('ลบข้อมูลตัวอย่างแล้ว') })
  }

  function handleCsv() {
    const csv = transactionsToCsv(data.transactions, data.accounts, data.settings.baseCurrency)
    downloadText(`jod-transactions-${todayLocal()}.csv`, csv, 'text/csv;charset=utf-8')
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const text = await file.text()
    let locked: EncryptedFile | null = null
    try {
      locked = asEncrypted(JSON.parse(text))
    } catch {
      // parseBackup says what is wrong with a file that is not JSON.
    }
    if (locked) {
      setSealed(locked)
      setMessage(null)
      return
    }
    await restore(text)
  }

  async function openSealed() {
    if (!sealed) return
    try {
      const text = await decryptText(sealed, openWith)
      setSealed(null)
      setOpenWith('')
      await restore(text)
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof DecryptError ? error.message : t('เปิดไฟล์ไม่สำเร็จ') })
    }
  }

  async function restore(text: string) {
    try {
      const backup = parseBackup(text)
      const count = backup.data.transactions.length
      if (!window.confirm(t('กู้คืนจากไฟล์นี้จะแทนที่ข้อมูลทั้งหมดในเครื่อง (ในไฟล์มี {0} รายการ) ต่อไหม?', count))) return
      await restoreBackup(db, backup)
      setMessage({ tone: 'ok', text: t('กู้คืนแล้ว {0} รายการ', count) })
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof BackupError ? error.message : t('กู้คืนไม่สำเร็จ ข้อมูลเดิมยังอยู่ครบ'),
      })
    }
  }

  return (
    <Card className="grid gap-3">
      <div>
        <h2 className="text-lg font-semibold">{t('ข้อมูลในเครื่อง')}</h2>
        <p className="text-[13px] text-muted-foreground">{t('สำรองเป็นไฟล์ไว้เป็นระยะ')}</p>
      </div>
      {needsBackup ? (
        <Alert role="note">{lastBackup ? t('สำรองล่าสุด {0} · {1} วันก่อน', fmtDate(lastBackup), age) : t('ยังไม่เคยสำรองข้อมูล')}</Alert>
      ) : (
        lastBackup && <p className="text-sm text-muted-foreground">{t('สำรองล่าสุด ')}{fmtDate(lastBackup)}</p>
      )}
      {message &&
        (message.tone === 'error' ? (
          <Alert tone="error">{message.text}</Alert>
        ) : (
          <p role="status" className="text-sm font-semibold text-gain">
            {message.text}
          </p>
        ))}
      {sealed && (
        <form
          className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            void openSealed()
          }}
        >
          <Field id="open-passphrase" label={t('ไฟล์นี้เข้ารหัสไว้ · ใส่รหัสผ่าน')}>
            <Input id="open-passphrase" type="password" autoComplete="off" value={openWith} onChange={(e) => setOpenWith(e.target.value)} />
          </Field>
          <Button type="submit" className="h-12" disabled={!openWith}>
            {t('เปิดไฟล์')}
          </Button>
        </form>
      )}
      <label className="flex min-h-11 items-center gap-2.5 text-sm">
        <input type="checkbox" className="size-5 accent-primary" checked={seal} onChange={(e) => setSeal(e.target.checked)} />
        {t('เข้ารหัสไฟล์สำรองด้วยรหัสผ่าน')}
      </label>
      {seal && (
        <Field id="seal-passphrase" label={t('รหัสผ่านไฟล์สำรอง')} hint={t('อย่างน้อย 8 ตัวอักษร ลืมรหัสผ่านแล้วจะเปิดไฟล์นี้ไม่ได้อีก')}>
          <Input id="seal-passphrase" type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
        </Field>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void handleExport()}>
          <Download aria-hidden />
          {t('สำรองข้อมูล')}
        </Button>
        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload aria-hidden />
          {t('กู้คืนจากไฟล์')}
        </Button>
        <Button type="button" variant="outline" onClick={handleCsv}>
          <FileSpreadsheet aria-hidden />
          {t('ส่งออก CSV สำหรับ Excel')}
        </Button>
        {hasSampleData(data.accounts) && (
          <Button type="button" variant="outline" onClick={() => void handleRemoveSample()}>
            <Trash2 aria-hidden />
            {t('ลบข้อมูลตัวอย่าง')}
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label={t('เลือกไฟล์สำรอง')}
          onChange={(e) => void handleImport(e)}
        />
      </div>
      {storage === 'persisted' ? (
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          <Badge variant="ok">
            <ShieldCheck aria-hidden />
            {t('ป้องกันแล้ว')}
          </Badge>
          {STORAGE_LABELS.persisted}
        </p>
      ) : (
        storage && <p className="text-[13px] text-warning-fg">{STORAGE_LABELS[storage]}</p>
      )}
    </Card>
  )
}

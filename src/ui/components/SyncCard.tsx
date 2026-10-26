import { useState } from 'react'
import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { db } from '../../db/db'
import { t } from '../../i18n'
import { SyncError } from '../../sync/client'
import { syncNow, type SyncOutcome } from '../../sync/engine'
import { deleteAccount, keepSide, serverClient, signOut } from '../../sync/session'
import { useDirty, useSyncState } from '../../sync/state'
import { fmtDate } from '../format'

function describe(outcome: SyncOutcome): string {
  if (outcome.kind === 'pushed') return t('ส่งข้อมูลจากเครื่องนี้ขึ้นแล้ว')
  if (outcome.kind === 'pulled') return t('รับข้อมูลจากเครื่องอื่นมาแล้ว')
  if (outcome.kind === 'up-to-date') return t('ข้อมูลตรงกันแล้ว')
  return ''
}

export function SyncCard() {
  const state = useSyncState()
  const dirty = useDirty()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [conflict, setConflict] = useState(false)
  const [unsent, setUnsent] = useState(false)

  async function run(work: () => Promise<void>) {
    setBusy(true)
    setMessage(null)
    try {
      await work()
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof SyncError ? error.message : t('ซิงก์ไม่สำเร็จ ลองใหม่อีกครั้ง') })
    } finally {
      setBusy(false)
    }
  }

  function show(outcome: SyncOutcome) {
    setConflict(outcome.kind === 'conflict')
    if (outcome.kind !== 'conflict') setMessage({ tone: 'ok', text: describe(outcome) })
  }

  if (!state) return null

  return (
    <Card className="grid gap-3">
      <h2 className="text-lg font-semibold">{t('บัญชีและการซิงก์')}</h2>
      <p className="text-sm">
        {state.email}
        <span className="block text-[12.5px] text-muted-foreground">
          {state.syncedAt ? t('ซิงก์ล่าสุด {0}', fmtDate(state.syncedAt.slice(0, 10))) : t('ยังไม่เคยซิงก์')}
          {dirty && ` · ${t('มีการแก้ไขที่ยังไม่ได้ส่ง')}`}
        </span>
      </p>
      {conflict && (
        <Alert>
          {t('ทั้งเครื่องนี้และเครื่องอื่นแก้ข้อมูลตั้งแต่ซิงก์ครั้งก่อน เลือกว่าจะเก็บของฝั่งไหน อีกฝั่งจะถูกแทนที่')}
          <span className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void run(async () => show(await keepSide('device')))}>
              {t('ใช้ของเครื่องนี้')}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => show(await keepSide('server')))}>
              {t('ใช้ของบนเซิร์ฟเวอร์')}
            </Button>
          </span>
        </Alert>
      )}
      {unsent && (
        <Alert tone="error">
          {t('ส่งการแก้ไขล่าสุดขึ้นเซิร์ฟเวอร์ไม่ได้ ถ้าออกจากระบบตอนนี้ ส่วนที่ยังไม่ได้ส่งจะหายจากเครื่องนี้')}
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void signOut(true)}>
            {t('ออกจากระบบและทิ้งส่วนที่ยังไม่ได้ส่ง')}
          </Button>
        </Alert>
      )}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => void run(async () => show(await syncNow(db, serverClient())))}>
          {busy ? t('กำลังซิงก์…') : t('ซิงก์ตอนนี้')}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => setUnsent((await signOut()) === 'unsent'))}>
          {t('ออกจากระบบ')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (!window.confirm(t('ลบบัญชีและข้อมูลทั้งหมด ทั้งบนเซิร์ฟเวอร์และในเครื่องนี้? ย้อนกลับไม่ได้'))) return
              await deleteAccount()
            })
          }
        >
          {t('ลบบัญชี')}
        </Button>
      </div>
      <p className="text-[12px] text-muted-foreground">
        {t('ออกจากระบบจะซิงก์ก่อนแล้วล้างข้อมูลในเครื่องนี้ เข้าใหม่แล้วข้อมูลจะกลับมา · รูปประกอบเทรดไม่ถูกซิงก์')}
      </p>
    </Card>
  )
}

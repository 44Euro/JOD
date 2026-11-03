import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { db } from '../../db/db'
import { t } from '../../i18n'
import { SyncError } from '../../sync/client'
import { syncNow, type SyncOutcome } from '../../sync/engine'
import { deleteAccount, renewRecoveryCode, serverClient, signOut } from '../../sync/session'
import { useDirty, useSyncState } from '../../sync/state'
import { fmtDate } from '../format'
import { PasswordResetForm } from './PasswordResetForm'

function describe(outcome: SyncOutcome): string {
  if (outcome.kind === 'pushed') return t('ส่ง {0} รายการจากเครื่องนี้ขึ้นแล้ว', outcome.count)
  if (outcome.kind === 'pulled') return t('รับ {0} รายการจากเครื่องอื่นมาแล้ว', outcome.count)
  return t('ข้อมูลตรงกันแล้ว')
}

export function SyncCard() {
  const state = useSyncState()
  const dirty = useDirty()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [unsent, setUnsent] = useState(false)
  // A reset link opened on a signed-in device lands here with its code.
  const [params] = useSearchParams()
  const linkCode = params.get('code') ?? ''
  const [resetting, setResetting] = useState(Boolean(linkCode))

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
    setMessage({ tone: 'ok', text: describe(outcome) })
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
        {t('ออกจากระบบจะซิงก์ก่อนแล้วล้างข้อมูลในเครื่องนี้ เข้าใหม่แล้วข้อมูลจะกลับมา')}
      </p>
      <div className="grid gap-3 border-t pt-4">
        <div>
          <h3 className="text-[15px] font-semibold">{t('รหัสผ่านและรหัสกู้คืน')}</h3>
          <p className="text-[12.5px] text-muted-foreground">{t('ตั้งรหัสผ่านใหม่ด้วยรหัสที่ส่งไปที่อีเมล ข้อมูลในบัญชีอยู่ครบ')}</p>
        </div>
        {resetting ? (
          <PasswordResetForm
            email={state.email}
            code={linkCode}
            onDone={() => {
              setResetting(false)
              setMessage({ tone: 'ok', text: t('ตั้งรหัสผ่านใหม่แล้ว เครื่องอื่นต้องเข้าสู่ระบบด้วยรหัสใหม่') })
            }}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setResetting(true)}>
              {t('ตั้งรหัสผ่านใหม่')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!window.confirm(t('สร้างรหัสกู้คืนใหม่? รหัสเดิมจะใช้ไม่ได้อีก'))) return
                  await renewRecoveryCode()
                })
              }
            >
              {t('สร้างรหัสกู้คืนใหม่')}
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}

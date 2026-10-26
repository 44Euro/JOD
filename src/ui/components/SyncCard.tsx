import { useState, type FormEvent } from 'react'
import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { db } from '../../db/db'
import { t } from '../../i18n'
import { createSyncClient, SyncError } from '../../sync/client'
import { deriveKeys, resolveConflict, syncNow, type SyncOutcome } from '../../sync/engine'
import { useDirty, useSyncState, writeSync } from '../../sync/state'
import { fmtDate } from '../format'

export const DEFAULT_SYNC_SERVER = 'http://localhost:8787'

function describe(outcome: SyncOutcome): string {
  if (outcome.kind === 'pushed') return t('ส่งข้อมูลจากเครื่องนี้ขึ้นแล้ว')
  if (outcome.kind === 'pulled') return t('รับข้อมูลจากเครื่องอื่นมาแล้ว')
  if (outcome.kind === 'up-to-date') return t('ข้อมูลตรงกันแล้ว')
  return ''
}

export function SyncCard() {
  const state = useSyncState()
  const dirty = useDirty()
  const [server, setServer] = useState(state?.server ?? DEFAULT_SYNC_SERVER)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [conflict, setConflict] = useState(false)

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

  async function signIn(mode: 'signup' | 'login', event?: FormEvent) {
    event?.preventDefault()
    await run(async () => {
      if (password.length < 10) throw new SyncError(0, t('รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร'))
      const keys = await deriveKeys(email, password)
      const client = createSyncClient(server)
      const token = mode === 'signup' ? await client.signup(email.trim(), keys.loginKey) : await client.login(email.trim(), keys.loginKey)
      writeSync({ server, email: email.trim().toLowerCase(), token, dataKey: keys.dataKey, version: 0, syncedAt: null })
      setPassword('')
      show(await syncNow(db, client))
    })
  }

  if (!state) {
    return (
      <Card className="grid gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('ซิงก์หลายเครื่อง')}</h2>
          <p className="text-[12.5px] text-muted-foreground">
            {t('ใช้บัญชีเดียวกันในหลายเครื่อง · ข้อมูลถูกเข้ารหัสด้วยรหัสผ่านของคุณก่อนส่ง เซิร์ฟเวอร์อ่านไม่ได้ · ลืมรหัสผ่านแล้วกู้ข้อมูลบนเซิร์ฟเวอร์ไม่ได้ ควรสำรองไฟล์ไว้ด้วย')}
          </p>
        </div>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => void signIn('login', e)}>
          <Field id="sync-server" label={t('เซิร์ฟเวอร์ซิงก์')} className="sm:col-span-2" hint={t('ของคุณเอง รันด้วย npm run sync-server')}>
            <Input id="sync-server" value={server} onChange={(e) => setServer(e.target.value)} />
          </Field>
          <Field id="sync-email" label={t('อีเมล')}>
            <Input id="sync-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field id="sync-password" label={t('รหัสผ่าน')}>
            <Input id="sync-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {message && (
            <Alert tone={message.tone} className="sm:col-span-2">
              {message.text}
            </Alert>
          )}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" disabled={busy || !email || !password}>
              {t('เข้าสู่ระบบ')}
            </Button>
            <Button type="button" variant="outline" disabled={busy || !email || !password} onClick={() => void signIn('signup')}>
              {t('สมัครบัญชีใหม่')}
            </Button>
          </div>
        </form>
      </Card>
    )
  }

  const client = createSyncClient(state.server)
  return (
    <Card className="grid gap-3">
      <h2 className="text-lg font-semibold">{t('ซิงก์หลายเครื่อง')}</h2>
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
            <Button type="button" size="sm" disabled={busy} onClick={() => void run(async () => show(await resolveConflict(db, client, 'device')))}>
              {t('ใช้ของเครื่องนี้')}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => show(await resolveConflict(db, client, 'server')))}>
              {t('ใช้ของบนเซิร์ฟเวอร์')}
            </Button>
          </span>
        </Alert>
      )}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => void run(async () => show(await syncNow(db, client)))}>
          {busy ? t('กำลังซิงก์…') : t('ซิงก์ตอนนี้')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            void client.logout(state.token)
            writeSync(null)
          }}
        >
          {t('ออกจากระบบ')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            void run(async () => {
              if (!window.confirm(t('ลบบัญชีและข้อมูลทั้งหมดบนเซิร์ฟเวอร์? ข้อมูลในเครื่องนี้ยังอยู่'))) return
              await client.deleteAccount(state.token)
              writeSync(null)
            })
          }
        >
          {t('ลบบัญชีบนเซิร์ฟเวอร์')}
        </Button>
      </div>
      <p className="text-[12px] text-muted-foreground">{t('รูปประกอบเทรดไม่ถูกซิงก์ · ซิงก์เองเมื่อเปิดแอปและหลังแก้ข้อมูล')}</p>
    </Card>
  )
}

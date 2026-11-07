import { KeyRound, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Field } from '../../components/ui/field'
import { t } from '../../i18n'
import { SyncError } from '../../sync/client'
import { MIN_PASSWORD, RecoveryCodeError, requestPasswordReset, resetPassword } from '../../sync/session'
import { useSyncState } from '../../sync/state'
import { IconInput } from './IconInput'

function messageOf(error: unknown): string {
  if (error instanceof SyncError || error instanceof RecoveryCodeError) return error.message
  return t('ตั้งรหัสผ่านใหม่ไม่สำเร็จ ลองใหม่อีกครั้ง')
}

// Two steps: send a code to the email, then the code and a new password. A device still signed in to the account
// keeps the data by itself; anywhere else the recovery code opens it, or the person chooses to start again.
export function PasswordResetForm({ email: givenEmail = '', code: givenCode = '', onDone }: { email?: string; code?: string; onDone?: () => void }) {
  const session = useSyncState()
  const [email, setEmail] = useState(givenEmail || session?.email || '')
  const [sent, setSent] = useState(Boolean(givenCode))
  const [code, setCode] = useState(givenCode)
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [recovery, setRecovery] = useState('')
  const [fresh, setFresh] = useState(false)
  const [freshAgreed, setFreshAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const signedInHere = session?.email === email.trim().toLowerCase()

  async function send(event?: FormEvent) {
    event?.preventDefault()
    setError('')
    setBusy(true)
    try {
      await requestPasswordReset(email)
      setSent(true)
      setNotice(t('ถ้ามีบัญชีของอีเมลนี้ รหัสจะส่งไปภายในไม่กี่นาที ใช้ได้ 30 นาที'))
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  async function reset(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (password.length < MIN_PASSWORD) return setError(t('รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร'))
    if (password !== again) return setError(t('รหัสผ่านสองช่องไม่ตรงกัน'))
    if (fresh && !freshAgreed) return setError(t('ยืนยันก่อนว่าเข้าใจว่าข้อมูลบนเซิร์ฟเวอร์จะหาย'))
    setBusy(true)
    try {
      await resetPassword({ email, code, password, recoveryCode: signedInHere || fresh ? undefined : recovery, fresh })
      onDone?.()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  if (!sent) {
    return (
      <form className="grid gap-4" onSubmit={(e) => void send(e)}>
        <Field id="reset-email" label={t('อีเมล')}>
          <IconInput
            id="reset-email"
            icon={Mail}
            type="email"
            autoComplete="username"
            placeholder={t('ใส่อีเมลของคุณ')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" className="h-12 w-full text-base" disabled={busy || !email}>
          {busy ? t('กำลังส่ง…') : t('ส่งรหัสไปที่อีเมล')}
        </Button>
      </form>
    )
  }

  return (
    <form className="grid gap-4" onSubmit={(e) => void reset(e)}>
      {notice && <Alert>{notice}</Alert>}
      <Field id="reset-code" label={t('รหัสจากอีเมล')} hint={t('ส่งไปที่ {0}', email.trim().toLowerCase())}>
        <IconInput
          id="reset-code"
          icon={KeyRound}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="XXXX-XXXX"
          className="font-mono tracking-[0.12em] uppercase"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </Field>
      <Field id="reset-password" label={t('รหัสผ่านใหม่')} hint={t('อย่างน้อย 10 ตัวอักษร')}>
        <IconInput
          id="reset-password"
          icon={LockKeyhole}
          type="password"
          reveal
          autoComplete="new-password"
          placeholder={t('ใส่รหัสผ่านใหม่')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Field id="reset-password-again" label={t('รหัสผ่านใหม่อีกครั้ง')}>
        <IconInput
          id="reset-password-again"
          icon={LockKeyhole}
          type="password"
          reveal
          autoComplete="new-password"
          placeholder={t('ใส่รหัสผ่านใหม่อีกครั้ง')}
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
      </Field>
      {signedInHere ? (
        <p className="text-[13px] text-muted-foreground">{t('เครื่องนี้ยังเข้าบัญชีอยู่ ข้อมูลทั้งหมดจะอยู่ครบหลังเปลี่ยนรหัสผ่าน')}</p>
      ) : fresh ? (
        <Alert tone="error">
          {t('ตั้งรหัสผ่านใหม่โดยไม่มีรหัสกู้คืน ข้อมูลที่ซิงก์ไว้บนเซิร์ฟเวอร์จะถูกลบ และบัญชีจะเริ่มใหม่ว่างเปล่า ถ้ายังมีเครื่องอื่นที่เข้าแอปได้ ให้ตั้งรหัสใหม่จากเครื่องนั้นแทน')}
          <label className="mt-2 flex min-h-11 items-center gap-2.5 font-semibold">
            <input type="checkbox" className="size-5 accent-destructive" checked={freshAgreed} onChange={(e) => setFreshAgreed(e.target.checked)} />
            {t('ฉันเข้าใจ เริ่มบัญชีใหม่')}
          </label>
          <button type="button" className="min-h-11 text-sm font-semibold underline underline-offset-[3px]" onClick={() => setFresh(false)}>
            {t('ฉันมีรหัสกู้คืน')}
          </button>
        </Alert>
      ) : (
        <Field id="reset-recovery" label={t('รหัสกู้คืน')} hint={t('รหัส 20 ตัวที่จดไว้ตอนสมัคร ใช้เปิดข้อมูลเดิมบนเครื่องนี้')}>
          <IconInput
            id="reset-recovery"
            icon={ShieldCheck}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
            className="font-mono tracking-[0.06em] uppercase"
            value={recovery}
            onChange={(e) => setRecovery(e.target.value)}
          />
        </Field>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" className="h-12 w-full text-base" disabled={busy || !code || !password}>
        {busy ? t('กำลังตั้งรหัสผ่าน…') : t('ตั้งรหัสผ่านใหม่')}
      </Button>
      <div className="flex flex-wrap justify-between gap-x-4 text-sm">
        <button type="button" className="min-h-11 font-semibold text-primary-ink" disabled={busy} onClick={() => void send()}>
          {t('ส่งรหัสอีกครั้ง')}
        </button>
        {!signedInHere && !fresh && (
          <button type="button" className="min-h-11 font-semibold text-primary-ink" onClick={() => setFresh(true)}>
            {t('ไม่มีรหัสกู้คืน?')}
          </button>
        )}
      </div>
    </form>
  )
}

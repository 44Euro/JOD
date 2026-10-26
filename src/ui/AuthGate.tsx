import { Fingerprint, Lock } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router'
import { Alert } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Field } from '../components/ui/field'
import { Input } from '../components/ui/input'
import { Segmented } from '../components/ui/segmented'
import { t } from '../i18n'
import { hasBiometrics, noteVisibility, PIN_LENGTH, setPin, unlockWithBiometrics, unlockWithPin, useLockState, validPin } from '../security/lock'
import { SyncError } from '../sync/client'
import type { SyncOutcome } from '../sync/engine'
import { authBypassed, keepSide, MIN_PASSWORD, signIn, signOut } from '../sync/session'
import { useSyncState } from '../sync/state'
import { ThemeSync } from './theme'

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh content-start justify-items-center bg-background px-4 pt-12 pb-10 md:place-content-center">
      <ThemeSync />
      <main className="grid w-full max-w-sm gap-5">
        <p className="font-display text-[30px] font-semibold leading-none">
          JOD
          <span className="mt-1 block font-sans text-xs font-normal text-muted-foreground">{t('จดทุกเทรด รู้ทุกบาท')}</span>
        </p>
        {children}
      </main>
    </div>
  )
}

// One field for the whole PIN, sent as soon as the last digit is typed.
function PinField({ label, onComplete, disabled }: { label: string; onComplete: (pin: string) => void; disabled?: boolean }) {
  const [pin, setPinValue] = useState('')
  return (
    <Input
      aria-label={label}
      type="password"
      inputMode="numeric"
      autoComplete="off"
      autoFocus
      maxLength={PIN_LENGTH}
      disabled={disabled}
      className="h-14 text-center text-2xl tracking-[0.6em]"
      value={pin}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH)
        setPinValue(digits)
        if (digits.length === PIN_LENGTH) {
          onComplete(digits)
          setPinValue('')
        }
      }}
    />
  )
}

function messageOf(error: unknown): string {
  return error instanceof SyncError ? error.message : t('เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง')
}

function SignInScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (password.length < MIN_PASSWORD) return setError(t('รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร'))
    if (mode === 'signup' && password !== again) return setError(t('รหัสผ่านสองช่องไม่ตรงกัน'))
    setBusy(true)
    try {
      const outcome: SyncOutcome = await signIn(mode, email, password)
      setConflict(outcome.kind === 'conflict')
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  if (conflict) {
    return (
      <Screen>
        <Card className="grid gap-3">
          <h1 className="text-xl font-semibold">{t('มีข้อมูลทั้งในเครื่องนี้และในบัญชี')}</h1>
          <p className="text-sm text-muted-foreground">{t('เลือกว่าจะใช้ข้อมูลชุดไหน อีกชุดจะถูกแทนที่')}</p>
          <div className="grid gap-2">
            <Button type="button" disabled={busy} onClick={() => void keepSide('server').then(() => setConflict(false))}>
              {t('ใช้ข้อมูลในบัญชี')}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void keepSide('device').then(() => setConflict(false))}>
              {t('ใช้ข้อมูลในเครื่องนี้')}
            </Button>
          </div>
        </Card>
      </Screen>
    )
  }

  return (
    <Screen>
      <Card className="grid gap-4">
        <h1 className="text-2xl font-semibold">{mode === 'login' ? t('เข้าสู่ระบบ') : t('สมัครบัญชีใหม่')}</h1>
        <Segmented
          label={t('เข้าสู่ระบบหรือสมัคร')}
          options={[
            { value: 'login' as const, label: t('มีบัญชีแล้ว') },
            { value: 'signup' as const, label: t('สมัครใหม่') },
          ]}
          value={mode}
          onChange={(next) => {
            setMode(next)
            setError('')
          }}
        />
        <form className="grid gap-3" onSubmit={(e) => void submit(e)}>
          <Field id="auth-email" label={t('อีเมล')}>
            <Input id="auth-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field id="auth-password" label={t('รหัสผ่าน')} hint={mode === 'signup' ? t('อย่างน้อย 10 ตัวอักษร · ใช้เข้ารหัสข้อมูลของคุณ ลืมแล้วกู้ข้อมูลบนเซิร์ฟเวอร์ไม่ได้') : undefined}>
            <Input
              id="auth-password"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {mode === 'signup' && (
            <Field id="auth-password-again" label={t('รหัสผ่านอีกครั้ง')}>
              <Input id="auth-password-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
            </Field>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" disabled={busy || !email || !password}>
            {busy ? t('กำลังเข้าสู่ระบบ…') : mode === 'login' ? t('เข้าสู่ระบบ') : t('สมัครและเข้าใช้งาน')}
          </Button>
        </form>
        <p className="text-[12.5px] text-muted-foreground">
          {t('ข้อมูลการลงทุนเก็บในเครื่องและถูกเข้ารหัสด้วยรหัสผ่านของคุณก่อนซิงก์ เซิร์ฟเวอร์อ่านไม่ได้ · ครั้งต่อไปเข้าแอปด้วย PIN 6 หลัก')}
        </p>
      </Card>
    </Screen>
  )
}

function SetPinScreen() {
  const [first, setFirst] = useState<string | null>(null)
  const [error, setError] = useState('')
  return (
    <Screen>
      <Card className="grid gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{first ? t('ใส่ PIN อีกครั้ง') : t('ตั้ง PIN 6 หลัก')}</h1>
          <p className="text-sm text-muted-foreground">{t('ใช้เข้าแอปครั้งต่อไปแทนรหัสผ่าน')}</p>
        </div>
        <PinField
          key={first ?? 'first'}
          label={first ? t('PIN อีกครั้ง') : t('PIN ใหม่')}
          onComplete={(pin) => {
            if (!first) {
              setFirst(pin)
              setError('')
              return
            }
            if (pin !== first) {
              setFirst(null)
              setError(t('PIN สองครั้งไม่ตรงกัน ลองตั้งใหม่'))
              return
            }
            if (validPin(pin)) void setPin(pin)
          }}
        />
        {error && <Alert tone="error">{error}</Alert>}
      </Card>
    </Screen>
  )
}

function UnlockScreen() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)
  const biometrics = hasBiometrics()

  useEffect(() => {
    if (biometrics) void unlockWithBiometrics()
  }, [biometrics])

  return (
    <Screen>
      <Card className="grid justify-items-center gap-4 text-center">
        <Lock className="size-8 text-ink-2" aria-hidden />
        <h1 className="text-2xl font-semibold">{t('ใส่ PIN เพื่อเข้าแอป')}</h1>
        <PinField
          label="PIN"
          disabled={busy}
          onComplete={(pin) => {
            setBusy(true)
            void unlockWithPin(pin).then((ok) => {
              setBusy(false)
              if (!ok) setError(t('PIN ไม่ถูก'))
            })
          }}
        />
        {error && <Alert tone="error">{error}</Alert>}
        {biometrics && (
          <Button type="button" variant="outline" onClick={() => void unlockWithBiometrics()}>
            <Fingerprint aria-hidden />
            {t('ใช้สแกนนิ้วหรือใบหน้า')}
          </Button>
        )}
        {forgot ? (
          <Alert>
            {t('ออกจากระบบแล้วเข้าใหม่ด้วยอีเมลและรหัสผ่าน ข้อมูลที่ซิงก์แล้วจะกลับมา ส่วนที่ยังไม่ได้ซิงก์จะหาย')}
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void signOut(true)}>
              {t('ออกจากระบบ')}
            </Button>
          </Alert>
        ) : (
          <button type="button" className="min-h-11 text-sm font-semibold text-primary-ink underline underline-offset-[3px]" onClick={() => setForgot(true)}>
            {t('ลืม PIN?')}
          </button>
        )}
      </Card>
    </Screen>
  )
}

// In front of every page: sign in once on a device, then a six-digit PIN each time the app opens or comes back after
// five minutes away. The privacy policy stays readable without an account.
export function AuthGate() {
  const session = useSyncState()
  const lock = useLockState()
  const { pathname } = useLocation()
  useEffect(() => {
    const onChange = () => noteVisibility(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  if (authBypassed() || pathname === '/privacy') return <Outlet />
  if (!session) return <SignInScreen />
  if (lock === 'off') return <SetPinScreen />
  if (lock === 'locked') return <UnlockScreen />
  return <Outlet />
}

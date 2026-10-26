import { Eye, EyeOff, Fingerprint, Lock, LockKeyhole, Mail, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ComponentProps, type FormEvent, type ReactNode } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { Alert } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Field } from '../components/ui/field'
import { Input } from '../components/ui/input'
import { PinPad } from './components/PinPad'
import { t } from '../i18n'
import { hasBiometrics, noteVisibility, setPin, unlockWithBiometrics, unlockWithPin, useLockState, validPin } from '../security/lock'
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
        <p className="text-center font-display text-[30px] font-semibold leading-none text-primary">JOD</p>
        {children}
      </main>
    </div>
  )
}

function messageOf(error: unknown): string {
  return error instanceof SyncError ? error.message : t('เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง')
}

function IconInput({
  id,
  icon: Icon,
  type,
  reveal,
  ...props
}: { id: string; icon: LucideIcon; reveal?: boolean } & ComponentProps<'input'>) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input id={id} type={reveal && shown ? 'text' : type} className="h-14 rounded-2xl border-transparent bg-card pr-12 pl-12 shadow-sm" {...props} />
      {reveal && (
        <button
          type="button"
          aria-label={shown ? t('ซ่อนรหัสผ่าน') : t('แสดงรหัสผ่าน')}
          aria-pressed={shown}
          className="absolute top-1/2 right-2 grid size-10 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          onClick={() => setShown(!shown)}
        >
          {shown ? <Eye className="size-5" aria-hidden /> : <EyeOff className="size-5" aria-hidden />}
        </button>
      )}
    </div>
  )
}

function SignInScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [forgot, setForgot] = useState(false)
  const signup = mode === 'signup'

  function switchTo(next: 'login' | 'signup') {
    setMode(next)
    setError('')
    setForgot(false)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (password.length < MIN_PASSWORD) return setError(t('รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร'))
    if (signup && password !== again) return setError(t('รหัสผ่านสองช่องไม่ตรงกัน'))
    if (signup && !agreed) return setError(t('กรุณายอมรับนโยบายความเป็นส่วนตัวก่อนสมัคร'))
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
        <div className="grid gap-3 text-center">
          <h1 className="text-2xl font-semibold">{t('มีข้อมูลทั้งในเครื่องนี้และในบัญชี')}</h1>
          <p className="text-sm text-muted-foreground">{t('เลือกว่าจะใช้ข้อมูลชุดไหน อีกชุดจะถูกแทนที่')}</p>
          <Button type="button" className="h-14 rounded-full" disabled={busy} onClick={() => void keepSide('server').then(() => setConflict(false))}>
            {t('ใช้ข้อมูลในบัญชี')}
          </Button>
          <Button type="button" variant="outline" className="h-14 rounded-full" disabled={busy} onClick={() => void keepSide('device').then(() => setConflict(false))}>
            {t('ใช้ข้อมูลในเครื่องนี้')}
          </Button>
        </div>
      </Screen>
    )
  }

  return (
    <Screen>
      <div className="grid gap-1 pt-4 pb-2 text-center">
        <h1 className="text-[28px] font-semibold">{signup ? t('สร้างบัญชีใหม่') : t('ยินดีต้อนรับกลับมา')}</h1>
        <p className="text-sm text-muted-foreground">{t('จดทุกเทรด รู้ทุกบาท')}</p>
      </div>
      <form className="grid gap-4" onSubmit={(e) => void submit(e)}>
        <Field id="auth-email" label={t('อีเมล')}>
          <IconInput
            id="auth-email"
            icon={Mail}
            type="email"
            autoComplete="username"
            placeholder={t('ใส่อีเมลของคุณ')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field id="auth-password" label={t('รหัสผ่าน')} hint={signup ? t('อย่างน้อย 10 ตัวอักษร · ใช้เข้ารหัสข้อมูลของคุณ ลืมแล้วกู้ข้อมูลบนเซิร์ฟเวอร์ไม่ได้') : undefined}>
          <IconInput
            id="auth-password"
            icon={LockKeyhole}
            type="password"
            reveal
            autoComplete={signup ? 'new-password' : 'current-password'}
            placeholder={t('ใส่รหัสผ่าน')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {signup && (
          <Field id="auth-password-again" label={t('รหัสผ่านอีกครั้ง')}>
            <IconInput
              id="auth-password-again"
              icon={LockKeyhole}
              type="password"
              reveal
              autoComplete="new-password"
              placeholder={t('ใส่รหัสผ่านอีกครั้ง')}
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          </Field>
        )}
        {signup ? (
          <label className="flex min-h-11 items-center gap-2.5 text-sm text-ink-2">
            <input type="checkbox" className="size-5 accent-primary" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>
              {t('ฉันยอมรับ')}{' '}
              <Link to="/privacy" className="font-semibold text-primary-ink underline underline-offset-[3px]">
                {t('นโยบายความเป็นส่วนตัว')}
              </Link>
            </span>
          </label>
        ) : (
          <button type="button" className="min-h-11 justify-self-end text-sm font-semibold text-primary-ink" onClick={() => setForgot(!forgot)}>
            {t('ลืมรหัสผ่าน?')}
          </button>
        )}
        {forgot && !signup && (
          <Alert>
            {t('รหัสผ่านใช้เข้ารหัสข้อมูลของคุณ จึงรีเซ็ตแล้วเปิดข้อมูลบนเซิร์ฟเวอร์ไม่ได้ · ถ้ายังเปิดแอปในเครื่องอื่นได้ ข้อมูลยังอยู่ที่เครื่องนั้น')}
          </Alert>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" className="h-14 rounded-full text-base" disabled={busy || !email || !password}>
          {busy ? t('กำลังเข้าสู่ระบบ…') : signup ? t('สมัครและเข้าใช้งาน') : t('เข้าสู่ระบบ')}
        </Button>
      </form>
      <p className="pt-6 text-center text-sm text-ink-2">
        {signup ? t('มีบัญชีอยู่แล้ว?') : t('ยังไม่มีบัญชี?')}{' '}
        <button type="button" className="font-semibold text-primary-ink underline underline-offset-[3px]" onClick={() => switchTo(signup ? 'login' : 'signup')}>
          {signup ? t('เข้าสู่ระบบ') : t('สมัครเลย')}
        </button>
      </p>
      <p className="text-center text-[12px] text-muted-foreground">
        {t('ข้อมูลการลงทุนเก็บในเครื่องและถูกเข้ารหัสด้วยรหัสผ่านของคุณก่อนซิงก์ เซิร์ฟเวอร์อ่านไม่ได้ · ครั้งต่อไปเข้าแอปด้วย PIN 6 หลัก')}
      </p>
    </Screen>
  )
}

function SetPinScreen() {
  const [first, setFirst] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [shake, setShake] = useState(0)
  return (
    <Screen>
      <div className="grid justify-items-center gap-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold">{first ? t('ใส่ PIN อีกครั้ง') : t('ตั้ง PIN 6 หลัก')}</h1>
          <p className="text-sm text-muted-foreground">{error || t('ใช้เข้าแอปครั้งต่อไปแทนรหัสผ่าน')}</p>
        </div>
        <PinPad
          key={first ?? 'first'}
          label={first ? t('PIN อีกครั้ง') : t('PIN ใหม่')}
          shake={shake}
          onComplete={(pin) => {
            if (!first) {
              setFirst(pin)
              setError('')
              return
            }
            if (pin !== first) {
              setFirst(null)
              setError(t('PIN สองครั้งไม่ตรงกัน ลองตั้งใหม่'))
              setShake((n) => n + 1)
              return
            }
            if (validPin(pin)) void setPin(pin)
          }}
        />
      </div>
    </Screen>
  )
}

function UnlockScreen() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [shake, setShake] = useState(0)
  const biometrics = hasBiometrics()

  useEffect(() => {
    if (biometrics) void unlockWithBiometrics()
  }, [biometrics])

  return (
    <Screen>
      <div className="grid justify-items-center gap-6 text-center">
        <div className="grid justify-items-center gap-2">
          <Lock className="size-7 text-ink-2" aria-hidden />
          <h1 className="text-2xl font-semibold">{t('ใส่ PIN เพื่อเข้าแอป')}</h1>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <PinPad
          label="PIN"
          disabled={busy}
          shake={shake}
          extraKey={
            biometrics && (
              <button
                type="button"
                aria-label={t('ใช้สแกนนิ้วหรือใบหน้า')}
                className="grid size-[72px] place-items-center rounded-full text-primary hover:bg-muted"
                onClick={() => void unlockWithBiometrics()}
              >
                <Fingerprint className="size-8" aria-hidden />
              </button>
            )
          }
          onComplete={(pin) => {
            setBusy(true)
            void unlockWithPin(pin).then((ok) => {
              setBusy(false)
              if (!ok) {
                setError(t('PIN ไม่ถูก'))
                setShake((n) => n + 1)
              }
            })
          }}
        />
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
      </div>
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

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
import { cn } from '../lib/cn'
import { ThemeSync, useBoardStatusBar } from './theme'
import { seenWelcome } from './welcome'
import { WelcomeScreen } from './WelcomeScreen'

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

// The money route of the overview, drawn on the rate board: baht, exchanged at a rate, into an asset. It is what
// the app is about, so it opens the app instead of a picture.
function BoardRoute() {
  const stations = [
    { label: t('เงินสด'), ring: 'border-white' },
    { label: t('แลกเงิน'), ring: 'border-board-fx' },
    { label: t('สินทรัพย์'), ring: 'border-white' },
  ]
  return (
    <div aria-hidden className="grid w-full max-w-[340px] grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-y-2">
      {stations.map((station, i) => [
        i > 0 && (
          <span
            key={`line-${i}`}
            className={cn(
              'mx-1.5 h-[5px] origin-left rounded-full motion-safe:animate-[route-draw_0.7s_cubic-bezier(0.16,1,0.3,1)_both]',
              i === 1 ? 'bg-board-muted/70' : 'bg-board-mine',
            )}
            style={{ animationDelay: `${150 + i * 220}ms` }}
          />
        ),
        <span
          key={`dot-${i}`}
          className={cn('size-[22px] rounded-full border-[5px] bg-board motion-safe:animate-[station-in_0.4s_cubic-bezier(0.16,1,0.3,1)_both]', station.ring)}
          style={{ animationDelay: `${i * 260}ms` }}
        />,
      ])}
      {stations.map((station, i) => (
        <span
          key={`label-${i}`}
          className={cn(
            'text-[12.5px] text-board-muted',
            i === 0 && 'col-start-1 justify-self-start',
            i === 1 && 'col-start-3 justify-self-center text-board-fx',
            i === 2 && 'col-start-5 justify-self-end',
          )}
        >
          {station.label}
        </span>
      ))}
    </div>
  )
}

function BoardScreen({ children }: { children: ReactNode }) {
  useBoardStatusBar()
  return (
    <div className="flex min-h-[calc(100dvh-env(safe-area-inset-top))] flex-col bg-board md:grid md:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
      <ThemeSync />
      <header className="grid content-end gap-7 px-6 pt-10 pb-12 md:content-center md:px-14 md:pb-10">
        <div>
          <p className="font-display text-[56px] leading-none font-semibold tracking-[-0.02em] text-white md:text-[88px]">JOD</p>
          <p className="mt-2 text-[15px] text-board-muted md:text-lg">{t('จดทุกเทรด รู้ทุกบาท')}</p>
        </div>
        <BoardRoute />
      </header>
      <main className="-mt-6 min-h-[60dvh] flex-1 rounded-t-[28px] bg-background px-5 pt-7 pb-[max(env(safe-area-inset-bottom),28px)] md:mt-0 md:grid md:min-h-dvh md:content-center md:rounded-none md:px-12">
        <div className="mx-auto grid w-full max-w-sm gap-5">{children}</div>
      </main>
    </div>
  )
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
      <Icon className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input id={id} type={reveal && shown ? 'text' : type} className="h-12 bg-card pr-12 pl-11" {...props} />
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

function SignInScreen({ initialMode = 'login' }: { initialMode?: 'login' | 'signup' }) {
  const [mode, setMode] = useState(initialMode)
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
      <BoardScreen>
        <div className="grid gap-3">
          <h1 className="text-[26px] leading-tight font-semibold">{t('มีข้อมูลทั้งในเครื่องนี้และในบัญชี')}</h1>
          <p className="text-sm text-muted-foreground">{t('เลือกว่าจะใช้ข้อมูลชุดไหน อีกชุดจะถูกแทนที่')}</p>
          <Button type="button" className="h-12" disabled={busy} onClick={() => void keepSide('server').then(() => setConflict(false))}>
            {t('ใช้ข้อมูลในบัญชี')}
          </Button>
          <Button type="button" variant="outline" className="h-12" disabled={busy} onClick={() => void keepSide('device').then(() => setConflict(false))}>
            {t('ใช้ข้อมูลในเครื่องนี้')}
          </Button>
        </div>
      </BoardScreen>
    )
  }

  return (
    <BoardScreen>
      <div className="grid gap-1">
        <h1 className="text-[26px] leading-tight font-semibold">{signup ? t('สร้างบัญชีใหม่') : t('เข้าสู่ระบบ')}</h1>
        <p className="text-sm text-muted-foreground">
          {signup ? t('ข้อมูลจะถูกเข้ารหัสด้วยรหัสผ่านนี้ก่อนออกจากเครื่อง') : t('ใช้อีเมลและรหัสผ่านที่สมัครไว้')}
        </p>
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
        <Button type="submit" className="h-12 w-full text-base" disabled={busy || !email || !password}>
          {busy ? t('กำลังเข้าสู่ระบบ…') : signup ? t('สมัครและเข้าใช้งาน') : t('เข้าสู่ระบบ')}
        </Button>
      </form>
      <p className="border-t pt-5 text-center text-sm text-ink-2">
        {signup ? t('มีบัญชีอยู่แล้ว?') : t('ยังไม่มีบัญชี?')}{' '}
        <button type="button" className="font-semibold text-primary-ink underline underline-offset-[3px]" onClick={() => switchTo(signup ? 'login' : 'signup')}>
          {signup ? t('เข้าสู่ระบบ') : t('สมัครเลย')}
        </button>
      </p>
      <p className="text-center text-[12px] text-muted-foreground">{t('ครั้งต่อไปเข้าแอปด้วย PIN 6 หลัก')}</p>
    </BoardScreen>
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
  const [welcome, setWelcome] = useState(() => !seenWelcome())
  const [startMode, setStartMode] = useState<'login' | 'signup'>('login')
  useEffect(() => {
    const onChange = () => noteVisibility(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  if (authBypassed() || pathname === '/privacy') return <Outlet />
  if (!session && welcome)
    return (
      <WelcomeScreen
        onChoose={(mode) => {
          setStartMode(mode)
          setWelcome(false)
        }}
      />
    )
  if (!session) return <SignInScreen initialMode={startMode} />
  if (lock === 'off') return <SetPinScreen />
  if (lock === 'locked') return <UnlockScreen />
  return <Outlet />
}

import { Check, Copy, Fingerprint, Lock, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router'
import { Alert } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Field } from '../components/ui/field'
import { IconInput } from './components/IconInput'
import { PasswordResetForm } from './components/PasswordResetForm'
import { PinPad } from './components/PinPad'
import { t } from '../i18n'
import { hasBiometrics, noteVisibility, setPin, unlockWithBiometrics, unlockWithPin, useLockState, validPin } from '../security/lock'
import { SyncError } from '../sync/client'
import { authBypassed, confirmRecoverySaved, MIN_PASSWORD, signIn, signOut } from '../sync/session'
import { useSyncState } from '../sync/state'
import { cn } from '../lib/cn'
import { ThemeSync, useBoardStatusBar } from './theme'
import { seenWelcome } from './welcome'
import { WelcomeScreen } from './WelcomeScreen'

function ResetScreen({ email, code, onBack }: { email: string; code: string; onBack: () => void }) {
  return (
    <BoardScreen>
      <div className="grid gap-1">
        <h1 className="text-[26px] leading-tight font-semibold">{t('ตั้งรหัสผ่านใหม่')}</h1>
        <p className="text-sm text-muted-foreground">{t('เราจะส่งรหัสไปที่อีเมลของบัญชี ใช้รหัสนั้นตั้งรหัสผ่านใหม่')}</p>
      </div>
      <PasswordResetForm email={email} code={code} />
      <p className="border-t pt-5 text-center text-sm">
        <button type="button" className="font-semibold text-primary-ink underline underline-offset-[3px]" onClick={onBack}>
          {t('กลับไปเข้าสู่ระบบ')}
        </button>
      </p>
    </BoardScreen>
  )
}

// Shown once, right after the code is made: the app keeps only a sealed copy it cannot read, so this is the moment to
// write it down.
function RecoveryCodeScreen({ code }: { code: string }) {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  return (
    <BoardScreen>
      <div className="grid gap-1">
        <h1 className="text-[26px] leading-tight font-semibold">{t('จดรหัสกู้คืนเก็บไว้')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('ถ้าลืมรหัสผ่านและไม่มีเครื่องไหนเข้าแอปอยู่ ต้องใช้รหัสนี้เปิดข้อมูลเดิม และรหัสนี้จะไม่แสดงอีก')}
        </p>
      </div>
      <div className="grid gap-3 rounded-2xl border bg-card p-5">
        <p className="flex items-center gap-2 text-[12.5px] font-semibold text-muted-foreground">
          <ShieldCheck className="size-4" strokeWidth={1.75} aria-hidden />
          {t('รหัสกู้คืน')}
        </p>
        <p aria-label={t('รหัสกู้คืน')} className="grid grid-cols-5 gap-2 font-mono text-[17px] font-semibold tracking-[0.06em] text-foreground select-all">
          {code.split('-').map((group) => (
            <span key={group} className="rounded-lg bg-muted py-2 text-center">
              {group}
            </span>
          ))}
        </p>
        <Button
          type="button"
          variant="outline"
          className="justify-self-start"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(code)
              .then(() => setCopied(true))
              .catch(() => {})
          }
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? t('คัดลอกแล้ว') : t('คัดลอก')}
        </Button>
      </div>
      <p className="text-[12.5px] text-muted-foreground">{t('เขียนลงกระดาษหรือเก็บในตัวจัดการรหัสผ่าน อย่าเก็บไว้ในแอปนี้')}</p>
      <label className="flex min-h-11 items-center gap-2.5 text-sm text-ink-2">
        <input type="checkbox" className="size-5 accent-primary" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        {t('ฉันจดรหัสนี้เก็บไว้แล้ว')}
      </label>
      <Button type="button" className="h-12 w-full text-base" disabled={!saved} onClick={confirmRecoverySaved}>
        {t('ไปต่อ')}
      </Button>
    </BoardScreen>
  )
}

// The PIN screens stay on the board from edge to edge, as in a banking app. The keypad sits at the bottom where the
// thumb rests; what the screen asks for takes the open space above it.
function PinScreen({ intro, footer, children }: { intro: ReactNode; footer?: ReactNode; children: ReactNode }) {
  useBoardStatusBar()
  return (
    <div className="flex min-h-[calc(100dvh-env(safe-area-inset-top))] flex-col bg-board px-6 pt-5 pb-[max(env(safe-area-inset-bottom),16px)] text-white">
      <ThemeSync />
      <p className="font-display text-[22px] leading-none font-semibold tracking-[-0.01em]">JOD</p>
      <main className="mx-auto flex w-full max-w-[340px] flex-1 flex-col">
        <div className="grid flex-1 content-center justify-items-center gap-2 py-8 text-center">{intro}</div>
        {children}
        <div className="grid min-h-16 place-items-center pt-3">{footer}</div>
      </main>
    </div>
  )
}

// Setting a PIN is two stops on the money route: choose it, then confirm it.
function PinSteps({ step }: { step: 1 | 2 }) {
  return (
    <div aria-hidden className="mb-5 grid grid-cols-[auto_64px_auto] items-center gap-x-2 gap-y-2 text-[12.5px]">
      <span className={cn('size-4 justify-self-center rounded-full border-4', step === 1 ? 'border-white bg-board' : 'border-board-mine bg-board-mine')} />
      <span className={cn('h-1 rounded-full transition-colors duration-300', step === 2 ? 'bg-board-mine' : 'bg-board-muted/35')} />
      <span className={cn('size-4 justify-self-center rounded-full border-4 bg-board', step === 2 ? 'border-white' : 'border-board-muted/45')} />
      <span className={step === 1 ? 'text-white' : 'text-board-mine'}>{t('ตั้ง PIN')}</span>
      <span />
      <span className={step === 2 ? 'text-white' : 'text-board-muted'}>{t('ยืนยัน')}</span>
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

function SignInScreen({ initialMode = 'login', onForgot }: { initialMode?: 'login' | 'signup'; onForgot: (email: string) => void }) {
  const [mode, setMode] = useState(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const signup = mode === 'signup'

  function switchTo(next: 'login' | 'signup') {
    setMode(next)
    setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (password.length < MIN_PASSWORD) return setError(t('รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร'))
    if (signup && password !== again) return setError(t('รหัสผ่านสองช่องไม่ตรงกัน'))
    if (signup && !agreed) return setError(t('กรุณายอมรับนโยบายความเป็นส่วนตัวก่อนสมัคร'))
    setBusy(true)
    try {
      await signIn(mode, email, password)
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
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
        <Field id="auth-password" label={t('รหัสผ่าน')} hint={signup ? t('อย่างน้อย 10 ตัวอักษร ใช้เข้ารหัสข้อมูล ลืมแล้วตั้งใหม่ทางอีเมลได้') : undefined}>
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
          <button type="button" className="min-h-11 justify-self-end text-sm font-semibold text-primary-ink" onClick={() => onForgot(email)}>
            {t('ลืมรหัสผ่าน?')}
          </button>
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
    <PinScreen
      intro={
        <>
          <PinSteps step={first ? 2 : 1} />
          <h1 className="font-display text-[28px] leading-tight font-semibold">{first ? t('ใส่ PIN อีกครั้ง') : t('ตั้ง PIN 6 หลัก')}</h1>
          <p className={cn('text-[15px]', error ? 'text-board-loss' : 'text-board-muted')}>{error || t('ใช้เข้าแอปครั้งต่อไปแทนรหัสผ่าน')}</p>
        </>
      }
      footer={
        <p className="flex items-center gap-1.5 text-[12.5px] text-board-muted">
          <ShieldCheck className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          {t('PIN นี้ใช้เฉพาะเครื่องนี้ ไม่ส่งขึ้นเซิร์ฟเวอร์')}
        </p>
      }
    >
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
    </PinScreen>
  )
}

function UnlockScreen() {
  const session = useSyncState()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [shake, setShake] = useState(0)
  const biometrics = hasBiometrics()

  useEffect(() => {
    if (biometrics) void unlockWithBiometrics()
  }, [biometrics])

  return (
    <PinScreen
      intro={
        forgot ? (
          <div role="alert" className="grid gap-4 rounded-2xl border border-board-line px-5 py-5 text-left text-sm leading-relaxed text-board-muted">
            <p className="font-display text-lg font-semibold text-white">{t('ลืม PIN?')}</p>
            {t('ออกจากระบบแล้วเข้าใหม่ด้วยอีเมลและรหัสผ่าน ข้อมูลที่ซิงก์แล้วจะกลับมา ส่วนที่ยังไม่ได้ซิงก์จะหาย')}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="h-11 rounded-xl bg-white px-4 font-semibold text-board hover:bg-board-mine"
                onClick={() => void signOut(true)}
              >
                {t('ออกจากระบบ')}
              </button>
              <button type="button" className="h-11 rounded-xl px-4 font-semibold text-white hover:bg-board-line" onClick={() => setForgot(false)}>
                {t('ลองใส่ PIN อีกครั้ง')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <span className="mb-4 grid size-16 place-items-center rounded-full border border-board-line bg-[color-mix(in_oklab,var(--board-line)_45%,var(--board))]">
              <Lock className="size-7 text-board-mine" strokeWidth={1.75} aria-hidden />
            </span>
            <h1 className="font-display text-[28px] leading-tight font-semibold">{t('ใส่ PIN เพื่อเข้าแอป')}</h1>
            {error ? (
              <p role="alert" className="text-[15px] text-board-loss">
                {error}
              </p>
            ) : (
              session && <p className="text-[15px] text-board-muted">{session.email}</p>
            )}
          </>
        )
      }
      footer={
        !forgot && (
          <button type="button" className="min-h-11 px-3 text-sm font-semibold text-board-mine underline underline-offset-[3px]" onClick={() => setForgot(true)}>
            {t('ลืม PIN?')}
          </button>
        )
      }
    >
      <PinPad
        label="PIN"
        disabled={busy}
        shake={shake}
        extraKey={
          biometrics && (
            <button
              type="button"
              aria-label={t('ใช้สแกนนิ้วหรือใบหน้า')}
              className="grid size-[76px] place-items-center rounded-full text-board-mine hover:bg-board-line focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-board-mine/60"
              onClick={() => void unlockWithBiometrics()}
            >
              <Fingerprint className="size-8" strokeWidth={1.75} aria-hidden />
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
    </PinScreen>
  )
}

// In front of every page: sign in once on a device, then a six-digit PIN each time the app opens or comes back after
// five minutes away. The privacy policy stays readable without an account.
export function AuthGate() {
  const session = useSyncState()
  const lock = useLockState()
  const { pathname, search } = useLocation()
  const [welcome, setWelcome] = useState(() => !seenWelcome())
  const [startMode, setStartMode] = useState<'login' | 'signup'>('login')
  // The link in a reset email opens /reset with the email and code filled in.
  const [reset, setReset] = useState<{ email: string; code: string } | null>(() => {
    if (pathname !== '/reset') return null
    const params = new URLSearchParams(search)
    return { email: params.get('email') ?? '', code: params.get('code') ?? '' }
  })
  useEffect(() => {
    const onChange = () => noteVisibility(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  if (authBypassed() || pathname === '/privacy') return <Outlet />
  if (!session && reset) return <ResetScreen email={reset.email} code={reset.code} onBack={() => setReset(null)} />
  if (!session && welcome)
    return (
      <WelcomeScreen
        onChoose={(mode) => {
          setStartMode(mode)
          setWelcome(false)
        }}
      />
    )
  if (!session) return <SignInScreen initialMode={startMode} onForgot={(email) => setReset({ email, code: '' })} />
  if (session.recoveryCode) return <RecoveryCodeScreen code={session.recoveryCode} />
  if (lock === 'off') return <SetPinScreen />
  if (lock === 'locked') return <UnlockScreen />
  if (pathname === '/reset') return <Navigate to={`/settings${search}`} replace />
  return <Outlet />
}

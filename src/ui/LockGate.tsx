import { Fingerprint, Lock } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Alert } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { hasBiometrics, noteVisibility, unlockWithBiometrics, unlockWithPin, useLockState } from '../security/lock'
import { ThemeSync } from './theme'

function LockScreen() {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const biometrics = hasBiometrics()

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    const ok = await unlockWithPin(pin)
    setBusy(false)
    if (!ok) {
      setError('PIN ไม่ถูก')
      setPin('')
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4">
      <ThemeSync />
      <main className="grid w-full max-w-xs justify-items-center gap-4 text-center">
        <Lock className="size-8 text-ink-2" aria-hidden />
        <h1 className="font-display text-2xl font-semibold">JOD ล็อกอยู่</h1>
        <form onSubmit={(e) => void submit(e)} className="grid w-full gap-3">
          <Input
            aria-label="PIN"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            maxLength={8}
            className="text-center text-xl tracking-[0.5em]"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, ''))
              setError('')
            }}
          />
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" disabled={busy || pin.length < 4}>
            ปลดล็อก
          </Button>
        </form>
        {biometrics && (
          <Button type="button" variant="outline" onClick={() => void unlockWithBiometrics()}>
            <Fingerprint aria-hidden />
            ใช้สแกนนิ้วหรือใบหน้า
          </Button>
        )}
      </main>
    </div>
  )
}

export function LockGate({ children }: { children: ReactNode }) {
  const state = useLockState()
  useEffect(() => {
    const onChange = () => noteVisibility(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return state === 'locked' ? <LockScreen /> : <>{children}</>
}

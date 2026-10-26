import { Delete } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '../../i18n'
import { cn } from '../../lib/cn'
import { PIN_LENGTH } from '../../security/lock'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

// Six dots and a number pad on the navy rate board, as banking apps do, so the phone's own keyboard never covers the
// screen. The digits on a physical keyboard work too. The PIN is handed over as soon as the sixth digit is in.
export function PinPad({
  label,
  onComplete,
  disabled,
  extraKey,
  shake,
}: {
  label: string
  onComplete: (pin: string) => void
  disabled?: boolean
  // The key left of 0, such as fingerprint unlock; empty when not given.
  extraKey?: ReactNode
  // Changes when a wrong PIN should be shown by shaking the dots.
  shake?: number
}) {
  const [pin, setPin] = useState('')
  const done = useRef(onComplete)
  useEffect(() => {
    done.current = onComplete
  })

  const press = (digit: string) => {
    if (disabled) return
    setPin((current) => {
      if (current.length >= PIN_LENGTH) return current
      const next = current + digit
      if (next.length === PIN_LENGTH) {
        queueMicrotask(() => done.current(next))
        return ''
      }
      return next
    })
  }
  const back = () => setPin((current) => current.slice(0, -1))

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) press(event.key)
      else if (event.key === 'Backspace') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const keyClass =
    'grid size-[72px] place-items-center rounded-full font-display text-[28px] font-semibold text-white transition-colors hover:bg-board-line active:bg-board-line focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-board-mine/60 disabled:opacity-40'

  return (
    <div className="grid justify-items-center gap-8">
      <div
        role="status"
        aria-label={t('{0} ใส่แล้ว {1} จาก {2} หลัก', label, pin.length, PIN_LENGTH)}
        key={shake}
        className={cn('flex gap-4', shake && 'animate-[pin-shake_0.35s_ease-in-out]')}
      >
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className={cn('size-4 rounded-full border-2 border-board-muted transition-colors', i < pin.length && 'border-white bg-white')}
          />
        ))}
      </div>
      <div role="group" aria-label={label} className="grid grid-cols-3 gap-x-6 gap-y-3">
        {KEYS.map((digit) => (
          <button key={digit} type="button" className={keyClass} disabled={disabled} onClick={() => press(digit)}>
            {digit}
          </button>
        ))}
        <span className="grid size-[72px] place-items-center">{extraKey}</span>
        <button type="button" className={keyClass} disabled={disabled} onClick={() => press('0')}>
          0
        </button>
        <button type="button" aria-label={t('ลบตัวเลข')} className={cn(keyClass, 'text-board-muted')} disabled={disabled || pin.length === 0} onClick={back}>
          <Delete className="size-7" aria-hidden />
        </button>
      </div>
    </div>
  )
}

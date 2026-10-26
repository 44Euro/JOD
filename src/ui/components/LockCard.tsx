import { useEffect, useState, type FormEvent } from 'react'
import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { t } from '../../i18n'
import { biometricsAvailable, changePin, disableBiometrics, enableBiometrics, hasBiometrics, lockNow, PIN_LENGTH } from '../../security/lock'

function PinInput({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field id={id} label={label}>
      <Input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={PIN_LENGTH}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      />
    </Field>
  )
}

export function LockCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [canBio, setCanBio] = useState(false)
  const [bio, setBio] = useState(hasBiometrics())

  useEffect(() => {
    void biometricsAvailable().then(setCanBio)
  }, [])

  async function change(event: FormEvent) {
    event.preventDefault()
    if (next !== again) return setMessage({ tone: 'error', text: t('PIN ใหม่สองช่องไม่ตรงกัน') })
    try {
      await changePin(current, next)
      setMessage({ tone: 'ok', text: t('เปลี่ยน PIN แล้ว') })
      setCurrent('')
      setNext('')
      setAgain('')
    } catch (e) {
      setMessage({ tone: 'error', text: (e as Error).message })
    }
  }

  return (
    <Card className="grid gap-3">
      <div>
        <h2 className="text-lg font-semibold">{t('PIN เข้าแอป')}</h2>
        <p className="text-[12.5px] text-muted-foreground">{t('แอปถาม PIN 6 หลักทุกครั้งที่เปิด และเมื่อออกไปนานกว่า 5 นาที')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={lockNow}>
          {t('ล็อกตอนนี้')}
        </Button>
        {canBio &&
          (bio ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                disableBiometrics()
                setBio(false)
              }}
            >
              {t('เลิกใช้สแกนนิ้ว/ใบหน้า')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void enableBiometrics()
                  .then(() => setBio(true))
                  .catch(() => setMessage({ tone: 'error', text: t('เปิดใช้สแกนนิ้ว/ใบหน้าไม่สำเร็จ') }))
              }
            >
              {t('ใช้สแกนนิ้ว/ใบหน้าปลดล็อก')}
            </Button>
          ))}
      </div>
      <form onSubmit={(e) => void change(e)} className="grid gap-3 sm:grid-cols-3 sm:items-end">
        <PinInput id="pin-current" label={t('PIN ปัจจุบัน')} value={current} onChange={setCurrent} />
        <PinInput id="pin-next" label={t('PIN ใหม่')} value={next} onChange={setNext} />
        <PinInput id="pin-again" label={t('PIN ใหม่อีกครั้ง')} value={again} onChange={setAgain} />
        <div className="sm:col-span-3">
          <Button type="submit" variant="outline" disabled={current.length < PIN_LENGTH || next.length < PIN_LENGTH}>
            {t('เปลี่ยน PIN')}
          </Button>
        </div>
      </form>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </Card>
  )
}

import { useEffect, useState, type FormEvent } from 'react'
import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { biometricsAvailable, disableBiometrics, enableBiometrics, hasBiometrics, lockNow, removeLock, setPin, useLockState } from '../../security/lock'
import { t } from '../../i18n'

function PinInput({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field id={id} label={label}>
      <Input id={id} type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} />
    </Field>
  )
}

export function LockCard() {
  const state = useLockState()
  const [pin, setPinValue] = useState('')
  const [again, setAgain] = useState('')
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [canBio, setCanBio] = useState(false)
  const [bio, setBio] = useState(hasBiometrics())

  useEffect(() => {
    void biometricsAvailable().then(setCanBio)
  }, [])

  async function create(event: FormEvent) {
    event.preventDefault()
    if (pin !== again) return setMessage({ tone: 'error', text: t('PIN สองช่องไม่ตรงกัน') })
    try {
      await setPin(pin)
      setMessage({ tone: 'ok', text: t('ตั้ง PIN แล้ว แอปจะถามทุกครั้งที่เปิด และเมื่อออกไปนานกว่า 5 นาที') })
    } catch (e) {
      setMessage({ tone: 'error', text: (e as Error).message })
    }
    setPinValue('')
    setAgain('')
  }

  async function remove(event: FormEvent) {
    event.preventDefault()
    try {
      await removeLock(pin)
      setBio(false)
      setMessage({ tone: 'ok', text: t('ปิดการล็อกแล้ว') })
    } catch (e) {
      setMessage({ tone: 'error', text: (e as Error).message })
    }
    setPinValue('')
  }

  return (
    <Card className="grid gap-3">
      <div>
        <h2 className="text-lg font-semibold">{t('ล็อกแอป')}</h2>
        <p className="text-[12.5px] text-muted-foreground">{t('กันคนที่หยิบเครื่องไปเปิดดู · ข้อมูลในเครื่องไม่ได้ถูกเข้ารหัส ถ้าต้องการปกป้องไฟล์สำรอง ให้เข้ารหัสตอนสำรอง')}</p>
      </div>
      {state === 'off' ? (
        <form onSubmit={(e) => void create(e)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <PinInput id="lock-pin" label={t('PIN ใหม่ (ตัวเลข 4–8 หลัก)')} value={pin} onChange={setPinValue} />
          <PinInput id="lock-pin-again" label={t('PIN อีกครั้ง')} value={again} onChange={setAgain} />
          <Button type="submit" className="h-[46px]" disabled={pin.length < 4}>
            
            {t('ตั้ง PIN')}
          </Button>
        </form>
      ) : (
        <>
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
          <form onSubmit={(e) => void remove(e)} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <PinInput id="lock-current" label={t('PIN ปัจจุบัน (เพื่อปิดการล็อก)')} value={pin} onChange={setPinValue} />
            <Button type="submit" variant="outline" className="h-[46px]" disabled={pin.length < 4}>
              
              {t('ปิดการล็อก')}
            </Button>
          </form>
        </>
      )}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </Card>
  )
}

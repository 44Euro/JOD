import { ChevronLeft, FlaskConical, PencilLine, Plus, ScanLine, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { Button } from '../../components/ui/button'
import { buttonVariants } from '../../components/ui/button-variants'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { Input, NativeSelect } from '../../components/ui/input'
import { db } from '../../db/db'
import { addAccount, saveSettings, updateAccount } from '../../db/repo'
import { loadSampleData } from '../../db/sampleData'
import { COMMON_CURRENCIES, CURRENCY_NAMES, CURRENCY_OPTIONS } from '../../domain/currencies'
import { todayLocal } from '../../domain/dates'
import { cn } from '../../lib/cn'
import { BROKER_PRESETS, CHECK_WITH_BROKER, type BrokerPreset } from '../brokers'
import { feeTemplateSummary } from '../feeTemplateText'
import { Stations } from '../components/Stations'
import { useAppData } from '../hooks'
import { ThemeSync } from '../theme'
import { t } from '../../i18n'

const STEPS = [t('สกุลเงินหลัก'), t('บัญชีแรก'), t('เริ่มต้นใช้งาน')] as const

const BASE_CURRENCIES = COMMON_CURRENCIES.filter((c) => c !== 'USDT')

function currencyLabel(code: string): string {
  return CURRENCY_NAMES[code] ? `${code} · ${CURRENCY_NAMES[code]}` : code
}

const STARTS: { title: string; text: string; icon: LucideIcon; to: string }[] = [
  { title: t('นำเข้าจากรูปแคปหรือไฟล์'), text: t('แคปหน้าพอร์ตในแอปโบรก ให้ AI อ่าน แล้วตรวจก่อนบันทึก'), icon: ScanLine, to: '/import' },
  { title: t('กรอกยอดยกมา'), text: t('ใส่หุ้นที่ถืออยู่ จำนวน และทุนเฉลี่ย ไม่ต้องย้อนกรอกประวัติ'), icon: PencilLine, to: '/transactions/new?type=opening' },
  { title: t('บันทึกรายการแรก'), text: t('เริ่มจากรายการซื้อขายครั้งถัดไป'), icon: Plus, to: '/transactions/new' },
]

export function WelcomePage() {
  const data = useAppData()
  const navigate = useNavigate()
  const [hadAccounts, setHadAccounts] = useState<boolean | null>(null)
  const [step, setStep] = useState(0)
  const [base, setBase] = useState('THB')
  const [broker, setBroker] = useState<BrokerPreset | null>(null)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('THB')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!data) return null
  // Only an app that already had accounts when this page opened goes back; adding the first one here must not.
  if (hadAccounts === null) {
    setHadAccounts(data.accounts.length > 0)
    return null
  }
  if (hadAccounts) return <Navigate to="/" replace />

  function pick(preset: BrokerPreset) {
    setBroker(preset)
    setName(preset.accountName)
    setCurrency(preset.template.currency)
    setError('')
  }

  async function trySample() {
    setBusy(true)
    await loadSampleData(db, todayLocal())
    navigate('/', { replace: true })
  }

  async function saveAccount() {
    if (!name.trim()) {
      setError(t('ใส่ชื่อบัญชี'))
      return
    }
    setBusy(true)
    try {
      await saveSettings(db, { ...data!.settings, baseCurrency: base })
      const account = await addAccount(db, { name: name.trim(), broker: broker && broker.key !== 'custom' ? broker.label : '', note: '' })
      const template = broker ? { ...broker.template, currency } : undefined
      await updateAccount(db, account.id, { name: account.name, broker: account.broker, note: '', feeTemplate: template })
      setStep(2)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('บันทึกไม่สำเร็จ'))
    } finally {
      setBusy(false)
    }
  }

  const sampleLink = (
    <button
      type="button"
      disabled={busy}
      className="min-h-11 justify-self-start text-[13.5px] font-semibold text-primary-ink underline-offset-[3px] hover:underline disabled:opacity-50"
      onClick={() => void trySample()}
    >
      
      {t('ลองดูด้วยข้อมูลตัวอย่างก่อน')}
    </button>
  )

  return (
    <div className="grid min-h-dvh content-start justify-items-center bg-background px-4 pt-10 pb-16">
      <ThemeSync />
      <main className="grid w-full max-w-[640px] gap-[22px]">
        <p className="font-display text-[30px] font-semibold leading-none">
          JOD
          <span className="mt-1 block font-sans text-xs font-normal text-muted-foreground">{t('จดทุกเทรด รู้ทุกบาท')}</span>
        </p>
        <Stations steps={STEPS} step={step} />
        <p className="text-[12.5px] text-muted-foreground">
          
          {t('ข้อมูลเก็บในเครื่องนี้และซิงก์แบบเข้ารหัส ไม่มีตัวติดตาม ·')}{' '}
          <Link to="/privacy" className="font-semibold text-primary-ink underline underline-offset-[3px]">
            
            {t('นโยบายความเป็นส่วนตัว')}
          </Link>
        </p>

        {step === 0 && (
          <Card className="grid gap-4">
            <div>
              <h1 className="text-[26px] font-semibold md:text-[28px]">{t('สกุลเงินหลัก')}</h1>
              <p className="mt-1 text-muted-foreground">{t('ตัวเลขทั้งพอร์ตคิดเป็นสกุลนี้ ตั้งครั้งเดียวก่อนเริ่มบันทึก')}</p>
            </div>
            <Field id="welcome-base" label={t('สกุลเงินหลักของพอร์ต')}>
              <NativeSelect id="welcome-base" value={base} onChange={(e) => setBase(e.target.value)}>
                {BASE_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {currencyLabel(code)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {sampleLink}
              <Button type="button" onClick={() => setStep(1)}>
                
                {t('ถัดไป')}
              </Button>
            </div>
          </Card>
        )}

        {step === 1 && (
          <Card className="grid gap-4">
            <div>
              <h1 className="text-[26px] font-semibold md:text-[28px]">{t('เพิ่มบัญชีแรก')}</h1>
              <p className="mt-1 text-muted-foreground">{t('เลือกโบรกเกอร์ที่ใช้อยู่ แอปจะตั้งสกุลเงินและค่าธรรมเนียมเริ่มต้นให้ แก้ได้ทีหลัง')}</p>
            </div>
            <div role="group" aria-label={t('โบรกเกอร์')} className="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(130px,1fr))]">
              {BROKER_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  aria-pressed={broker?.key === preset.key}
                  onClick={() => pick(preset)}
                  className={cn(
                    'h-14 rounded-xl border bg-card text-[15px] font-semibold text-foreground hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none',
                    preset.key === 'custom' && 'border-dashed',
                    broker?.key === preset.key && 'border-2 border-primary bg-primary-soft text-primary-ink hover:bg-primary-soft',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="welcome-name" label={t('ชื่อบัญชี')}>
                <Input
                  id="welcome-name"
                  value={name}
                  aria-invalid={error ? true : undefined}
                  onChange={(e) => {
                    setName(e.target.value)
                    setError('')
                  }}
                />
              </Field>
              <Field id="welcome-currency" label={t('สกุลเงินของบัญชี')}>
                <NativeSelect id="welcome-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCY_OPTIONS.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            {broker && broker.key !== 'custom' && (
              <div className="grid gap-1">
                <p className="text-[13.5px] font-semibold text-ink-2">{t('ค่าธรรมเนียมเริ่มต้น')}</p>
                <p>{feeTemplateSummary({ ...broker.template, currency })}</p>
                <p className="text-[12.5px] text-muted-foreground">
                  {broker.note} · {CHECK_WITH_BROKER}
                </p>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep(0)}>
                <ChevronLeft aria-hidden />
                
                {t('ย้อนกลับ')}
              </Button>
              <Button type="button" disabled={busy} onClick={() => void saveAccount()}>
                
                {t('ถัดไป')}
              </Button>
            </div>
            {sampleLink}
          </Card>
        )}

        {step === 2 && (
          <Card>
            <h1 className="mb-3 text-[26px] font-semibold md:text-[28px]">{t('จะเริ่มอย่างไร')}</h1>
            <ul className="grid">
              {STARTS.map((start) => (
                <li key={start.title} className="border-t border-muted first:border-t-0">
                  <Link to={start.to} className="flex min-h-14 items-start gap-3 py-3 hover:bg-muted max-md:-mx-2 max-md:px-2">
                    <start.icon className="mt-0.5 size-5 shrink-0 text-ink-2" aria-hidden />
                    <span className="grid gap-0.5">
                      <span className="font-semibold">{start.title}</span>
                      <span className="text-[13px] text-muted-foreground">{start.text}</span>
                    </span>
                  </Link>
                </li>
              ))}
              <li className="border-t border-muted">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void trySample()}
                  className="flex min-h-14 w-full items-start gap-3 py-3 text-left hover:bg-muted disabled:opacity-50 max-md:-mx-2 max-md:px-2"
                >
                  <FlaskConical className="mt-0.5 size-5 shrink-0 text-ink-2" aria-hidden />
                  <span className="grid gap-0.5">
                    <span className="font-semibold">{t('ลองดูด้วยข้อมูลตัวอย่าง')}</span>
                    <span className="text-[13px] text-muted-foreground">{t('ลบทิ้งได้ทีหลังในหน้าตั้งค่า')}</span>
                  </span>
                </button>
              </li>
            </ul>
            <Link to="/" className={cn(buttonVariants({ variant: 'outline' }), 'mt-3')}>
              
              {t('ไปที่ภาพรวม')}
            </Link>
          </Card>
        )}
      </main>
    </div>
  )
}

import { Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Field } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { Segmented } from '../../components/ui/segmented'
import { db } from '../../db/db'
import { newId, saveSettings } from '../../db/repo'
import { validateAlert } from '../../domain/alerts'
import { parseDecimalInput } from '../../domain/decimal'
import type { PriceAlert, Settings } from '../../domain/types'
import { fmtPrice } from '../format'
import { t } from '../../i18n'

const DIRECTIONS = [
  { value: 'below', label: t('ต่ำกว่า') },
  { value: 'above', label: t('สูงกว่า') },
] as const

export const symbolOfId = (instrumentId: string) => instrumentId.split(':')[1] ?? instrumentId

export function alertLabel(alert: PriceAlert): string {
  return `${symbolOfId(alert.instrumentId)} ${alert.direction === 'above' ? t('สูงกว่า') : t('ต่ำกว่า')} ${fmtPrice(alert.price)}`
}

export function saveAlerts(settings: Settings, alerts: PriceAlert[]): Promise<void> {
  return saveSettings(db, { ...settings, alerts: alerts.length > 0 ? alerts : undefined })
}

export function AlertForm({ instrumentId, settings, onDone }: { instrumentId: string; settings: Settings; onDone?(): void }) {
  const [direction, setDirection] = useState<PriceAlert['direction']>('below')
  const [price, setPrice] = useState('')
  const [errors, setErrors] = useState<string[]>([])

  async function save(event: FormEvent) {
    event.preventDefault()
    const value = parseDecimalInput(price) ?? price.trim()
    const problems = validateAlert(value)
    setErrors(problems)
    if (problems.length > 0) return
    await saveAlerts(settings, [...(settings.alerts ?? []), { id: newId(), instrumentId, direction, price: value, createdAt: new Date().toISOString() }])
    setPrice('')
    onDone?.()
  }

  return (
    <form aria-label={t('ตั้งแจ้งเตือนราคา {0}', symbolOfId(instrumentId))} onSubmit={(e) => void save(e)} className="grid gap-3 sm:grid-cols-[auto_minmax(0,220px)_auto] sm:items-end">
      <Segmented label={t('เมื่อราคา')} options={DIRECTIONS} value={direction} onChange={setDirection} />
      <Field id={`alert-price-${instrumentId}`} label={t('ราคา')}>
        <Input id={`alert-price-${instrumentId}`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
      </Field>
      <Button type="submit">{t('ตั้งแจ้งเตือน')}</Button>
      {errors.length > 0 && (
        <Alert tone="error" className="sm:col-span-3">
          {errors.join(' · ')}
        </Alert>
      )}
    </form>
  )
}

// Alerts that have not fired yet; each fires once and then leaves the list.
export function AlertList({ alerts, settings, label = t('แจ้งเตือนราคา') }: { alerts: readonly PriceAlert[]; settings: Settings; label?: string }) {
  const active = alerts.filter((a) => !a.firedAt)
  if (active.length === 0) return null
  return (
    <ul aria-label={label}>
      {active.map((alert) => (
        <li key={alert.id} aria-label={alertLabel(alert)} className="flex items-center justify-between gap-3 border-t py-2 first:border-t-0">
          <span className="text-[15px]">
            <b className="font-display">{symbolOfId(alert.instrumentId)}</b> {alert.direction === 'above' ? t('สูงกว่า') : t('ต่ำกว่า')} {fmtPrice(alert.price)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('ลบแจ้งเตือน {0}', alertLabel(alert))}
            onClick={() => void saveAlerts(settings, (settings.alerts ?? []).filter((a) => a.id !== alert.id))}
          >
            <Trash2 aria-hidden />
          </Button>
        </li>
      ))}
    </ul>
  )
}

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { Input, NativeSelect } from '../../components/ui/input'
import { db } from '../../db/db'
import { renameInstrument } from '../../db/repo'
import { UNITS, unitOf, type Instrument, type Unit } from '../../domain/types'
import { UNIT_LABELS } from '../labels'
import { assetPath } from '../nav'
import { t } from '../../i18n'

export function RenameInstrument({ instrument, onClose }: { instrument: Instrument; onClose(): void }) {
  const navigate = useNavigate()
  const [symbol, setSymbol] = useState(instrument.symbol)
  const [name, setName] = useState(instrument.name)
  const [unit, setUnit] = useState<Unit>(unitOf(instrument))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const symbolInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    symbolInput.current?.focus()
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const newId = await renameInstrument(db, instrument.id, { symbol, name, unit })
      onClose()
      navigate(assetPath(newId), { replace: true })
    } catch (failure) {
      setError((failure as Error).message)
      setSaving(false)
    }
  }

  return (
    <Card>
      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="grid gap-3.5">
        <div>
          <h2 className="text-base font-semibold">{t('เปลี่ยนชื่อ/สัญลักษณ์')}</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">{t('ประวัติรายการทั้งหมดจะตามไปที่ชื่อใหม่')}</p>
        </div>
        <div className="grid gap-3.5 sm:grid-cols-3">
          <Field id="asset-symbol" label={t('สัญลักษณ์')}>
            <Input
              id="asset-symbol"
              ref={symbolInput}
              autoCapitalize="characters"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
            />
          </Field>
          <Field id="asset-name" label={t('ชื่อ')}>
            <Input id="asset-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="asset-unit" label={t('หน่วยนับ')}>
            <NativeSelect id="asset-unit" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABELS[u]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={saving}>
            
            {t('บันทึก')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            
            {t('ยกเลิก')}
          </Button>
        </div>
      </form>
    </Card>
  )
}

import { Pencil } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { Input, Textarea } from '../../components/ui/input'
import { db } from '../../db/db'
import { saveInstrumentThesis } from '../../db/repo'
import { parseDecimalInput } from '../../domain/decimal'
import type { Instrument } from '../../domain/types'
import { validateThesis } from '../../domain/validation'
import { fmtDate, fmtPrice } from '../format'
import { t } from '../../i18n'

export function ThesisCard({ instrument, today }: { instrument: Instrument; today: string }) {
  const [editing, setEditing] = useState(false)
  const [reason, setReason] = useState('')
  const [target, setTarget] = useState('')
  const [reviewDate, setReviewDate] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const due = instrument.reviewDate !== undefined && instrument.reviewDate <= today

  function startEditing() {
    setReason(instrument.holdReason ?? '')
    setTarget(instrument.targetPrice ?? '')
    setReviewDate(instrument.reviewDate ?? '')
    setErrors([])
    setEditing(true)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const targetPrice = target.trim() === '' ? '' : (parseDecimalInput(target) ?? target.trim())
    const thesis = { holdReason: reason, targetPrice, reviewDate }
    const problems = validateThesis(thesis)
    setErrors(problems)
    if (problems.length > 0) return
    try {
      await saveInstrumentThesis(db, instrument.id, thesis)
      setEditing(false)
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)])
    }
  }

  if (editing) {
    return (
      <Card>
        <form className="grid gap-3.5" onSubmit={(e) => void save(e)} noValidate>
          <h2 className="text-base font-semibold">{t('เหตุผลที่ถือ')}</h2>
          <Field id="hold-reason" label={t('ทำไมถึงซื้อ / ถือ')}>
            <Textarea id="hold-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field id="target-price" label={t('ราคาเป้าหมาย ({0})', instrument.currency)}>
            <Input id="target-price" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
          <Field id="review-date" label={t('วันทบทวน')}>
            <Input id="review-date" type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
          </Field>
          {errors.length > 0 && (
            <p role="alert" className="text-[13px] text-destructive">
              {errors.join(' · ')}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit">{t('บันทึก')}</Button>
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
              {t('ยกเลิก')}
            </Button>
          </div>
        </form>
      </Card>
    )
  }

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{t('เหตุผลที่ถือ')}</h2>
        <Button type="button" variant="ghost" size="icon" aria-label={t('แก้ไขเหตุผลที่ถือ')} onClick={startEditing}>
          <Pencil aria-hidden />
        </Button>
      </div>
      <p className="text-[14.5px] whitespace-pre-line">
        {instrument.holdReason ?? <span className="text-muted-foreground">{t('ยังไม่ได้เขียนเหตุผล · กดปุ่มแก้ไขเพื่อจดไว้')}</span>}
      </p>
      <dl className="mt-2.5 grid text-sm">
        <div className="flex justify-between gap-3 border-t border-muted py-2.5">
          <dt className="text-muted-foreground">{t('ราคาเป้าหมาย')}</dt>
          <dd>{instrument.targetPrice ? `${fmtPrice(instrument.targetPrice)} ${instrument.currency}` : '—'}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-muted py-2.5">
          <dt className="text-muted-foreground">{t('วันทบทวน')}</dt>
          <dd className="flex items-center gap-2">
            {due && <Badge variant="warning">{t('ถึงวันทบทวนแล้ว')}</Badge>}
            {fmtDate(instrument.reviewDate)}
          </dd>
        </div>
      </dl>
    </Card>
  )
}

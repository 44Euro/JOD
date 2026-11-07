import { useId, useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/button'
import { Chip } from '../../components/ui/chip'
import { Field } from '../../components/ui/field'
import { Textarea } from '../../components/ui/input'
import { Segmented } from '../../components/ui/segmented'
import { db } from '../../db/db'
import { saveTradeReview } from '../../db/repo'
import { MISTAKES, type Mistake, type TradeJournal } from '../../domain/types'
import { MISTAKE_LABELS } from '../labels'
import { t } from '../../i18n'

const SCORES = ['1', '2', '3', '4', '5'].map((value) => ({ value, label: value }))

const labelClass = 'text-[13px] font-semibold text-ink-2'

// journal is the one of the sell that closed the trade, which is where the review is written.
export function TradeReviewForm({
  name,
  txId,
  journal,
  onSaving,
  onSaveFailed,
  onSaved,
  onClose,
}: {
  name: string
  txId: string
  journal: TradeJournal | undefined
  // The page hears of the write before it starts, because the new data can reach it before the write's own promise settles.
  onSaving(): void
  onSaveFailed(): void
  onSaved(): void
  onClose(): void
}) {
  const id = useId()
  const [review, setReview] = useState(journal?.review ?? '')
  const [mistakes, setMistakes] = useState<Mistake[]>(journal?.mistakes ?? [])
  const [score, setScore] = useState(journal?.score?.toString() ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const toggleMistake = (mistake: Mistake) =>
    setMistakes((current) => (current.includes(mistake) ? current.filter((m) => m !== mistake) : [...current, mistake]))

  async function save(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSaving(true)
    onSaving()
    try {
      await saveTradeReview(db, txId, { review, mistakes, score: score ? Number(score) : undefined })
    } catch (e) {
      onSaveFailed()
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
      return
    }
    onSaved()
  }

  return (
    <form
      aria-label={t('รีวิวเทรด {0}', name)}
      className="grid gap-3.5 rounded-2xl border p-3 min-[360px]:p-4"
      onSubmit={(e) => void save(e)}
      noValidate
    >
      <Field id={`${id}-review`} label={t('รีวิวหลังปิด')}>
        <Textarea id={`${id}-review`} value={review} onChange={(e) => setReview(e.target.value)} />
      </Field>
      <div className="grid gap-1.5">
        <span id={`${id}-mistakes`} className={labelClass}>
          {t('ข้อผิดพลาดที่ทำ')}
        </span>
        <div role="group" aria-labelledby={`${id}-mistakes`} className="flex flex-wrap gap-2">
          {MISTAKES.map((mistake) => (
            <Chip key={mistake} active={mistakes.includes(mistake)} onClick={() => toggleMistake(mistake)}>
              {MISTAKE_LABELS[mistake]}
            </Chip>
          ))}
        </div>
      </div>
      <div className="grid gap-1.5">
        <span aria-hidden className={labelClass}>
          {t('คะแนนการลงมือ')}
        </span>
        {/* A segment cannot be pressed off, so pressing the chosen number again takes the score back. */}
        <Segmented
          label={t('คะแนนการลงมือ')}
          options={SCORES}
          value={score}
          onChange={(value) => setScore((current) => (current === value ? '' : value))}
          singleRow
          className="max-[360px]:gap-0 max-[360px]:p-0.5 md:w-fit"
        />
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {t('บันทึก')}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          {t('ยกเลิก')}
        </Button>
      </div>
    </form>
  )
}

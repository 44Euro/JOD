import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Chip } from '../../../components/ui/chip'
import { Field } from '../../../components/ui/field'
import { Input, Textarea } from '../../../components/ui/input'
import { Segmented } from '../../../components/ui/segmented'
import { EMOTIONS, MISTAKES, type Mistake } from '../../../domain/types'
import { cn } from '../../../lib/cn'
import { EMOTION_LABELS, MISTAKE_LABELS } from '../../labels'
import { journalFromDraft, type Draft, type JournalDraft } from '../../transactionDraft'
import { FieldGroup } from './FieldGroup'

const SCALE = ['1', '2', '3', '4', '5'].map((value) => ({ value, label: value }))

const labelClass = 'text-[13.5px] font-semibold text-ink-2'

// The visible name is hidden from screen readers because the group carries the same one.
function Choices({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span aria-hidden className={labelClass}>
        {label}
      </span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        {children}
      </div>
    </div>
  )
}

// A segment cannot be pressed off again, so a chosen value gets a button to clear it. The row keeps its height whether or
// not the button is there, so choosing a number does not move the numbers under the finger.
function Scale({ id, label, value, onChange }: { id: string; label: string; value: string; onChange(value: string): void }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex min-h-11 items-center justify-between gap-2 md:min-h-0">
        <span id={`${id}-label`} aria-hidden className={labelClass}>
          {label}
        </span>
        {value && (
          <button
            type="button"
            aria-describedby={`${id}-label`}
            className="inline-flex min-h-11 items-center rounded-lg px-2 text-[13px] font-semibold text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 md:min-h-0"
            onClick={() => onChange('')}
          >
            ล้าง
          </button>
        )}
      </div>
      <Segmented label={label} options={SCALE} value={value} onChange={onChange} />
    </div>
  )
}

export function TradeJournalFields({
  draft,
  strategies,
  setDraft,
}: {
  draft: Draft
  strategies: readonly string[]
  setDraft(change: (d: Draft) => Draft): void
}) {
  const journal = draft.journal
  // A journal that already says something opens unfolded, so an edit shows what was written.
  const [open, setOpen] = useState(() => journalFromDraft(journal) !== undefined)
  const patch = (change: Partial<JournalDraft>) => setDraft((d) => ({ ...d, journal: { ...d.journal, ...change } }))
  const toggleMistake = (mistake: Mistake) =>
    patch({ mistakes: journal.mistakes.includes(mistake) ? journal.mistakes.filter((m) => m !== mistake) : [...journal.mistakes, mistake] })

  return (
    <div className="rounded-2xl border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 aria-expanded:rounded-b-none"
      >
        <span className="min-w-0">
          <span className="font-semibold text-ink-2">บันทึกการเทรด (ไม่บังคับ)</span>
          {!open && (
            <span aria-hidden className="text-muted-foreground">
              {' '}
              · กลยุทธ์ เหตุผล อารมณ์ Stop loss
            </span>
          )}
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="grid gap-3.5 border-t p-4">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field id="tx-journal-strategy" label="กลยุทธ์">
              <Input
                id="tx-journal-strategy"
                list="trade-strategies"
                autoComplete="off"
                value={journal.strategy}
                onChange={(e) => patch({ strategy: e.target.value })}
              />
              <datalist id="trade-strategies">
                {strategies.map((strategy) => (
                  <option key={strategy} value={strategy} />
                ))}
              </datalist>
            </Field>
            <Field id="tx-journal-tags" label="แท็ก" hint="คั่นด้วยจุลภาค เช่น earnings, gap">
              <Input id="tx-journal-tags" value={journal.tags} onChange={(e) => patch({ tags: e.target.value })} />
            </Field>
          </div>
          <Field id="tx-journal-reason" label="เหตุผลที่เข้า">
            <Textarea id="tx-journal-reason" value={journal.reason} onChange={(e) => patch({ reason: e.target.value })} />
          </Field>
          <Choices label="อารมณ์ตอนเข้า">
            {EMOTIONS.map((emotion) => (
              <Chip key={emotion} active={journal.emotion === emotion} onClick={() => patch({ emotion: journal.emotion === emotion ? '' : emotion })}>
                {EMOTION_LABELS[emotion]}
              </Chip>
            ))}
          </Choices>
          <Scale id="tx-journal-confidence" label="ความมั่นใจ" value={journal.confidence} onChange={(confidence) => patch({ confidence })} />
          <div className="grid grid-cols-2 gap-3.5">
            <Field id="tx-journal-stop-loss" label="Stop loss">
              <Input id="tx-journal-stop-loss" inputMode="decimal" value={journal.stopLoss} onChange={(e) => patch({ stopLoss: e.target.value })} />
            </Field>
            <Field id="tx-journal-target" label="Target">
              <Input id="tx-journal-target" inputMode="decimal" value={journal.target} onChange={(e) => patch({ target: e.target.value })} />
            </Field>
          </div>
          {draft.type === 'sell' && (
            <FieldGroup legend="หลังปิดเทรด" divided>
              <Field id="tx-journal-review" label="รีวิวหลังปิด">
                <Textarea id="tx-journal-review" value={journal.review} onChange={(e) => patch({ review: e.target.value })} />
              </Field>
              <Choices label="ข้อผิดพลาดที่ทำ">
                {MISTAKES.map((mistake) => (
                  <Chip key={mistake} active={journal.mistakes.includes(mistake)} onClick={() => toggleMistake(mistake)}>
                    {MISTAKE_LABELS[mistake]}
                  </Chip>
                ))}
              </Choices>
              <Scale id="tx-journal-score" label="คะแนนการลงมือ" value={journal.score} onChange={(score) => patch({ score })} />
            </FieldGroup>
          )}
        </div>
      )}
    </div>
  )
}

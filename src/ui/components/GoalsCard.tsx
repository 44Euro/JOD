import { Plus, Trash2 } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Chip } from '../../components/ui/chip'
import { Field } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { db } from '../../db/db'
import { newId, saveSettings } from '../../db/repo'
import { todayLocal } from '../../domain/dates'
import { D, parseDecimalInput, sumBy } from '../../domain/decimal'
import { goalPlan, validateGoal } from '../../domain/goals'
import { positionValueBase } from '../../domain/investor'
import { portfolioReturn } from '../../domain/returns'
import type { Goal } from '../../domain/types'
import { cn } from '../../lib/cn'
import { fmtDate, fmtHeadline, fmtPct } from '../format'
import { useInvestor, type AppData } from '../hooks'
import { t } from '../../i18n'

// Today's value at the left station and the target at the right, the line filled as far as the value has come.
function GoalRoute({ sharePct, reached }: { sharePct: number; reached: boolean }) {
  return (
    <div aria-hidden className="flex items-center">
      <span className="size-6 shrink-0 rounded-full border-[5px] border-foreground bg-card" />
      <span className="relative h-[5px] flex-1 rounded-full bg-route-neutral">
        <span className="absolute inset-y-0 left-0 rounded-full bg-foreground" style={{ width: `${sharePct}%` }} />
      </span>
      <span className={cn('size-6 shrink-0 rounded-full border-[5px] bg-card', reached ? 'border-foreground' : 'border-route-neutral')} />
    </div>
  )
}

function GoalForm({ data, onDone }: { data: AppData; onDone(): void }) {
  const base = data.settings.baseCurrency
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [accountIds, setAccountIds] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])

  async function save(event: FormEvent) {
    event.preventDefault()
    const amount = parseDecimalInput(target) ?? target.trim()
    const problems = validateGoal({ name, target: amount, targetDate }, todayLocal())
    setErrors(problems)
    if (problems.length > 0) return
    const goal: Goal = { id: newId(), name: name.trim(), target: amount, targetDate, createdAt: new Date().toISOString(), ...(accountIds.length > 0 ? { accountIds } : {}) }
    await saveSettings(db, { ...data.settings, goals: [...(data.settings.goals ?? []), goal] })
    onDone()
  }

  return (
    <form onSubmit={(e) => void save(e)} className="grid gap-3 sm:grid-cols-3">
      <Field id="goal-name" label={t('ชื่อเป้าหมาย')}>
        <Input id="goal-name" value={name} maxLength={40} placeholder={t('เช่น เงินดาวน์บ้าน')} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id="goal-target" label={t('จำนวนเงิน ({0})', base)}>
        <Input id="goal-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
      </Field>
      <Field id="goal-date" label={t('ภายในวันที่')}>
        <Input id="goal-date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
      </Field>
      {data.accounts.length > 1 && (
        <fieldset className="grid gap-1.5 sm:col-span-3">
          <legend className="mb-1.5 text-[13px] font-semibold text-ink-2">{t('นับจากบัญชี (ไม่เลือก = ทุกบัญชี)')}</legend>
          <div className="flex flex-wrap gap-2">
            {data.accounts.map((a) => (
              <Chip key={a.id} active={accountIds.includes(a.id)} onClick={() => setAccountIds((ids) => (ids.includes(a.id) ? ids.filter((x) => x !== a.id) : [...ids, a.id]))}>
                {a.name}
              </Chip>
            ))}
          </div>
        </fieldset>
      )}
      {errors.length > 0 && (
        <Alert tone="error" className="sm:col-span-3">
          {errors.join(' · ')}
        </Alert>
      )}
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit">{t('บันทึกเป้าหมาย')}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('ยกเลิก')}
        </Button>
      </div>
    </form>
  )
}

// The top of แผน: where the money is heading and what it takes each month to get there.
export function GoalsCard({ data }: { data: AppData }) {
  const id = useId()
  const { valuations, investor } = useInvestor(data)
  const goals = data.settings.goals ?? []
  const [shownId, setShownId] = useState<string>()
  const [adding, setAdding] = useState(false)
  const base = data.settings.baseCurrency
  const today = todayLocal()
  const shown = goals.find((g) => g.id === shownId) ?? goals[0]

  async function remove(goal: Goal) {
    const rest = goals.filter((g) => g.id !== goal.id)
    await saveSettings(db, { ...data.settings, goals: rest.length > 0 ? rest : undefined })
  }

  let body = null
  if (shown && investor) {
    const inScope = (accountId: string) => !shown.accountIds?.length || shown.accountIds.includes(accountId)
    const value = sumBy(
      valuations.filter((v) => inScope(v.position.accountId)),
      positionValueBase,
    ).plus(sumBy(investor.worth.cash.filter((c) => inScope(c.accountId)), (c) => c.base ?? D(0)))
    const history = portfolioReturn(investor.flows, investor.worth.totalBase, today)
    const annualPct = history.annualized ? history.annualPct : null
    const plan = goalPlan({ current: value, target: D(shown.target), today, targetDate: shown.targetDate, annualPct })
    const names = shown.accountIds?.map((a) => data.accounts.find((x) => x.id === a)?.name ?? a)
    body = (
      <div className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-[15px] font-semibold">{shown.name}</p>
          <p className="text-[13px] text-ink-2">{t('เป้า {0} ภายใน {1}', fmtHeadline(shown.target, base), fmtDate(shown.targetDate))}</p>
        </div>
        <GoalRoute sharePct={plan.sharePct.toNumber()} reached={plan.reached} />
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[13px]">
          <span className="font-semibold">{t('มีแล้ว {0} · {1}', fmtHeadline(value, base), fmtPct(plan.sharePct, 0))}</span>
          <span className="text-muted-foreground">{names ? t('นับจาก {0}', names.join(', ')) : t('นับจากทุกบัญชี')}</span>
        </div>
        {plan.reached ? (
          <p className="text-[15px] font-semibold text-gain">{t('ถึงเป้าแล้ว')}</p>
        ) : plan.months === 0 ? (
          <p className="text-[15px] text-ink-2">{t('ถึงวันที่ตั้งไว้แล้ว ยังขาดอีก {0}', fmtHeadline(D(shown.target).minus(value), base))}</p>
        ) : (
          <ul className="grid gap-1 text-[15px] text-ink-2">
            <li>{t('อีก {0} เดือน', plan.months)}</li>
            <li>{t('ถ้าไม่มีผลตอบแทน ต้องออมเดือนละ {0}', fmtHeadline(plan.flatMonthly!, base))}</li>
            {plan.returnMonthly && annualPct && (
              <li>{t('ถ้าได้ผลตอบแทนปีละ {0} เท่าที่ผ่านมา ต้องออมเดือนละ {1}', fmtPct(annualPct, 1), fmtHeadline(plan.returnMonthly, base))}</li>
            )}
          </ul>
        )}
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => void remove(shown)}>
            <Trash2 aria-hidden />
            <span className="sr-only">{t('ลบเป้าหมาย {0}', shown.name)}</span>
            <span aria-hidden>{t('ลบ')}</span>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Card role="region" aria-labelledby={id} className="grid gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={id} className="text-lg font-semibold">
          {t('เป้าหมาย')}
        </h2>
        {!adding && (
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            {t('เพิ่มเป้าหมาย')}
          </Button>
        )}
      </div>
      {goals.length > 1 && (
        <div role="group" aria-label={t('เลือกเป้าหมาย')} className="flex flex-wrap gap-2">
          {goals.map((g) => (
            <Chip key={g.id} active={g.id === shown?.id} onClick={() => setShownId(g.id)}>
              {g.name}
            </Chip>
          ))}
        </div>
      )}
      {adding && <GoalForm data={data} onDone={() => setAdding(false)} />}
      {goals.length === 0 && !adding && (
        <p className="text-[15px] text-ink-2">{t('ตั้งเป้า เช่น เงินดาวน์ ฿1,000,000 ภายในปี 2028 แล้วดูว่าต้องออมเดือนละเท่าไร')}</p>
      )}
      {body}
    </Card>
  )
}

import { useLiveQuery } from 'dexie-react-hooks'
import { Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { Input, NativeSelect } from '../../components/ui/input'
import { Segmented } from '../../components/ui/segmented'
import { db } from '../../db/db'
import { deletePlan, newId, savePlan, setTargetPct } from '../../db/repo'
import { todayLocal } from '../../domain/dates'
import { D, parseDecimalInput } from '../../domain/decimal'
import { positionValueBase } from '../../domain/investor'
import { planProgress, rebalance } from '../../domain/plans'
import { PLAN_FREQUENCIES, symbolOf, type DcaPlan, type Instrument, type PlanFrequency } from '../../domain/types'
import { cn } from '../../lib/cn'
import { GoalsCard } from '../components/GoalsCard'
import { MarketPill } from '../components/MarketPill'
import { PageHeader } from '../components/PageHeader'
import { ChecklistCard } from '../components/WatchCards'
import { fmtDate, fmtHeadline, fmtMonth, fmtPct, fmtPrice, fmtValue } from '../format'
import { useAppData, usePortfolio, type AppData } from '../hooks'
import { marketOf } from '../labels'
import { t } from '../../i18n'
import { PageLoading } from '../components/PageLoading'

const FREQUENCY_LABELS: Record<PlanFrequency, string> = {
  weekly: t('ทุกสัปดาห์'),
  monthly: t('ทุกเดือน'),
}

function AssetName({ id, instrument }: { id: string; instrument?: Instrument }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <MarketPill market={instrument?.market ?? marketOf(id)} assetType={instrument?.assetType} />
      <b className="min-w-0 truncate font-display">{instrument?.symbol ?? symbolOf(id)}</b>
    </span>
  )
}

function TargetInput({ instrument }: { instrument: Instrument }) {
  const [value, setValue] = useState(instrument.targetPct ?? '')
  const [error, setError] = useState(false)
  return (
    <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
      {t('เป้า')}
      <Input
        aria-label={t('เป้าหมายของ {0} (%)', instrument.symbol)}
        inputMode="decimal"
        placeholder="—"
        value={value}
        aria-invalid={error || undefined}
        className="h-10 w-20 text-right tabular-nums"
        onChange={(e) => {
          setValue(e.target.value)
          setError(false)
        }}
        onBlur={() => {
          if ((instrument.targetPct ?? '') === value.trim()) return
          setTargetPct(db, instrument.id, value).catch(() => setError(true))
        }}
      />
      %
    </span>
  )
}

function TargetsCard({ data }: { data: AppData }) {
  const { valuations } = usePortfolio(data)
  const [cash, setCash] = useState('')
  const base = data.settings.baseCurrency
  const holdings = valuations.map((v) => ({
    instrumentId: v.position.instrumentId,
    valueBase: positionValueBase(v),
  }))
  const targets = Object.fromEntries(data.instruments.filter((i) => i.targetPct).map((i) => [i.id, i.targetPct!]))
  const newCash = D(parseDecimalInput(cash) ?? 0)
  const plan = rebalance(holdings, targets, newCash)
  const byId = new Map(data.instruments.map((i) => [i.id, i]))
  const rows = [...plan.rows].sort((a, b) => b.valueBase.comparedTo(a.valueBase))
  const action = (amount: ReturnType<typeof D> | null) =>
    !amount || amount.abs().lt(1) ? '—' : amount.gt(0) ? t('ซื้อ {0}', fmtHeadline(amount, base)) : t('ขาย {0}', fmtHeadline(amount.abs(), base))

  return (
    <Card className="grid gap-3">
      <h2 className="text-lg font-semibold">{t('สัดส่วนเป้าหมาย')}</h2>
      <Field
        id="rebalance-cash"
        label={t('เงินที่จะเติมเข้าพอร์ต ({0})', base)}
        hint={t('ไม่บังคับ ใส่แล้วจะเห็นว่าควรซื้ออะไรเท่าไรโดยไม่ต้องขาย')}
        className="sm:max-w-xs"
      >
        <Input id="rebalance-cash" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
      </Field>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('ยังไม่มีสินทรัพย์ที่ถืออยู่')}</p>
      ) : (
        <ul aria-label={t('สัดส่วนแต่ละตัว')}>
          {rows.map((row) => {
            const instrument = byId.get(row.instrumentId)
            return (
              <li
                key={row.instrumentId}
                className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-t border-muted py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto_auto_minmax(120px,auto)]"
              >
                <AssetName id={row.instrumentId} instrument={instrument} />
                <span className="text-right text-[13px] text-muted-foreground tabular-nums sm:order-none">
                  {t('ตอนนี้ ')}{fmtPct(row.currentPct, 1)}
                </span>
                {instrument ? <TargetInput key={instrument.targetPct ?? ''} instrument={instrument} /> : <span />}
                <span className="text-right text-sm tabular-nums">
                  <span className={cn('block', row.diffBase?.gt(0) && 'text-gain', row.diffBase?.lt(0) && 'text-loss')}>
                    {action(row.diffBase)}
                  </span>
                  {newCash.gt(0) && row.buyOnlyBase && row.buyOnlyBase.gte(1) && (
                    <span className="block text-[12px] text-muted-foreground">{t('ไม่ขาย: ซื้อ ')}{fmtHeadline(row.buyOnlyBase, base)}</span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {plan.targetSum.gt(0) && !plan.targetSum.eq(100) && (
        <Alert>{t('เป้าหมายรวมกันได้ ')}{fmtPct(plan.targetSum, 1)} {t(' ส่วนที่เหลือเป็นของตัวที่ไม่ได้ตั้งเป้า')}</Alert>
      )}
      <p className="text-[12px] text-muted-foreground">
        {t('มูลค่าคิดจากราคาล่าสุดที่บันทึกไว้ อัปเดตราคาก่อนเพื่อให้ตัวเลขตรง')}
      </p>
    </Card>
  )
}

const STATE_CLASS = {
  done: 'bg-gain',
  partial: 'bg-warning-fg',
  missed: 'bg-loss',
  current: 'border-2 border-primary bg-card',
}
const STATE_LABEL = {
  done: t('ครบ'),
  partial: t('ยังไม่ครบ'),
  missed: t('ไม่ได้ซื้อ'),
  current: t('งวดนี้'),
}

function PlanRow({ plan, data, today }: { plan: DcaPlan; data: AppData; today: string }) {
  const periods = planProgress(plan, data.transactions, today)
  const done = periods.filter((p) => p.state === 'done').length
  const past = periods.filter((p) => p.state !== 'current').length
  const current = periods.find((p) => p.state === 'current')
  const account = data.accounts.find((a) => a.id === plan.accountId)
  const instrument = data.instruments.find((i) => i.id === plan.instrumentId)
  return (
    <li className="grid gap-2 border-t border-muted py-3.5 first:border-t-0">
      <div className="flex items-start justify-between gap-2">
        <span className="grid gap-0.5">
          <AssetName id={plan.instrumentId} instrument={instrument} />
          <span className="text-[13px] text-muted-foreground">
            {fmtPrice(plan.amount)} {plan.currency} {FREQUENCY_LABELS[plan.frequency]} · {account?.name ?? t('บัญชีที่ลบไปแล้ว')} {t(' · เริ่ม')}{' '}
            {fmtDate(plan.startDate)}
          </span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('ลบแผน {0}', instrument?.symbol ?? symbolOf(plan.instrumentId))}
          onClick={() => void deletePlan(db, plan.id)}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
      <ol aria-label={t('งวดล่าสุด')} className="flex flex-wrap gap-1.5">
        {periods.slice(-12).map((p) => (
          <li
            key={p.start}
            title={`${plan.frequency === 'monthly' ? fmtMonth(p.start.slice(0, 7), true) : fmtDate(p.start)} · ${STATE_LABEL[p.state]} · ${fmtValue(p.spent)} ${plan.currency}`}
            className={cn('size-3.5 rounded-full', STATE_CLASS[p.state])}
          >
            <span className="sr-only">{STATE_LABEL[p.state]}</span>
          </li>
        ))}
      </ol>
      <p className="text-[13px]">
        {t('ครบ ')}{done} {t(' จาก ')}{past} {t(' งวดที่ผ่านมา')}
        {current && t(' · งวดนี้ซื้อแล้ว {0} จาก {1} {2}', fmtValue(current.spent), fmtPrice(plan.amount), plan.currency)}
      </p>
    </li>
  )
}

function PlansCard({ data }: { data: AppData }) {
  const plans = useLiveQuery(() => db.plans.toArray(), [])
  const today = todayLocal()
  const [accountId, setAccountId] = useState(data.accounts[0]?.id ?? '')
  const [instrumentId, setInstrumentId] = useState('')
  const [amount, setAmount] = useState('')
  const [frequency, setFrequency] = useState<PlanFrequency>('monthly')
  const [startDate, setStartDate] = useState(today)
  const [error, setError] = useState('')
  const instruments = [...data.instruments].sort((a, b) => a.symbol.localeCompare(b.symbol))
  const chosen = data.instruments.find((i) => i.id === instrumentId)

  async function add(event: FormEvent) {
    event.preventDefault()
    try {
      await savePlan(db, {
        id: newId(),
        accountId,
        instrumentId,
        amount: parseDecimalInput(amount) ?? amount,
        currency: chosen?.currency ?? '',
        frequency,
        startDate,
        createdAt: new Date().toISOString(),
      })
      setAmount('')
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('บันทึกไม่สำเร็จ'))
    }
  }

  return (
    <Card className="grid gap-3">
      <h2 className="text-lg font-semibold">{t('แผนทยอยซื้อ')}</h2>
      {plans && plans.length > 0 && (
        <ul aria-label={t('แผนที่มี')}>
          {plans.map((plan) => (
            <PlanRow key={plan.id} plan={plan} data={data} today={today} />
          ))}
        </ul>
      )}
      <form onSubmit={(e) => void add(e)} className="grid gap-3 border-t pt-4 sm:grid-cols-2">
        <Field id="plan-account" label={t('บัญชี')}>
          <NativeSelect id="plan-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="plan-asset" label={t('สินทรัพย์')}>
          <NativeSelect id="plan-asset" value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}>
            <option value="">{t('เลือก')}</option>
            {instruments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.symbol} · {i.currency}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="plan-amount" label={t('ซื้องวดละ{0}', chosen ? ` (${chosen.currency})` : '')}>
          <Input id="plan-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field id="plan-start" label={t('เริ่ม')}>
          <Input id="plan-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <div className="grid content-start gap-1.5 sm:col-span-2">
          <span className="text-[13px] font-semibold text-ink-2">{t('ความถี่')}</span>
          <Segmented
            label={t('ความถี่')}
            options={PLAN_FREQUENCIES.map((value) => ({
              value,
              label: FREQUENCY_LABELS[value],
            }))}
            value={frequency}
            onChange={setFrequency}
          />
        </div>
        {error && (
          <Alert tone="error" className="sm:col-span-2">
            {error}
          </Alert>
        )}
        <div className="sm:col-span-2">
          <Button type="submit">{t('เพิ่มแผน')}</Button>
        </div>
      </form>
      <p className="text-[12px] text-muted-foreground">
        {t('นับจากรายการซื้อในบัญชีและสกุลเดียวกับแผน รวมค่าธรรมเนียม ซื้อถึง 99% ของยอดถือว่าครบงวด')}
      </p>
    </Card>
  )
}

export function PlansPage() {
  const data = useAppData()
  if (!data) return <PageLoading />
  return (
    <>
      <PageHeader title={t('แผน')} />
      <GoalsCard data={data} />
      <div className="grid items-start gap-3.5 md:gap-6 xl:grid-cols-2">
        <TargetsCard data={data} />
        <PlansCard data={data} />
        <ChecklistCard data={data} />
      </div>
    </>
  )
}

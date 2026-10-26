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
import { MarketPill } from '../components/MarketPill'
import { PageHeader } from '../components/PageHeader'
import { ChecklistCard, WatchlistCard } from '../components/WatchCards'
import { fmtDate, fmtHeadline, fmtMonth, fmtPct, fmtPrice, fmtValue } from '../format'
import { useAppData, usePortfolio, type AppData } from '../hooks'
import { marketOf } from '../labels'

const FREQUENCY_LABELS: Record<PlanFrequency, string> = {
  weekly: 'ทุกสัปดาห์',
  monthly: 'ทุกเดือน',
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
      เป้า
      <Input
        aria-label={`เป้าหมายของ ${instrument.symbol} (%)`}
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
    !amount || amount.abs().lt(1) ? '—' : amount.gt(0) ? `ซื้อ ${fmtHeadline(amount, base)}` : `ขาย ${fmtHeadline(amount.abs(), base)}`

  return (
    <Card className="grid gap-3">
      <h2 className="text-lg font-semibold">สัดส่วนเป้าหมาย</h2>
      <Field
        id="rebalance-cash"
        label={`เงินที่จะเติมเข้าพอร์ต (${base})`}
        hint="ไม่บังคับ · ใส่แล้วแอปบอกว่าควรซื้ออะไรเท่าไหร่โดยไม่ต้องขาย"
        className="sm:max-w-xs"
      >
        <Input id="rebalance-cash" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
      </Field>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">ยังไม่มีสินทรัพย์ที่ถืออยู่</p>
      ) : (
        <ul aria-label="สัดส่วนแต่ละตัว">
          {rows.map((row) => {
            const instrument = byId.get(row.instrumentId)
            return (
              <li
                key={row.instrumentId}
                className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-t border-muted py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto_auto_minmax(120px,auto)]"
              >
                <AssetName id={row.instrumentId} instrument={instrument} />
                <span className="text-right text-[13px] text-muted-foreground tabular-nums sm:order-none">
                  ตอนนี้ {fmtPct(row.currentPct, 1)}
                </span>
                {instrument ? <TargetInput key={instrument.targetPct ?? ''} instrument={instrument} /> : <span />}
                <span className="text-right text-sm tabular-nums">
                  <span className={cn('block', row.diffBase?.gt(0) && 'text-gain', row.diffBase?.lt(0) && 'text-loss')}>
                    {action(row.diffBase)}
                  </span>
                  {newCash.gt(0) && row.buyOnlyBase && row.buyOnlyBase.gte(1) && (
                    <span className="block text-[12px] text-muted-foreground">ไม่ขาย: ซื้อ {fmtHeadline(row.buyOnlyBase, base)}</span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {plan.targetSum.gt(0) && !plan.targetSum.eq(100) && (
        <Alert>เป้าหมายรวมกันได้ {fmtPct(plan.targetSum, 1)} ส่วนที่เหลือเป็นของตัวที่ไม่ได้ตั้งเป้า</Alert>
      )}
      <p className="text-[12px] text-muted-foreground">
        ใส่ % ที่ต้องการในช่องของแต่ละตัว · มูลค่าคิดจากราคาล่าสุดที่บันทึกไว้ อัปเดตราคาก่อนเพื่อให้ตัวเลขตรง
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
  done: 'ครบ',
  partial: 'ยังไม่ครบ',
  missed: 'ไม่ได้ซื้อ',
  current: 'งวดนี้',
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
            {fmtPrice(plan.amount)} {plan.currency} {FREQUENCY_LABELS[plan.frequency]} · {account?.name ?? 'บัญชีที่ลบไปแล้ว'} · เริ่ม{' '}
            {fmtDate(plan.startDate)}
          </span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`ลบแผน ${instrument?.symbol ?? symbolOf(plan.instrumentId)}`}
          onClick={() => void deletePlan(db, plan.id)}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
      <ol aria-label="งวดล่าสุด" className="flex flex-wrap gap-1.5">
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
        ครบ {done} จาก {past} งวดที่ผ่านมา
        {current && ` · งวดนี้ซื้อแล้ว ${fmtValue(current.spent)} จาก ${fmtPrice(plan.amount)} ${plan.currency}`}
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
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    }
  }

  return (
    <Card className="grid gap-3">
      <h2 className="text-lg font-semibold">แผนทยอยซื้อ</h2>
      {plans && plans.length > 0 && (
        <ul aria-label="แผนที่มี">
          {plans.map((plan) => (
            <PlanRow key={plan.id} plan={plan} data={data} today={today} />
          ))}
        </ul>
      )}
      <form onSubmit={(e) => void add(e)} className="grid gap-3 border-t pt-4 sm:grid-cols-2">
        <Field id="plan-account" label="บัญชี">
          <NativeSelect id="plan-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="plan-asset" label="สินทรัพย์">
          <NativeSelect id="plan-asset" value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}>
            <option value="">เลือก</option>
            {instruments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.symbol} · {i.currency}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="plan-amount" label={`ซื้องวดละ${chosen ? ` (${chosen.currency})` : ''}`}>
          <Input id="plan-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field id="plan-start" label="เริ่ม">
          <Input id="plan-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <div className="grid content-start gap-1.5 sm:col-span-2">
          <span className="text-[13.5px] font-semibold text-ink-2">ความถี่</span>
          <Segmented
            label="ความถี่"
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
          <Button type="submit">เพิ่มแผน</Button>
        </div>
      </form>
      <p className="text-[12px] text-muted-foreground">
        แอปนับจากรายการซื้อที่บันทึกในบัญชีและสกุลเดียวกับแผน รวมค่าธรรมเนียม · ซื้อถึง 99% ของยอดนับว่าครบงวด
      </p>
    </Card>
  )
}

export function PlansPage() {
  const data = useAppData()
  if (!data) return <p className="text-muted-foreground">กำลังโหลด…</p>
  return (
    <>
      <PageHeader title="แผน" />
      <div className="grid items-start gap-3.5 md:gap-[22px] xl:grid-cols-2">
        <TargetsCard data={data} />
        <PlansCard data={data} />
        <WatchlistCard data={data} />
        <ChecklistCard data={data} />
      </div>
    </>
  )
}

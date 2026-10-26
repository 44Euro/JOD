import { useMemo, useState } from 'react'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { D, type Decimal } from '../../domain/decimal'
import { fifoByAccount } from '../../domain/lots'
import { averageR, closedTradeDrawdown, positionSize } from '../../domain/risk'
import type { Trade } from '../../domain/trades'
import type { Account, Instrument, Transaction } from '../../domain/types'
import { cn } from '../../lib/cn'
import { fmtDate, fmtNumber, fmtPrice, fmtRate, fmtRatio, fmtSigned, fmtValue, plClass } from '../format'
import { t } from '../../i18n'

export function RiskSummaryCard({ closed, transactions }: { closed: readonly Trade[]; transactions: ReadonlyMap<string, Transaction> }) {
  const r = averageR(closed, transactions)
  const drawdown = closedTradeDrawdown(closed)
  if (closed.length === 0) return null
  return (
    <Card className="grid gap-3">
      <h2 className="text-lg font-semibold">{t('ความเสี่ยง')}</h2>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-[12.5px] text-muted-foreground">{t('ได้เฉลี่ยกี่เท่าของความเสี่ยง (R)')}</dt>
          <dd className={cn('font-display text-xl font-semibold', plClass(r?.avg))}>{r ? `${fmtRatio(r.avg)}R` : '—'}</dd>
          <dd className="text-[12px] text-muted-foreground">
            {r ? t('จาก {0} เทรดที่ใส่ Stop loss ตอนซื้อ', r.count) : t('ใส่ Stop loss ตอนบันทึกซื้อ แอปจึงคิด R ให้ได้')}
          </dd>
        </div>
        <div>
          <dt className="text-[12.5px] text-muted-foreground">{t('ขาดทุนสะสมหนักสุด')}</dt>
          <dd className={cn('font-display text-xl font-semibold', plClass(drawdown))}>
            {drawdown.isZero() ? t('ไม่มี') : fmtSigned(drawdown, 0)}
          </dd>
          <dd className="text-[12px] text-muted-foreground">{t('ช่วงที่กำไรจากเทรดที่ปิดลดลงลึกที่สุด')}</dd>
        </div>
      </dl>
    </Card>
  )
}

export function PositionSizeCard({ base }: { base: string }) {
  const [account, setAccount] = useState('')
  const [riskPct, setRiskPct] = useState('1')
  const [entry, setEntry] = useState('')
  const [stop, setStop] = useState('')
  const [lot, setLot] = useState('1')
  const size = positionSize({
    account: account.replace(/,/g, ''),
    riskPct,
    entry,
    stop,
    lot,
  })
  const field = (id: string, label: string, value: string, set: (v: string) => void, hint?: string) => (
    <Field id={id} label={label} hint={hint}>
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} className="h-10 tabular-nums" />
    </Field>
  )
  return (
    <Card className="grid gap-3">
      <h2 className="text-lg font-semibold">{t('คำนวณขนาดไม้')}</h2>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {field('size-account', t('เงินในพอร์ต ({0})', base), account, setAccount)}
        {field('size-risk', t('ยอมเสียต่อไม้ (%)'), riskPct, setRiskPct)}
        {field('size-lot', t('ซื้อทีละ'), lot, setLot, t('หุ้นไทย 100 · หุ้นนอก 1'))}
        {field('size-entry', t('ราคาเข้า'), entry, setEntry)}
        {field('size-stop', 'Stop loss', stop, setStop)}
      </div>
      <p aria-live="polite" className="text-sm">
        {size ? (
          <>
            {t('ซื้อได้ ')}<b className="font-display text-lg">{fmtNumber(size.units, 8)}</b> {t(' หน่วย · มูลค่า ')}{fmtPrice(size.value)} {t(' · ถ้าโดน Stop เสีย ')}{fmtPrice(size.units.times(entry).minus(size.units.times(stop)))}
            <span className="block text-[12px] text-muted-foreground">
              {t('ยอมเสียได้ ')}{fmtPrice(size.riskAmount)} {t(' · ราคาเข้าและ Stop ใช้สกุลเดียวกับหุ้น ถ้าคนละสกุลกับพอร์ต แปลงเงินในพอร์ตก่อน')}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">{t('ใส่ตัวเลขให้ครบ Stop loss ต้องต่ำกว่าราคาเข้า')}</span>
        )}
      </p>
    </Card>
  )
}

export function LotsCard({
  transactions,
  instrument,
  accounts,
  averageRealized,
}: {
  transactions: readonly Transaction[]
  instrument: Instrument
  accounts: readonly Account[]
  averageRealized: Decimal | null
}) {
  const results = useMemo(() => fifoByAccount(transactions, instrument.id), [transactions, instrument.id])
  const lots = [...results.values()].flatMap((r) => r.lots).sort((a, b) => a.date.localeCompare(b.date))
  const fifoRealized = [...results.values()].reduce((s, r) => s.plus(r.realizedBase), D(0))
  const hasSales = [...results.values()].some((r) => r.sales.length > 0)
  const names = new Map(accounts.map((a) => [a.id, a.name]))
  const manyAccounts = new Set(lots.map((l) => l.accountId)).size > 1
  if (lots.length === 0 && !hasSales) return null
  return (
    <Card className="grid gap-3">
      <h2 className="text-lg font-semibold">{t('ต้นทุนแยกไม้')}</h2>
      {lots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('ขายหมดแล้ว')}</p>
      ) : (
        <ul className="text-sm">
          {lots.map((lot) => (
            <li
              key={`${lot.accountId}-${lot.txId}`}
              className="grid grid-cols-[1fr_auto] gap-x-3 border-t border-muted py-2.5 first:border-t-0"
            >
              <span>
                {fmtDate(lot.date)}
                {manyAccounts && <span className="text-muted-foreground"> · {names.get(lot.accountId)}</span>}
              </span>
              <span className="text-right tabular-nums">{fmtNumber(lot.quantity, 8)} {t(' หน่วย')}</span>
              <span className="text-[12.5px] text-muted-foreground tabular-nums">
                {t('ทุน ')}{fmtPrice(lot.costQuote.div(lot.quantity))} {instrument.currency}
                {!lot.costQuote.isZero() && t(' · เรท {0}', fmtRate(lot.costBase.div(lot.costQuote)))}
              </span>
              <span className="text-right text-[12.5px] tabular-nums">{fmtValue(lot.costBase)}</span>
            </li>
          ))}
        </ul>
      )}
      {hasSales && (
        <dl className="grid gap-1 border-t pt-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t('กำไรที่ขายแล้ว ถ้านับแบบ FIFO')}</dt>
            <dd className={plClass(fifoRealized)}>{fmtSigned(fifoRealized, 0)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t('แบบต้นทุนเฉลี่ย (ที่แอปใช้)')}</dt>
            <dd className={plClass(averageRealized)}>{fmtSigned(averageRealized, 0)}</dd>
          </div>
        </dl>
      )}
      <p className="text-[12px] text-muted-foreground">
        {t('แอปคิดกำไรด้วยต้นทุนเฉลี่ยเหมือนโบรกไทย ไม้แยกด้านบนนับแบบซื้อก่อนขายก่อน (FIFO) ไว้ดูเทียบ')}
      </p>
    </Card>
  )
}

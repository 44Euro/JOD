import { Alert } from '../../../components/ui/alert'
import { Card } from '../../../components/ui/card'
import { D, type Decimal } from '../../../domain/decimal'
import { cn } from '../../../lib/cn'
import type { AfterSavePreview } from '../../afterSave'
import { fmtMoney, fmtPrice } from '../../format'

export function TotalPanel({ total, currency, base, rate }: { total: Decimal; currency: string; base: string; rate: string | null }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-2xl bg-board px-[18px] py-4 text-white">
      <div>
        <p className="text-[12.5px] text-board-muted">รวม</p>
        <p className="font-display text-[28px] font-semibold leading-tight">{fmtMoney(total, currency)}</p>
      </div>
      {rate && (
        <p className="text-[12.5px] text-board-muted">
          ≈ {fmtMoney(total.times(D(rate)), base)} ที่เรท {fmtPrice(rate)}
        </p>
      )}
    </div>
  )
}

export function AfterSavePanel({ preview }: { preview: AfterSavePreview }) {
  return (
    <Card className="grid gap-2.5">
      <h2 className="text-base font-semibold">หลังบันทึก</h2>
      <dl className="grid text-sm">
        {preview.rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-3 border-t border-muted py-2.5 first:border-t-0">
            <dt className="min-w-0 text-muted-foreground">{row.label}</dt>
            <dd className={cn('shrink-0 whitespace-nowrap text-right', row.fx && 'text-fx')}>
              {row.before} → <b className="font-semibold">{row.after}</b>
            </dd>
          </div>
        ))}
      </dl>
      {preview.warning && <Alert role="note">{preview.warning}</Alert>}
    </Card>
  )
}

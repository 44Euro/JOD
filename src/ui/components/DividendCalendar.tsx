import { useId } from 'react'
import { Card } from '../../components/ui/card'
import { sumBy } from '../../domain/decimal'
import type { DividendMonth } from '../../domain/dividendCalendar'
import { cn } from '../../lib/cn'
import { fmtHeadline, fmtMoney, fmtMonth } from '../format'
import { t } from '../../i18n'

// Twelve months ahead on paper: a dividend already in is a filled chip, one expected from last year an outlined one.
export function DividendCalendar({ months, symbols, base }: { months: readonly DividendMonth[]; symbols: ReadonlyMap<string, string>; base: string }) {
  const id = useId()
  if (months.every((m) => m.items.length === 0)) return null
  return (
    <Card role="region" aria-labelledby={id} className="grid gap-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={id} className="text-lg font-semibold">
          {t('ปันผล 12 เดือนข้างหน้า')}
        </h2>
        <p className="text-[13px] text-ink-2">{t('รวม 12 เดือน ≈ {0}', fmtHeadline(sumBy(months, (m) => m.totalBase), base))}</p>
      </div>
      <ol className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
        {months.map((m) => {
          const label = fmtMonth(m.month, true)
          const estimated = m.items.some((i) => !i.received)
          return (
            <li key={m.month} aria-label={label} className="grid content-start gap-1.5 rounded-xl border p-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-semibold">{label}</span>
                {m.items.length > 0 && <span className="font-display text-[13px] font-semibold">{`${estimated ? '≈ ' : ''}${fmtHeadline(m.totalBase, base)}`}</span>}
              </div>
              {m.items.length === 0 ? (
                <p className="text-muted-foreground">—</p>
              ) : (
                <ul className="grid gap-1">
                  {m.items.map((item) => (
                    <li
                      key={`${item.instrumentId}:${item.received}`}
                      className={cn('grid gap-0.5 rounded-lg px-2 py-1.5 text-[13px]', item.received ? 'bg-primary-soft' : 'border border-dashed border-input')}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-display font-semibold">{symbols.get(item.instrumentId) ?? item.instrumentId.split(':')[1]}</span>
                        <span className="text-[12px] text-muted-foreground">{item.received ? t('ได้รับแล้ว') : t('คาดการณ์')}</span>
                      </span>
                      <span className="text-ink-2">
                        {item.currency === base
                          ? `${item.received ? '' : '≈ '}${fmtHeadline(item.amountBase, base)}`
                          : `${fmtMoney(item.amountQuote, item.currency)} ≈ ${fmtHeadline(item.amountBase, base)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
      <p className="text-[13px] text-muted-foreground">{t('คาดจากปันผลที่ได้รับใน 12 เดือนที่ผ่านมา × จำนวนหุ้นที่ถืออยู่ · หลังหักภาษี · ยอดเงินบาทใช้เรทตอนได้รับครั้งก่อน')}</p>
    </Card>
  )
}

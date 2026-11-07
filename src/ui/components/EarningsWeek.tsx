import type { EarningsEvent } from '../../market/client'
import { cn } from '../../lib/cn'
import { fmtDay } from '../format'
import type { MarketState } from '../useMarket'
import { MarketCard } from './MarketCard'
import { MarketNote } from './NewsList'
import { t } from '../../i18n'

const SHORT_DAYS = [t('จ.'), t('อ.'), t('พ.'), t('พฤ.'), t('ศ.')]
export const EARNINGS_TIMES: Record<NonNullable<EarningsEvent['time']>, string> = { before: t('ก่อนเปิด'), after: t('หลังปิด'), during: t('ระหว่างวัน') }
export const EARNINGS_SOURCE = t('เวลาตลาดสหรัฐ · ที่มา Finnhub')

export function EarningsSymbol({ symbol, held }: { symbol: string; held: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      {held && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />}
      <span className={cn('font-display text-[14px] font-semibold', held ? 'text-primary' : 'text-foreground')}>{symbol}</span>
      {held && <span className="sr-only">{t('ถืออยู่')}</span>}
    </span>
  )
}

// The week's reports of what the person holds or watches, one column per US trading day; the rest of the market is
// one tap away on the full list.
export function EarningsWeek({
  state,
  week,
  held,
  watched,
  today,
}: {
  state: MarketState<readonly EarningsEvent[]>
  week: readonly string[]
  held: readonly string[]
  watched: readonly string[]
  today: string
}) {
  const heldSet = new Set(held)
  const mine = new Set([...held, ...watched])
  return (
    <MarketCard title={t('ประกาศงบสัปดาห์นี้')} more="/market/earnings" source={EARNINGS_SOURCE}>
      {state.status !== 'ready' ? (
        <MarketNote state={state} />
      ) : (
        <>
          <ol className="grid grid-cols-5 gap-1.5 md:gap-3">
            {week.map((day, i) => {
              const reports = state.data.filter((e) => e.date === day && mine.has(e.symbol))
              return (
                <li
                  key={day}
                  aria-label={fmtDay(day)}
                  aria-current={day === today ? 'date' : undefined}
                  className={cn('min-w-0 rounded-xl px-1.5 py-2 md:px-2.5', day === today && 'bg-primary-soft')}
                >
                  <p className={cn('mb-1.5 text-[13px]', day === today ? 'font-semibold text-primary-ink' : 'text-muted-foreground')}>
                    {`${SHORT_DAYS[i]} ${Number(day.slice(8))}`}
                  </p>
                  {reports.length > 0 ? (
                    <ul className="grid gap-1.5">
                      {reports.map((e) => (
                        <li key={e.symbol} className="min-w-0">
                          <EarningsSymbol symbol={e.symbol} held={heldSet.has(e.symbol)} />
                          {e.time && <span className="block text-[12px] text-muted-foreground">{EARNINGS_TIMES[e.time]}</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">—</p>
                  )}
                </li>
              )
            })}
          </ol>
          <p className="mt-2 text-[13px] text-ink-2">{t('ทั้งตลาดสัปดาห์นี้ {0} บริษัท', new Set(state.data.map((e) => e.symbol)).size)}</p>
        </>
      )}
    </MarketCard>
  )
}

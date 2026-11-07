import { useState } from 'react'
import { Card } from '../../components/ui/card'
import { Chip } from '../../components/ui/chip'
import { todayLocal, tradingWeek } from '../../domain/dates'
import { marketClient } from '../../market/client'
import { EARNINGS_SOURCE, EARNINGS_TIMES, EarningsSymbol } from '../components/EarningsWeek'
import { MarketNote } from '../components/NewsList'
import { PageHeader } from '../components/PageHeader'
import { fmtDate, fmtDay } from '../format'
import { useAppData } from '../hooks'
import { useMarket, useMySymbols } from '../useMarket'
import { t } from '../../i18n'

export function EarningsPage() {
  const data = useAppData()
  const { held, watched } = useMySymbols(data)
  const [all, setAll] = useState(false)
  const week = tradingWeek(todayLocal())
  const state = useMarket(`earnings:${week[0]}`, () => marketClient.earnings(week[0], week[4]))
  const heldSet = new Set(held)
  const mine = new Set([...held, ...watched])
  const shown = state.status === 'ready' ? state.data.filter((e) => all || mine.has(e.symbol)) : []
  return (
    <>
      <PageHeader title={t('ประกาศงบสัปดาห์นี้')} note={`${fmtDate(week[0])} – ${fmtDate(week[4])}`} />
      <div role="group" aria-label={t('เลือกบริษัท')} className="flex flex-wrap gap-2">
        <Chip active={!all} onClick={() => setAll(false)}>
          {t('ของฉัน')}
        </Chip>
        <Chip active={all} onClick={() => setAll(true)}>
          {t('ทั้งหมด')}
        </Chip>
      </div>
      <Card className="grid gap-4">
        {state.status !== 'ready' ? (
          <MarketNote state={state} />
        ) : shown.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{all ? t('สัปดาห์นี้ไม่มีบริษัทประกาศงบ') : t('ไม่มีหุ้นที่ถือหรือจับตาประกาศงบสัปดาห์นี้')}</p>
        ) : (
          week.map((day) => {
            const reports = shown.filter((e) => e.date === day)
            if (reports.length === 0) return null
            return (
              <section key={day} aria-label={fmtDay(day)}>
                <h2 className="mb-1 text-[15px] font-semibold">{fmtDay(day)}</h2>
                <ul>
                  {reports.map((e) => (
                    <li key={e.symbol} className="flex min-h-11 items-center justify-between gap-3 border-t py-2 first:border-t-0">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <EarningsSymbol symbol={e.symbol} held={heldSet.has(e.symbol)} />
                        {e.time && <span className="text-[13px] text-muted-foreground">{EARNINGS_TIMES[e.time]}</span>}
                      </span>
                      <span className="text-right text-[13px] text-ink-2">
                        {[e.epsEstimate && t('EPS คาด {0}', e.epsEstimate), e.epsActual && t('จริง {0}', e.epsActual)].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })
        )}
        <p className="text-[12px] text-muted-foreground">{EARNINGS_SOURCE}</p>
      </Card>
    </>
  )
}

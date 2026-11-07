import { useId } from 'react'
import { todayLocal } from '../../domain/dates'
import { D } from '../../domain/decimal'
import type { AssetType, Instrument, Market } from '../../domain/types'
import type { MarketQuote } from '../../market/client'
import { cn } from '../../lib/cn'
import { fmtDate, fmtPrice, fmtSigned, fmtSignedPct, fmtWhen } from '../format'
import { MarketPill } from './MarketPill'
import { t } from '../../i18n'

const dayOf = (iso: string) => todayLocal(new Date(iso))
const sourceName = (source: string) => (source === 'Yahoo' ? t('Yahoo ช้าราว 15 นาที') : source)

function Sparkline({ points }: { points: readonly { date: string; close: string }[] }) {
  const closes = points.map((p) => Number(p.close))
  const low = Math.min(...closes)
  const span = Math.max(...closes) - low || 1
  const line = closes.map((c, i) => `${((i / (closes.length - 1)) * 160).toFixed(1)},${(38 - ((c - low) / span) * 36).toFixed(1)}`).join(' ')
  return (
    <svg
      role="img"
      aria-label={t('ราคาปิด 6 เดือน {0} – {1}', fmtDate(points[0].date), fmtDate(points[points.length - 1].date))}
      viewBox="0 0 160 40"
      preserveAspectRatio="none"
      className="h-12 w-full md:h-16"
    >
      <polyline points={line} fill="none" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="stroke-board-mine" />
    </svg>
  )
}

// The asset page's board: the price as it is now, against the close before it, with where both came from. A live quote
// from the JOD server wins; otherwise the price the app has stored, with its date.
export function StockHeader({
  market,
  assetType,
  symbol,
  name,
  exchange,
  previousSymbols,
  live,
  instrument,
  points,
  today,
}: {
  market: Market
  assetType?: AssetType
  symbol: string
  name?: string
  exchange?: string
  previousSymbols?: readonly string[]
  live: MarketQuote | null
  instrument?: Instrument
  points: readonly { date: string; close: string }[]
  today: string
}) {
  const id = useId()
  const stored = instrument?.lastPrice ? instrument : undefined
  const price = live ? D(live.price) : stored ? D(stored.lastPrice!) : null
  const previousText = live ? live.previousClose : stored?.previousPrice
  const previous = previousText ? D(previousText) : null
  const change = price && previous && !previous.isZero() ? price.minus(previous) : null
  const comparedAt = live ? live.previousCloseAt : stored?.previousPriceAt
  const source = live
    ? [sourceName(live.source), fmtWhen(live.at, today), comparedAt && t('เทียบราคาปิด {0}', fmtDate(dayOf(comparedAt)))]
    : stored
      ? [
          stored.priceSource && sourceName(stored.priceSource),
          stored.lastPriceAt && t('ราคา {0}', fmtDate(dayOf(stored.lastPriceAt))),
          comparedAt && t('เทียบราคาก่อนหน้า {0}', fmtDate(dayOf(comparedAt))),
        ]
      : []
  const about = [name && name !== symbol ? name : '', exchange].filter(Boolean).join(' · ')
  return (
    <section aria-labelledby={id} className="grid gap-4 rounded-[18px] bg-board p-4 text-[#e8eef8] md:grid-cols-[minmax(0,1fr)_240px] md:items-end md:rounded-[20px] md:px-6 md:py-6">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-nowrap items-center gap-3">
          <MarketPill market={market} assetType={assetType} />
          <h1 id={id} className="shrink-0 text-[26px] font-semibold leading-tight text-white md:text-[34px]">
            {symbol}
          </h1>
        </div>
        {about && <p className="mt-0.5 truncate text-[13px] text-board-muted">{about}</p>}
        {previousSymbols && previousSymbols.length > 0 && <p className="text-[13px] text-board-muted">{t('เดิม: ')}{previousSymbols.join(', ')}</p>}
        {price ? (
          <>
            <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-display text-[34px] font-semibold leading-none text-white md:text-[44px]">{fmtPrice(price)}</span>
              <span className="text-[13px] text-board-muted">{live?.currency ?? instrument?.currency}</span>
              {change && previous && (
                <span className={cn('font-display text-[17px] font-semibold', change.lessThan(0) ? 'text-board-loss' : 'text-board-gain')}>
                  {`${fmtSigned(change, 2)} (${fmtSignedPct(change.div(previous).times(100), 2)})`}
                </span>
              )}
            </p>
            <p className="mt-1.5 text-[13px] text-board-muted">{source.filter(Boolean).join(' · ')}</p>
          </>
        ) : (
          <p className="mt-4 text-[15px] text-board-muted">{t('ยังไม่มีราคา')}</p>
        )}
      </div>
      {points.length >= 2 && (
        <div>
          <Sparkline points={points} />
          <p className="mt-1 text-right text-[12px] text-board-muted">{t('6 เดือน')}</p>
        </div>
      )}
    </section>
  )
}

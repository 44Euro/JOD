import type { ReactNode } from 'react'
import { CURRENCY_NAMES } from '../../domain/currencies'
import { cn } from '../../lib/cn'
import { currencyMark, fmtNumber, fmtRate, fmtSigned, fmtSignedPct } from '../format'
import type { RateBoardRow } from '../rateBoard'

// Both layouts switch from stacked rows to columns on the board's own width (container query), which a tablet beside the
// sidebar, or the left column of the two-column overview, does not always have. The five columns need about 680px of it and
// the six about 800px. Tailwind only sees whole class names, so each layout spells out its own.
// Stacked, a row is two lines as in the mock: the currency and the gap, then the rates and the effect. The two lines are
// wrappers that become `contents` in the columns, so their children are the grid cells there. The effect wraps below the
// rate pair when the two do not fit side by side, and the pair itself never splits. The held amount sits before the gap
// once the board is 320px wide, which a phone in portrait does not give.
// A rate below one has up to six decimals and is set a size smaller, so it stays inside its column in both layouts.
const LAYOUTS = {
  compact: {
    row: 'flex-col @min-[680px]:grid @min-[680px]:grid-cols-[150px_1fr_1fr_100px_170px] @min-[680px]:items-center @min-[680px]:gap-2',
    head: '@min-[680px]:grid @min-[680px]:grid-cols-[150px_1fr_1fr_100px_170px]',
    line: '@min-[680px]:contents',
    rates: '@min-[680px]:contents',
    size: 'text-[22px] @min-[680px]:text-[34px]',
    smallSize: 'text-base @min-[680px]:text-2xl',
    arrow: '@min-[680px]:hidden',
    note: '@max-[680px]:hidden',
    diff: '@min-[680px]:order-1 @min-[680px]:text-left',
    effect: '@min-[680px]:order-2 @min-[680px]:ml-0 @min-[680px]:text-left @min-[680px]:text-xl',
  },
  full: {
    row: 'flex-col @min-[800px]:grid @min-[800px]:grid-cols-[176px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_100px_132px] @min-[800px]:items-center @min-[800px]:gap-2',
    head: '@min-[800px]:grid @min-[800px]:grid-cols-[176px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_100px_132px]',
    line: '@min-[800px]:contents',
    held: 'hidden @min-[320px]:block',
    rates: '@min-[800px]:contents',
    size: 'text-[22px] @min-[800px]:text-[34px]',
    smallSize: 'text-base @min-[800px]:text-2xl',
    arrow: '@min-[800px]:hidden',
    note: '@max-[800px]:hidden',
    diff: '@min-[800px]:order-1 @min-[800px]:text-left',
    effect: '@min-[800px]:order-2 @min-[800px]:ml-0 @min-[800px]:text-left @min-[800px]:text-xl',
  },
}

interface RateBoardProps {
  rows: readonly RateBoardRow[]
  base: string
  // The currency page adds what is held.
  full?: boolean
  caption?: ReactNode
}

export function RateBoard({ rows, base, full = false, caption = 'เรทเฉลี่ยที่แลกมา เทียบเรทวันนี้' }: RateBoardProps) {
  const layout = LAYOUTS[full ? 'full' : 'compact']
  const mark = currencyMark(base)
  return (
    <section
      aria-labelledby="rate-board-title"
      className="@container rounded-[18px] bg-board p-4 text-[#e8eef8] md:rounded-[20px] md:px-[26px] md:py-[22px]"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id="rate-board-title" className="text-lg font-semibold text-white">
          กระดานเรทของคุณ
        </h2>
        <p className="text-[12.5px] text-board-muted">{caption}</p>
      </div>
      {rows.length > 0 && (
        <>
          <div aria-hidden className={cn('hidden gap-2 pt-1.5 pb-2 text-xs text-board-muted', layout.head)}>
            <span>สกุลที่ถือ</span>
            {full && <span>ถืออยู่</span>}
            <span>เรทเฉลี่ยของคุณ</span>
            <span>เรทวันนี้</span>
            <span>ส่วนต่าง</span>
            <span>ผลต่อพอร์ต</span>
          </div>
          <ul>
            {rows.map((row) => {
              const name = CURRENCY_NAMES[row.currency]
              const small = row.mine.lessThan(1) || row.today?.lessThan(1) === true
              return (
                <li key={row.currency} className={cn('flex gap-y-1 border-t border-board-line py-3', layout.row)}>
                  <div className={cn('flex items-center gap-x-2.5', layout.line)}>
                    <span className="flex min-w-0 flex-1 items-center gap-2.5">
                      <span className="shrink-0 rounded-md bg-board-line px-2 py-0.5 font-display text-xs font-semibold text-[#dce6f7]">
                        {row.currency}
                      </span>
                      {name && (
                        <span className="min-w-0 truncate text-sm font-semibold" title={name}>
                          {name}
                        </span>
                      )}
                    </span>
                    {full && (
                      <span className={cn('min-w-0 text-base', LAYOUTS.full.held)}>
                        {`${fmtNumber(row.heldQuote, 0)} ${row.currency}`}
                      </span>
                    )}
                    <span
                      className={cn(
                        'shrink-0 text-right font-display text-xl font-semibold',
                        layout.diff,
                        row.diffPct?.lessThan(0) ? 'text-board-loss' : 'text-board-gain',
                      )}
                    >
                      {row.diffPct ? fmtSignedPct(row.diffPct, 2) : '—'}
                    </span>
                  </div>
                  <div className={cn('flex flex-wrap items-baseline gap-x-2.5 gap-y-1', layout.line)}>
                    <span
                      className={cn(
                        'flex items-baseline gap-x-1.5 whitespace-nowrap font-display font-semibold',
                        small ? layout.smallSize : layout.size,
                        'leading-[1.1]',
                        layout.rates,
                      )}
                    >
                      <span className="text-board-mine">{fmtRate(row.mine)}</span>
                      <span aria-hidden className={cn('text-base text-board-muted', layout.arrow)}>
                        →
                      </span>
                      <span>
                        {row.today ? fmtRate(row.today) : '—'}
                        {row.todayNote && (
                          <small className={cn('block whitespace-normal font-sans text-[11px] font-normal text-board-muted', layout.note)}>
                            {row.todayNote}
                          </small>
                        )}
                      </span>
                    </span>
                    <span className={cn('ml-auto min-w-0 text-right font-display text-base font-semibold text-board-fx', layout.effect)}>
                      {row.effectBase ? `${fmtSigned(row.effectBase, 0)} ${mark}` : '—'}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}

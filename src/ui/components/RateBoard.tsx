import { cn } from '../../lib/cn'
import { fmtNumber, fmtSigned } from '../format'
import type { RateBoardRow } from '../rateBoard'

const COLUMNS = 'md:grid-cols-[120px_1fr_1fr_110px_170px]'

export function RateBoard({ rows, base }: { rows: readonly RateBoardRow[]; base: string }) {
  return (
    <section
      aria-labelledby="rate-board-title"
      className="rounded-[18px] bg-board p-4 text-[#e8eef8] md:rounded-[20px] md:px-[26px] md:py-[22px]"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id="rate-board-title" className="text-lg font-semibold text-white">
          กระดานเรทของคุณ
        </h2>
        <p className="text-[12.5px] text-board-muted">เรทเฉลี่ยที่แลกมา เทียบเรทวันนี้</p>
      </div>
      <div aria-hidden className={cn('hidden gap-2 pt-1.5 pb-2 text-xs text-board-muted md:grid', COLUMNS)}>
        <span>สกุลที่ถือ</span>
        <span>เรทเฉลี่ยของคุณ</span>
        <span>เรทวันนี้</span>
        <span>ส่วนต่าง</span>
        <span>ผลต่อพอร์ต</span>
      </div>
      <ul>
        {rows.map((row) => (
          <li
            key={row.currency}
            className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 border-t border-board-line py-3 md:gap-2', COLUMNS)}
          >
            <span className="justify-self-start rounded-md bg-board-line px-2 py-0.5 font-display text-xs font-semibold text-[#dce6f7]">
              {row.currency}
            </span>
            <span className="order-2 flex items-baseline gap-1.5 font-display text-[22px] font-semibold leading-tight md:order-none md:contents md:text-[34px]">
              <span className="text-board-mine">{fmtNumber(row.mine, 4)}</span>
              <span aria-hidden className="text-base text-board-muted md:hidden">
                →
              </span>
              <span>
                {row.today ? fmtNumber(row.today, 4) : '—'}
                {row.todayNote && (
                  <small className="block font-sans text-[11px] font-normal text-board-muted max-md:hidden">{row.todayNote}</small>
                )}
              </span>
            </span>
            <span
              className={cn(
                'order-1 text-right font-display text-xl font-semibold md:order-none md:text-left',
                row.diffPct?.lessThan(0) ? 'text-board-loss' : 'text-board-gain',
              )}
            >
              {row.diffPct ? `${fmtSigned(row.diffPct)}%` : '—'}
            </span>
            <span className="order-3 text-right font-display text-xl font-semibold text-board-fx md:order-none md:text-left">
              {row.effectBase ? `${fmtSigned(row.effectBase)} ${base}` : '—'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

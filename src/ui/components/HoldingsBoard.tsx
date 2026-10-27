import { Link } from 'react-router'
import { cn } from '../../lib/cn'
import { fmtDate, fmtNumber, fmtPrice, fmtSignedPct } from '../format'
import type { HoldingsBoardRow } from '../holdingsBoard'
import { UNIT_LABELS } from '../labels'
import { assetPath } from '../nav'
import { MarketPill } from './MarketPill'
import { t } from '../../i18n'

// The morning look at what is held: one row per asset, its price and how far it moved since the price before it.
export function HoldingsBoard({ rows, today }: { rows: readonly HoldingsBoardRow[]; today: string }) {
  const compared = rows.find((row) => row.comparedWithDay)?.comparedWithDay
  return (
    <section aria-labelledby="holdings-board-title" className="rounded-[18px] bg-board p-4 text-[#e8eef8] md:rounded-[20px] md:px-[26px] md:py-[22px]">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="holdings-board-title" className="text-lg font-semibold text-white">
          {t('ราคาที่ถืออยู่')}
        </h2>
        <p className="text-[12.5px] text-board-muted">
          {compared ? t('เทียบราคาก่อนหน้า {0}', fmtDate(compared)) : t('เทียบราคาก่อนหน้า')}
        </p>
      </div>
      <ul>
        {rows.map((row) => (
          <li key={row.instrumentId} className="border-t border-board-line first:border-t-0">
            <Link
              to={assetPath(row.instrumentId)}
              className="-mx-2 grid min-h-14 grid-cols-[minmax(0,1fr)_auto_5.5rem] items-center gap-x-3 rounded-xl px-2 py-2.5 hover:bg-board-line/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-board-mine/50"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate font-display text-[15px] font-semibold text-white">{row.symbol}</span>
                  <MarketPill market={row.market} />
                </span>
                <span className="block text-xs text-board-muted">{`${fmtNumber(row.quantity, 8)} ${UNIT_LABELS[row.unit]}`}</span>
              </span>
              <span className="text-right">
                <span className="block font-display text-[17px] font-semibold text-white">{fmtPrice(row.price)}</span>
                {row.priceDay && row.priceDay !== today && (
                  <span className="block text-[11px] text-board-muted">{t('ราคา {0}', fmtDate(row.priceDay))}</span>
                )}
              </span>
              <span
                className={cn(
                  'text-right font-display text-[15px] font-semibold',
                  row.changePct === null ? 'text-board-muted' : row.changePct.lessThan(0) ? 'text-board-loss' : 'text-board-gain',
                )}
              >
                {row.changePct === null ? '—' : fmtSignedPct(row.changePct, 2)}
                {row.comparedWithDay && row.comparedWithDay !== compared && (
                  <span className="block font-sans text-[11px] font-normal text-board-muted">{fmtDate(row.comparedWithDay)}</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

import { todayLocal } from '../../domain/dates'
import type { NewsItem } from '../../market/client'
import { fmtDate } from '../format'
import type { MarketState } from '../useMarket'
import { MarketPill } from './MarketPill'
import { t } from '../../i18n'

const MAX_SYMBOLS = 3

// Today's news only needs the time; older news carries its date too, all in the device's own time zone.
function when(iso: string, today: string): string {
  const at = new Date(iso)
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  const day = todayLocal(at)
  return day === today ? time : `${fmtDate(day)} ${time}`
}

// Headlines link out to the source; JOD keeps no article text.
export function NewsList({ items, today }: { items: readonly NewsItem[]; today: string }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.url} className="border-t py-3 first:border-t-0 first:pt-0 last:pb-0">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            lang="en"
            className="text-[15px] font-semibold leading-snug text-foreground hover:underline hover:underline-offset-[3px] focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
          >
            {item.headline}
          </a>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-muted-foreground">
            <span>{`${item.source} · ${when(item.publishedAt, today)}`}</span>
            {item.symbols.slice(0, MAX_SYMBOLS).map((symbol) => (
              <span key={symbol} className="inline-flex items-center gap-1 font-display font-semibold text-ink-2">
                <MarketPill market="US" />
                {symbol}
              </span>
            ))}
          </div>
        </li>
      ))}
    </ul>
  )
}

export function MarketNote({ state }: { state: MarketState<unknown> }) {
  const text =
    state.status === 'off'
      ? t('ข่าวและปฏิทินงบยังไม่เปิด: เซิร์ฟเวอร์ยังไม่มี key ของ Finnhub')
      : state.status === 'failed'
        ? t('ดึงข้อมูลตลาดไม่ได้ตอนนี้ ลองใหม่ภายหลัง')
        : t('กำลังดึงข้อมูลตลาด…')
  return <p className="text-[13.5px] text-muted-foreground">{text}</p>
}

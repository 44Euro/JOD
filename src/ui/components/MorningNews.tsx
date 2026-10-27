import { useId } from 'react'
import { Link } from 'react-router'
import { Card } from '../../components/ui/card'
import { marketClient } from '../../market/client'
import { useMarket } from '../useMarket'
import { MarketNote, NewsList } from './NewsList'
import { t } from '../../i18n'

const HELD_MAX = 10
const SHOWN = 5

// News about what is held when there is any, otherwise the day's general market news.
export function MorningNews({ held, today }: { held: readonly string[]; today: string }) {
  const id = useId()
  const asked = held.slice(0, HELD_MAX)
  const state = useMarket(`morning:${asked.join(',')}`, async () => {
    const mine = asked.length > 0 ? await marketClient.news(asked).catch(() => []) : []
    return mine.length > 0 ? { mine: true, items: mine } : { mine: false, items: await marketClient.news([]) }
  })
  const mine = state.status === 'ready' && state.data.mine
  return (
    <Card role="region" aria-labelledby={id}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={id} className="text-lg font-semibold">
          {mine ? t('ข่าวหุ้นที่ถือ') : t('ข่าวต่างประเทศ')}
        </h2>
        <Link to="/market/news" className="text-[13.5px] font-semibold text-primary underline-offset-[3px] hover:underline">
          {t('ดูทั้งหมด')}
        </Link>
      </div>
      {state.status === 'ready' ? (
        state.data.items.length > 0 ? (
          <NewsList items={state.data.items.slice(0, SHOWN)} today={today} />
        ) : (
          <p className="text-[13.5px] text-muted-foreground">{t('ยังไม่มีข่าวตอนนี้')}</p>
        )
      ) : (
        <MarketNote state={state} />
      )}
      <p className="mt-3 text-[12px] text-muted-foreground">{t('ที่มา Finnhub · เปิดอ่านที่เว็บต้นทาง')}</p>
    </Card>
  )
}

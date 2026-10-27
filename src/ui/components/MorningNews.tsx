import { marketClient } from '../../market/client'
import { useMarket } from '../useMarket'
import { MarketCard } from './MarketCard'
import { NEWS_SOURCE, NewsBody } from './NewsList'
import { t } from '../../i18n'

const HELD_MAX = 10
const SHOWN = 5

// News about what is held when there is any, otherwise the day's general market news.
export function MorningNews({ held, today }: { held: readonly string[]; today: string }) {
  const asked = held.slice(0, HELD_MAX)
  const state = useMarket(`morning:${asked.join(',')}`, async () => {
    const mine = asked.length > 0 ? await marketClient.news(asked).catch(() => []) : []
    return mine.length > 0 ? { mine: true, items: mine } : { mine: false, items: await marketClient.news([]) }
  })
  const news = state.status === 'ready' ? ({ status: 'ready', data: state.data.items } as const) : state
  return (
    <MarketCard title={state.status === 'ready' && state.data.mine ? t('ข่าวหุ้นที่ถือ') : t('ข่าวต่างประเทศ')} more="/market/news" source={NEWS_SOURCE}>
      <NewsBody state={news} today={today} limit={SHOWN} />
    </MarketCard>
  )
}

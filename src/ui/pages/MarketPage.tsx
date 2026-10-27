import { Search } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { todayLocal, tradingWeek } from '../../domain/dates'
import { marketClient } from '../../market/client'
import { EarningsWeek } from '../components/EarningsWeek'
import { MarketCard } from '../components/MarketCard'
import { NEWS_SOURCE, NewsBody } from '../components/NewsList'
import { SearchSheet } from '../components/SearchSheet'
import { WatchlistCard } from '../components/WatchCards'
import { fmtDate } from '../format'
import { useAppData } from '../hooks'
import { foundPath } from '../nav'
import { useMarket, useMySymbols } from '../useMarket'
import { t } from '../../i18n'

export function MarketPage() {
  const data = useAppData()
  const navigate = useNavigate()
  const [searching, setSearching] = useState(false)
  const instruments = data?.instruments ?? []
  const { held, watched } = useMySymbols(data)
  const today = todayLocal()
  const week = tradingWeek(today)
  const earnings = useMarket(`earnings:${week[0]}`, () => marketClient.earnings(week[0], week[4]))
  const news = useMarket('news:', () => marketClient.news([]))
  return (
    <>
      <header className="rounded-[18px] bg-board px-4 py-5 md:rounded-[20px] md:px-[26px] md:py-[22px]">
        <h1 className="text-[26px] font-semibold leading-tight text-white md:text-[34px]">{t('ตลาด')}</h1>
        <p className="mt-1 text-[13px] text-board-muted">{fmtDate(today)}</p>
        <button
          type="button"
          onClick={() => setSearching(true)}
          className="mt-4 flex h-[46px] w-full items-center gap-2.5 rounded-xl border border-board-line px-3.5 text-left text-base text-board-muted hover:bg-board-line/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-board-mine/50 md:max-w-[440px]"
        >
          <Search className="size-5 shrink-0" aria-hidden />
          <span className="flex-1">{t('ค้นหาหุ้นหรือคริปโต')}</span>
          <kbd className="hidden rounded-md border border-board-line px-1.5 font-sans text-[12px] md:inline" aria-hidden>
            ⌘K
          </kbd>
        </button>
      </header>
      <SearchSheet open={searching} onClose={() => setSearching(false)} onPick={(found) => navigate(foundPath(found, instruments))} instruments={instruments} />
      {data ? (
        <div className="grid items-start gap-3.5 md:gap-[22px] xl:grid-cols-2">
          <div className="min-w-0 xl:col-span-2">
            <EarningsWeek state={earnings} week={week} held={held} watched={watched} today={today} />
          </div>
          <MarketCard title={t('ข่าวต่างประเทศ')} more="/market/news" source={NEWS_SOURCE}>
            <NewsBody state={news} today={today} limit={5} />
          </MarketCard>
          <WatchlistCard data={data} />
        </div>
      ) : (
        <p className="text-muted-foreground">{t('กำลังโหลด…')}</p>
      )}
    </>
  )
}

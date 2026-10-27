import { todayLocal } from '../../domain/dates'
import { WatchlistCard } from '../components/WatchCards'
import { fmtDate } from '../format'
import { useAppData } from '../hooks'
import { t } from '../../i18n'

export function MarketPage() {
  const data = useAppData()
  return (
    <>
      <header className="rounded-[18px] bg-board px-4 py-5 md:rounded-[20px] md:px-[26px] md:py-[22px]">
        <h1 className="text-[26px] font-semibold leading-tight text-white md:text-[34px]">{t('ตลาด')}</h1>
        <p className="mt-1 text-[13px] text-board-muted">{fmtDate(todayLocal())}</p>
      </header>
      {data ? (
        <div className="grid items-start gap-3.5 md:gap-[22px] xl:grid-cols-2">
          <WatchlistCard data={data} />
        </div>
      ) : (
        <p className="text-muted-foreground">{t('กำลังโหลด…')}</p>
      )}
    </>
  )
}

import { useState } from 'react'
import { Card } from '../../components/ui/card'
import { Chip } from '../../components/ui/chip'
import { marketClient } from '../../market/client'
import { CongressTrades, FundRow } from '../components/BigMoney'
import { MarketCard } from '../components/MarketCard'
import { MarketNote } from '../components/NewsList'
import { PageHeader } from '../components/PageHeader'
import { fmtDate } from '../format'
import { useMarket } from '../useMarket'
import { t } from '../../i18n'

export function BigMoneyPage() {
  const [view, setView] = useState<'funds' | 'house'>('funds')
  const state = useMarket('bigmoney', () => marketClient.bigMoney())
  const funds = state.status === 'ready' ? state.data.funds : null
  return (
    <>
      <PageHeader title={t('เงินใหญ่ขยับ')} />
      <div role="group" aria-label={t('เลือกแหล่ง')} className="flex flex-wrap gap-2">
        <Chip active={view === 'funds'} onClick={() => setView('funds')}>
          {t('กองทุน')}
        </Chip>
        <Chip active={view === 'house'} onClick={() => setView('house')}>
          {t('สภาผู้แทนฯ')}
        </Chip>
      </div>
      {state.status !== 'ready' ? (
        <Card>
          <MarketNote state={state} />
        </Card>
      ) : view === 'house' ? (
        <Card className="grid gap-2">
          <CongressTrades trades={state.data.congress} />
          <p className="text-[12px] text-muted-foreground">{t('ที่มา สภาผู้แทนฯ สหรัฐ (Clerk of the House)')}</p>
        </Card>
      ) : funds === null ? (
        <Card>
          <p className="text-[13.5px] text-muted-foreground">{t('ข้อมูล 13F ยังไม่เปิด: เซิร์ฟเวอร์ยังไม่ได้ตั้ง SEC_USER_AGENT')}</p>
        </Card>
      ) : (
        <div className="grid items-start gap-3.5 md:gap-[22px] xl:grid-cols-2">
          {funds.map((fund) => (
            <MarketCard key={fund.cik} title={fund.name} source={t('ที่มา SEC · 13F ไตรมาส {0} · ยื่น {1}', fmtDate(fund.period), fmtDate(fund.filedAt))}>
              {fund.moves.length > 0 ? (
                <ul>
                  {fund.moves.map((move) => (
                    <FundRow key={move.issuer} fund={fund.name} period={fund.period} filedAt={fund.filedAt} move={move} />
                  ))}
                </ul>
              ) : (
                <p className="text-[13.5px] text-muted-foreground">{t('ยังไม่มีการเปลี่ยนแปลงใน 13F ล่าสุด')}</p>
              )}
            </MarketCard>
          ))}
        </div>
      )}
    </>
  )
}

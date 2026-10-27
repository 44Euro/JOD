import { useState } from 'react'
import { Card } from '../../components/ui/card'
import { Chip } from '../../components/ui/chip'
import { todayLocal } from '../../domain/dates'
import { marketClient } from '../../market/client'
import { NEWS_SOURCE, NewsBody } from '../components/NewsList'
import { PageHeader } from '../components/PageHeader'
import { useAppData } from '../hooks'
import { useMarket, useMySymbols } from '../useMarket'
import { t } from '../../i18n'

const HELD_MAX = 10

export function MarketNewsPage() {
  const data = useAppData()
  const { held } = useMySymbols(data)
  const [mine, setMine] = useState(false)
  const asked = mine ? held.slice(0, HELD_MAX) : []
  const state = useMarket(`news:${asked.join(',')}`, () => marketClient.news(asked))
  return (
    <>
      <PageHeader title={t('ข่าวต่างประเทศ')} />
      {held.length > 0 && (
        <div role="group" aria-label={t('เลือกข่าว')} className="flex flex-wrap gap-2">
          <Chip active={!mine} onClick={() => setMine(false)}>
            {t('ข่าวทั่วไป')}
          </Chip>
          <Chip active={mine} onClick={() => setMine(true)}>
            {t('หุ้นที่ถือ')}
          </Chip>
        </div>
      )}
      <Card>
        <NewsBody state={state} today={todayLocal()} />
        <p className="mt-3 text-[12px] text-muted-foreground">{NEWS_SOURCE}</p>
      </Card>
    </>
  )
}

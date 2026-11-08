import { useId, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Card } from '../../components/ui/card'
import { t } from '../../i18n'

// A paper card for fetched market data: its title, a way to the full list, and where the data came from.
export function MarketCard({ title, more, source, children }: { title: string; more?: string; source: string; children: ReactNode }) {
  const id = useId()
  return (
    <Card role="region" aria-labelledby={id}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {more && (
          <Link to={more} className="hit-area text-[13px] font-semibold text-primary underline-offset-[3px] hover:underline">
            {t('ดูทั้งหมด')}
          </Link>
        )}
      </div>
      {children}
      <p className="mt-3 text-[12px] text-muted-foreground">{source}</p>
    </Card>
  )
}

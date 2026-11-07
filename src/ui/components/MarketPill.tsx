import type { AssetType, Market } from '../../domain/types'
import { cn } from '../../lib/cn'
import { MARKET_LABELS } from '../labels'
import { t } from '../../i18n'

const PILLS: Record<Market, { label: string; className: string }> = {
  US: { label: 'US', className: 'bg-market-us' },
  SET: { label: 'SET', className: 'bg-market-set' },
  FUND: { label: 'FUND', className: 'bg-market-fund' },
  BOND: { label: 'BOND', className: 'bg-market-fund' },
  GOLD: { label: 'GOLD', className: 'bg-market-fund' },
  HK: { label: 'HK', className: 'bg-market-intl' },
  JP: { label: 'JP', className: 'bg-market-intl' },
  SG: { label: 'SG', className: 'bg-market-intl' },
  CN: { label: 'CN', className: 'bg-market-intl' },
  EU: { label: 'EU', className: 'bg-market-intl' },
  UK: { label: 'UK', className: 'bg-market-intl' },
  CRYPTO: { label: 'CR', className: 'bg-market-crypto' },
  OTHER: { label: t('อื่น'), className: 'bg-market-intl' },
}

const pillBase =
  'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-display text-[11px] font-semibold leading-4 text-white'

// Funds get their own colour whatever market they trade in, matching the legend in the sidebar.
export function MarketPill({ market, assetType }: { market: Market; assetType?: AssetType }) {
  const pill = assetType === 'fund' ? { label: 'FUND', className: 'bg-market-fund' } : PILLS[market]
  return (
    <span className={cn(pillBase, pill.className)} title={MARKET_LABELS[market]}>
      {pill.label}
    </span>
  )
}

export function CashPill({ label }: { label: string }) {
  return <span className={cn(pillBase, 'bg-market-cash')}>{label}</span>
}

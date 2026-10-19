import { Badge } from '../../components/ui/badge'
import { SPREAD_WARNING_PCT, fxConvertSummary } from '../../domain/fxConvert'
import type { Transaction } from '../../domain/types'
import { fmtPrice } from '../format'
import { spreadText } from '../fxText'
import { FX_SOURCE_LABELS } from '../labels'

export function RateCell({ tx }: { tx: Transaction }) {
  if (tx.type === 'fx_convert') {
    const { effectiveRate, spreadPct } = fxConvertSummary(tx)
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        {fmtPrice(effectiveRate)}
        {spreadPct && (
          <Badge variant={spreadPct.greaterThan(SPREAD_WARNING_PCT) ? 'warning' : 'default'}>{spreadText(spreadPct)}</Badge>
        )}
      </span>
    )
  }
  if (tx.fxSource === 'same') return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {fmtPrice(tx.fxRate)}
      <Badge variant={tx.fxSource}>{FX_SOURCE_LABELS[tx.fxSource]}</Badge>
    </span>
  )
}

import { Badge } from '../../components/ui/badge'
import { fxConvertSummary } from '../../domain/fxConvert'
import type { Transaction } from '../../domain/types'
import { fmtNumber, fmtPrice } from '../format'
import { FX_SOURCE_LABELS } from '../labels'

export function RateCell({ tx }: { tx: Transaction }) {
  if (tx.type === 'fx_convert') {
    const { effectiveRate, spreadPct } = fxConvertSummary(tx)
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        {fmtPrice(effectiveRate)}
        {spreadPct && !spreadPct.isZero() && (
          <Badge variant={spreadPct.abs().greaterThanOrEqualTo(1) ? 'warning' : 'default'}>
            {spreadPct.greaterThan(0) ? 'แพงกว่า' : 'ถูกกว่า'}ตลาด {fmtNumber(spreadPct.abs())}%
          </Badge>
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

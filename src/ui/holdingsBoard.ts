import { todayLocal } from '../domain/dates'
import { D, type Decimal } from '../domain/decimal'
import { unitOf, type Instrument, type Market, type Unit } from '../domain/types'
import type { PositionValuation } from '../domain/valuation'

export interface HoldingsBoardRow {
  instrumentId: string
  symbol: string
  market: Market
  unit: Unit
  quantity: Decimal
  price: Decimal | null
  priceDay: string | null
  changePct: Decimal | null
  comparedWithDay: string | null
}

const dayOf = (iso: string | undefined) => (iso ? todayLocal(new Date(iso)) : null)

// One row per asset however many accounts hold it, largest first; assets without a price go last, by what they cost.
export function buildHoldingsBoard(valuations: readonly PositionValuation[], instruments: readonly Instrument[]): HoldingsBoardRow[] {
  const byId = new Map(instruments.map((i) => [i.id, i]))
  const grouped = new Map<string, { quantity: Decimal; valueBase: Decimal | null; costBase: Decimal }>()
  for (const v of valuations) {
    if (v.position.quantity.isZero()) continue
    const prev = grouped.get(v.position.instrumentId)
    grouped.set(v.position.instrumentId, {
      quantity: (prev?.quantity ?? D(0)).plus(v.position.quantity),
      valueBase: v.marketValueBase === null ? (prev?.valueBase ?? null) : (prev?.valueBase ?? D(0)).plus(v.marketValueBase),
      costBase: (prev?.costBase ?? D(0)).plus(v.position.costBase),
    })
  }
  return [...grouped.entries()]
    .sort(([, a], [, b]) => {
      if ((a.valueBase === null) !== (b.valueBase === null)) return a.valueBase === null ? 1 : -1
      return (b.valueBase ?? b.costBase).comparedTo(a.valueBase ?? a.costBase)
    })
    .map(([instrumentId, g]) => {
      const instrument = byId.get(instrumentId)
      const price = instrument?.lastPrice ? D(instrument.lastPrice) : null
      const previous = instrument?.previousPrice ? D(instrument.previousPrice) : null
      return {
        instrumentId,
        symbol: instrument?.symbol ?? instrumentId.split(':')[1],
        market: instrument?.market ?? (instrumentId.split(':')[0] as Market),
        unit: instrument ? unitOf(instrument) : 'share',
        quantity: g.quantity,
        price,
        priceDay: price ? dayOf(instrument?.lastPriceAt) : null,
        changePct: price && previous && !previous.isZero() ? price.minus(previous).div(previous).times(100) : null,
        comparedWithDay: previous ? dayOf(instrument?.previousPriceAt) : null,
      }
    })
}

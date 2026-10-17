import { useState } from 'react'
import { Link } from 'react-router'
import { Badge } from '../../components/ui/badge'
import { Input } from '../../components/ui/input'
import { Table, Td, Th } from '../../components/ui/table'
import { db } from '../../db/db'
import { setInstrumentPrice } from '../../db/repo'
import { priceAgeDays, todayLocal } from '../../domain/dates'
import { parseDecimalInput } from '../../domain/decimal'
import type { HoldingStats } from '../../domain/holdings'
import { STALE_PRICE_DAYS } from '../../domain/returns'
import type { Instrument } from '../../domain/types'
import type { PositionValuation } from '../../domain/valuation'
import { cn } from '../../lib/cn'
import { fmtNumber, fmtPrice, fmtRate, fmtSigned, fmtSignedPct, fmtValue, fmtYield, plClass } from '../format'
import type { RateInfo } from '../hooks'
import { marketOf } from '../labels'
import { assetPath } from '../nav'
import { useIsDesktop } from '../useIsDesktop'
import { MarketPill } from './MarketPill'

// With stats (the portfolio page, spec S4) the gain columns become total return and yield on cost;
// without them (the overview, spec S1) they show the stock and currency parts of the unrealized gain.
interface HoldingsTableProps {
  valuations: readonly PositionValuation[]
  instruments: ReadonlyMap<string, Instrument>
  accountNames?: ReadonlyMap<string, string>
  base: string
  rates: Record<string, RateInfo>
  editablePrice?: boolean
  stats?: ReadonlyMap<string, HoldingStats>
}

// The name links to the asset page; the row itself holds a price input, so it cannot be one big link.
// On a phone the line under the name comes later in the DOM and would paint over the link's last pixels.
function AssetName({ instrumentId, instrument }: { instrumentId: string; instrument?: Instrument }) {
  return (
    <Link
      to={assetPath(instrumentId)}
      className="-my-2.5 flex min-h-11 min-w-0 items-center gap-2.5 hover:text-primary hover:underline max-md:relative max-md:z-[1] md:my-0 md:min-h-0"
    >
      <MarketPill market={instrument?.market ?? marketOf(instrumentId)} assetType={instrument?.assetType} />
      <b className="font-display text-base font-semibold">{instrument?.symbol ?? instrumentId}</b>
      {instrument && instrument.name !== instrument.symbol && (
        <span className="truncate text-[12.5px] text-muted-foreground">{instrument.name}</span>
      )}
    </Link>
  )
}

function priceInputKey(instrument: Instrument) {
  return `${instrument.id}:${instrument.lastPrice ?? ''}`
}

function PriceInput({ instrument }: { instrument: Instrument }) {
  const [value, setValue] = useState(instrument.lastPrice ?? '')
  const [invalid, setInvalid] = useState(false)
  const age = priceAgeDays(instrument.lastPriceAt, todayLocal())

  async function commit() {
    if (value.trim() === '') return
    const parsed = parseDecimalInput(value)
    setInvalid(parsed === null)
    if (parsed !== null && parsed !== instrument.lastPrice) await setInstrumentPrice(db, instrument.id, parsed)
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Input
        aria-label={`ราคาล่าสุด ${instrument.symbol}`}
        aria-invalid={invalid}
        inputMode="decimal"
        className="h-[46px] w-28 rounded-[10px] px-2.5 md:h-[34px]"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit()
        }}
      />
      {age !== null && age > STALE_PRICE_DAYS && <Badge variant="warning">{age} วันก่อน</Badge>}
    </span>
  )
}

export function HoldingsTable({ valuations, instruments, accountNames, base, rates, editablePrice, stats }: HoldingsTableProps) {
  const isDesktop = useIsDesktop()

  if (!isDesktop) {
    return (
      <ul aria-label="สินทรัพย์ที่ถืออยู่">
        {valuations.map((v) => {
          const p = v.position
          const instrument = instruments.get(p.instrumentId)
          return (
            <li
              key={p.key}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 border-t border-muted py-3 first:border-t-0"
            >
              <AssetName instrumentId={p.instrumentId} instrument={instrument} />
              <span className="font-display font-semibold">{fmtValue(v.marketValueBase)}</span>
              <span className="col-span-2 text-[12.5px] text-muted-foreground">
                {stats ? (
                  <>
                    ยังไม่ขาย <span className={plClass(v.unrealizedBase)}>{fmtSigned(v.unrealizedBase, 0)}</span> · รวมปันผล{' '}
                    <span className={plClass(stats.get(p.key)?.totalReturnBase)}>{fmtSigned(stats.get(p.key)?.totalReturnBase, 0)}</span>
                  </>
                ) : (
                  <>
                    {fmtNumber(p.quantity, 8)} หน่วย · หุ้น{' '}
                    <span className={plClass(v.priceEffectBase)}>{fmtSigned(v.priceEffectBase, 0)}</span>
                  </>
                )}
                {p.currency !== base && (
                  <>
                    {' '}
                    · ค่าเงิน <span className="text-fx">{fmtSigned(v.fxEffectBase, 0)}</span>
                  </>
                )}
              </span>
              {editablePrice && instrument && (
                <span className="col-span-2 flex items-center gap-2 text-[12.5px] text-muted-foreground">
                  ราคาล่าสุด <PriceInput key={priceInputKey(instrument)} instrument={instrument} />
                </span>
              )}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <Table>
      <thead>
        <tr>
          <Th>สินทรัพย์</Th>
          <Th className="text-right">จำนวน</Th>
          <Th className="text-right">ทุนเฉลี่ย</Th>
          {editablePrice && <Th>ราคาล่าสุด</Th>}
          <Th className="text-right">เรทซื้อ → วันนี้</Th>
          <Th className="text-right">มูลค่า ({base})</Th>
          <Th className="text-right">ยังไม่ขาย</Th>
          {stats ? (
            <>
              <Th className="text-right">ผลตอบแทนรวม</Th>
              <Th className="text-right">ปันผล/ทุน</Th>
            </>
          ) : (
            <>
              <Th className="text-right">จากหุ้น</Th>
              <Th className="text-right">จากค่าเงิน</Th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {valuations.map((v) => {
          const p = v.position
          const instrument = instruments.get(p.instrumentId)
          const foreign = p.currency !== base
          const own = stats?.get(p.key)
          return (
            <tr key={p.key}>
              <Td className="max-w-64">
                <AssetName instrumentId={p.instrumentId} instrument={instrument} />
                {accountNames && (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{accountNames.get(p.accountId)}</span>
                )}
              </Td>
              <Td className="text-right">{fmtNumber(p.quantity, 8)}</Td>
              <Td className="text-right">
                {fmtPrice(v.avgCostQuote)} <span className="text-muted-foreground">{p.currency}</span>
              </Td>
              {editablePrice && <Td>{instrument ? <PriceInput key={priceInputKey(instrument)} instrument={instrument} /> : '—'}</Td>}
              <Td className={cn('text-right', foreign ? 'text-fx' : 'text-muted-foreground')}>
                {foreign ? `${fmtRate(v.avgFxRate)} → ${fmtRate(v.currentFxRate)}` : '—'}
                {foreign && rates[p.currency]?.note && <span className="block text-[11px]">{rates[p.currency].note}</span>}
              </Td>
              <Td className="text-right font-display font-semibold">{fmtValue(v.marketValueBase)}</Td>
              <Td className={cn('text-right', plClass(v.unrealizedBase))}>{fmtSigned(v.unrealizedBase, 0)}</Td>
              {stats ? (
                <>
                  <Td className={cn('text-right', plClass(own?.totalReturnBase))}>
                    {fmtSigned(own?.totalReturnBase, 0)}
                    {own?.totalReturnPct && (
                      <span className="block text-[11px] text-muted-foreground">{fmtSignedPct(own.totalReturnPct)}</span>
                    )}
                  </Td>
                  <Td className="text-right">{fmtYield(own?.yieldOnCostPct)}</Td>
                </>
              ) : (
                <>
                  <Td className={cn('text-right', plClass(v.priceEffectBase))}>{fmtSigned(v.priceEffectBase, 0)}</Td>
                  <Td className={cn('text-right', foreign ? 'text-fx' : 'text-muted-foreground')}>
                    {foreign ? fmtSigned(v.fxEffectBase, 0) : '—'}
                  </Td>
                </>
              )}
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}

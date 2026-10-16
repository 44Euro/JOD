import { useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Input } from '../../components/ui/input'
import { Table, Td, Th } from '../../components/ui/table'
import { db } from '../../db/db'
import { setInstrumentPrice } from '../../db/repo'
import { daysBetween, todayLocal } from '../../domain/dates'
import { parseDecimalInput } from '../../domain/decimal'
import type { Instrument } from '../../domain/types'
import type { PositionValuation } from '../../domain/valuation'
import { cn } from '../../lib/cn'
import { fmtNumber, fmtSigned, plClass } from '../format'
import type { RateInfo } from '../hooks'
import { marketOf } from '../labels'
import { useIsDesktop } from '../useIsDesktop'
import { MarketPill } from './MarketPill'

const STALE_AFTER_DAYS = 7

interface HoldingsTableProps {
  valuations: readonly PositionValuation[]
  instruments: ReadonlyMap<string, Instrument>
  accountNames?: ReadonlyMap<string, string>
  base: string
  rates: Record<string, RateInfo>
  editablePrice?: boolean
}

function AssetName({ instrumentId, instrument }: { instrumentId: string; instrument?: Instrument }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <MarketPill market={instrument?.market ?? marketOf(instrumentId)} assetType={instrument?.assetType} />
      <b className="font-display text-base font-semibold">{instrument?.symbol ?? instrumentId}</b>
      {instrument && instrument.name !== instrument.symbol && (
        <span className="truncate text-[12.5px] text-muted-foreground">{instrument.name}</span>
      )}
    </span>
  )
}

function priceInputKey(instrument: Instrument) {
  return `${instrument.id}:${instrument.lastPrice ?? ''}`
}

function PriceInput({ instrument }: { instrument: Instrument }) {
  const [value, setValue] = useState(instrument.lastPrice ?? '')
  const [invalid, setInvalid] = useState(false)
  const age = instrument.lastPriceAt ? daysBetween(instrument.lastPriceAt.slice(0, 10), todayLocal()) : null

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
      {age !== null && age > STALE_AFTER_DAYS && <Badge variant="warning">{age} วันก่อน</Badge>}
    </span>
  )
}

export function HoldingsTable({ valuations, instruments, accountNames, base, rates, editablePrice }: HoldingsTableProps) {
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
              <span className="font-display font-semibold">{fmtNumber(v.marketValueBase)}</span>
              <span className="col-span-2 text-[12.5px] text-muted-foreground">
                {fmtNumber(p.quantity, 8)} หน่วย · หุ้น <span className={plClass(v.priceEffectBase)}>{fmtSigned(v.priceEffectBase)}</span>
                {p.currency !== base && (
                  <>
                    {' '}
                    · ค่าเงิน <span className="text-fx">{fmtSigned(v.fxEffectBase)}</span>
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
          {accountNames && <Th>บัญชี</Th>}
          <Th className="text-right">จำนวน</Th>
          <Th className="text-right">ทุนเฉลี่ย</Th>
          {editablePrice && <Th>ราคาล่าสุด</Th>}
          <Th className="text-right">เรทซื้อ → วันนี้</Th>
          <Th className="text-right">มูลค่า ({base})</Th>
          <Th className="text-right">ยังไม่ขาย</Th>
          <Th className="text-right">จากหุ้น</Th>
          <Th className="text-right">จากค่าเงิน</Th>
        </tr>
      </thead>
      <tbody>
        {valuations.map((v) => {
          const p = v.position
          const instrument = instruments.get(p.instrumentId)
          const foreign = p.currency !== base
          return (
            <tr key={p.key}>
              <Td className="max-w-64">
                <AssetName instrumentId={p.instrumentId} instrument={instrument} />
              </Td>
              {accountNames && <Td className="text-muted-foreground">{accountNames.get(p.accountId)}</Td>}
              <Td className="text-right">{fmtNumber(p.quantity, 8)}</Td>
              <Td className="text-right">
                {fmtNumber(v.avgCostQuote, 4)} <span className="text-muted-foreground">{p.currency}</span>
              </Td>
              {editablePrice && <Td>{instrument ? <PriceInput key={priceInputKey(instrument)} instrument={instrument} /> : '—'}</Td>}
              <Td className="text-right text-fx">
                {foreign ? `${fmtNumber(v.avgFxRate, 4)} → ${fmtNumber(v.currentFxRate, 4)}` : '—'}
                {foreign && rates[p.currency]?.note && <span className="block text-[11px]">{rates[p.currency].note}</span>}
              </Td>
              <Td className="text-right font-display font-semibold">{fmtNumber(v.marketValueBase)}</Td>
              <Td className={cn('text-right', plClass(v.unrealizedBase))}>{fmtSigned(v.unrealizedBase)}</Td>
              <Td className={cn('text-right', plClass(v.priceEffectBase))}>{fmtSigned(v.priceEffectBase)}</Td>
              <Td className="text-right text-fx">{fmtSigned(v.fxEffectBase)}</Td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}

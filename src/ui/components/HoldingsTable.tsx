import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { Alert } from '../../components/ui/alert'
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
import { marketOf, unitLabel } from '../labels'
import { assetPath } from '../nav'
import { useIsDesktop } from '../useIsDesktop'
import { MarketPill } from './MarketPill'
import { t } from '../../i18n'

export function MissingRatesNote({ currencies }: { currencies: readonly string[] }) {
  if (currencies.length === 0) return null
  return (
    <Alert role="note">
      
      {t('ยังไม่มีเรทวันนี้ของ ')}{currencies.join(', ')} {t(' · สินทรัพย์สกุลนี้นับที่ทุน และยังไม่รวมเงินสดสกุลนี้')}
    </Alert>
  )
}

// The table needs about 800px; with the 240px sidebar the card only gets that from about 1180px wide, so narrower
// screens get the two-line rows instead of a table that hides its right-hand columns.
const TABLE_MIN_WIDTH = 1180

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
function AssetName({ instrumentId, instrument, tight }: { instrumentId: string; instrument?: Instrument; tight?: boolean }) {
  return (
    <Link
      to={assetPath(instrumentId)}
      className="-my-2.5 flex min-h-11 min-w-0 items-center gap-2.5 hover:text-primary hover:underline max-md:relative max-md:z-[1] md:my-0 md:min-h-0"
    >
      <MarketPill market={instrument?.market ?? marketOf(instrumentId)} assetType={instrument?.assetType} />
      <b className="font-display text-base font-semibold">{instrument?.symbol ?? instrumentId}</b>
      {instrument && instrument.name !== instrument.symbol && (
        <span className={cn('truncate text-[12.5px] text-muted-foreground', tight && 'md:max-[1366px]:hidden')}>{instrument.name}</span>
      )}
    </Link>
  )
}

function priceInputKey(instrument: Instrument) {
  return `${instrument.id}:${instrument.lastPrice ?? ''}`
}

// The price is always the instrument's own, in its own currency. When the row is held in another currency the
// currency is named beside the input, so the number is not taken for one in the row's currency.
function PriceInput({ instrument, rowCurrency }: { instrument: Instrument; rowCurrency: string }) {
  const [value, setValue] = useState(instrument.lastPrice ?? '')
  const [invalid, setInvalid] = useState(false)
  // Typing the same price again is how someone says it has not moved, and that is what clears the old-price warning;
  // tabbing past the field says nothing.
  const edited = useRef(false)
  const age = priceAgeDays(instrument.lastPriceAt, todayLocal())

  async function commit() {
    if (!edited.current) return
    edited.current = false
    if (value.trim() === '') return
    const parsed = parseDecimalInput(value)
    setInvalid(parsed === null)
    if (parsed !== null) await setInstrumentPrice(db, instrument.id, parsed)
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 md:flex-col md:items-end">
      <Input
        aria-label={t('ราคาล่าสุด {0}', instrument.symbol)}
        aria-invalid={invalid}
        inputMode="decimal"
        className="h-[46px] w-28 rounded-[10px] px-2.5 md:h-[34px]"
        value={value}
        onChange={(e) => {
          edited.current = true
          setValue(e.target.value)
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit()
        }}
      />
      {instrument.currency !== rowCurrency && <span className="text-[12.5px] text-muted-foreground">{instrument.currency}</span>}
      {age !== null && age > STALE_PRICE_DAYS && <Badge variant="warning">{age} {t(' วันก่อน')}</Badge>}
    </span>
  )
}

export function HoldingsTable({ valuations, instruments, accountNames, base, rates, editablePrice, stats }: HoldingsTableProps) {
  const isDesktop = useIsDesktop(TABLE_MIN_WIDTH)

  if (!isDesktop) {
    return (
      <ul aria-label={t('สินทรัพย์ที่ถืออยู่')}>
        {valuations.map((v) => {
          const p = v.position
          const instrument = instruments.get(p.instrumentId)
          const own = stats?.get(p.key)
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
                    <span className="whitespace-nowrap">
                      
                      {t('ยังไม่ขาย ')}<span className={plClass(v.unrealizedBase)}>{fmtSigned(v.unrealizedBase, 0)}</span>
                    </span>{' '}
                    <span className="whitespace-nowrap">
                      
                      {t('· รวมปันผล ')}<span className={plClass(own?.totalReturnBase)}>{fmtSigned(own?.totalReturnBase, 0)}</span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="whitespace-nowrap">{fmtNumber(p.quantity, 8)} {unitLabel(instrument)}</span>{' '}
                    <span className="whitespace-nowrap">
                      
                      {t('· หุ้น ')}<span className={plClass(v.priceEffectBase)}>{fmtSigned(v.priceEffectBase, 0)}</span>
                    </span>
                  </>
                )}
                {p.currency !== base && (
                  <>
                    {' '}
                    <span className="whitespace-nowrap">
                      
                      {t('· ค่าเงิน ')}<span className="text-fx">{fmtSigned(v.fxEffectBase, 0)}</span>
                    </span>
                  </>
                )}
              </span>
              {editablePrice && instrument && (
                <span className="col-span-2 flex items-center gap-2 text-[12.5px] text-muted-foreground">
                  <span className="shrink-0 whitespace-nowrap">{t('ราคาล่าสุด')}</span>
                  <PriceInput key={priceInputKey(instrument)} instrument={instrument} rowCurrency={p.currency} />
                </span>
              )}
            </li>
          )
        })}
      </ul>
    )
  }

  // The portfolio's nine columns together with the long name only fit from about 1366px, so below it the name and the
  // rate's date line are dropped and the cells tightened rather than letting the right-hand columns scroll away.
  // The overview's table has fewer columns and fits without that.
  return (
    <Table className={stats ? 'max-[1366px]:[&_td]:px-1.5 max-[1366px]:[&_th]:px-1.5' : undefined}>
      <thead>
        <tr>
          <Th>{t('สินทรัพย์')}</Th>
          <Th className="text-right">{t('จำนวน')}</Th>
          <Th className="text-right">{t('ทุนเฉลี่ย')}</Th>
          {editablePrice && <Th className="text-right">{t('ราคาล่าสุด')}</Th>}
          <Th className="text-right">{t('เรทซื้อ → วันนี้')}</Th>
          <Th className="text-right">{t('มูลค่า (')}{base})</Th>
          <Th className="text-right">{t('ยังไม่ขาย')}</Th>
          {stats ? (
            <>
              <Th className="text-right">{t('ผลตอบแทนรวม')}</Th>
              <Th className="text-right">{t('ปันผล/ทุน')}</Th>
            </>
          ) : (
            <>
              <Th className="text-right">{t('จากหุ้น')}</Th>
              <Th className="text-right">{t('จากค่าเงิน')}</Th>
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
                <AssetName instrumentId={p.instrumentId} instrument={instrument} tight={stats !== undefined} />
                {accountNames && (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{accountNames.get(p.accountId)}</span>
                )}
              </Td>
              <Td className="text-right">{fmtNumber(p.quantity, 8)}</Td>
              <Td className="text-right">
                {fmtPrice(v.avgCostQuote)} <span className="text-muted-foreground">{p.currency}</span>
              </Td>
              {editablePrice && (
                <Td className="text-right">
                  {instrument ? <PriceInput key={priceInputKey(instrument)} instrument={instrument} rowCurrency={p.currency} /> : '—'}
                </Td>
              )}
              <Td className={cn('text-right', foreign ? 'text-fx' : 'text-muted-foreground')}>
                {foreign ? `${fmtRate(v.avgFxRate)} → ${fmtRate(v.currentFxRate)}` : '—'}
                {foreign && rates[p.currency]?.note && (
                  <span className={cn('block text-[11px]', stats && 'max-[1366px]:hidden')}>{rates[p.currency].note}</span>
                )}
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

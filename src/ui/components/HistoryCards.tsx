import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Segmented } from '../../components/ui/segmented'
import { db } from '../../db/db'
import { addDays } from '../../domain/dates'
import type { Decimal } from '../../domain/decimal'
import {
  benchmarkReturn,
  cumulativeRealized,
  maxDrawdown,
  monthGrid,
  monthTotal,
  periodReturn,
  realizedByDay,
  timeWeighted,
  toDailyPoints,
  tradePricePoints,
} from '../../domain/history'
import type { RealizedEvent } from '../../domain/ledger'
import type { Instrument, Transaction } from '../../domain/types'
import { cn } from '../../lib/cn'
import { fmtDate, fmtHeadline, fmtMonth, fmtSigned, fmtSignedPct, plClass } from '../format'

const ValueChart = lazy(() => import('../charts/Charts').then((m) => ({ default: m.ValueChart })))
const RealizedChart = lazy(() => import('../charts/Charts').then((m) => ({ default: m.RealizedChart })))
const PriceChart = lazy(() => import('../charts/Charts').then((m) => ({ default: m.PriceChart })))

function ChartSlot({ height, children }: { height: number; children: React.ReactNode }) {
  return <Suspense fallback={<div style={{ height }} className="animate-pulse rounded-xl bg-muted" />}>{children}</Suspense>
}

const RANGES = ['3m', '1y', 'all'] as const
type Range = (typeof RANGES)[number]
const RANGE_LABELS: Record<Range, string> = {
  '3m': '3 เดือน',
  '1y': '1 ปี',
  all: 'ทั้งหมด',
}

const pct = (fraction: Decimal | null | undefined) => (fraction ? fmtSignedPct(fraction.times(100)) : '—')

export function PortfolioHistoryCard({ base, today }: { base: string; today: string }) {
  const rows = useLiveQuery(() => db.dailyValues.toArray(), [])
  const [range, setRange] = useState<Range>('1y')
  const points = useMemo(() => {
    const all = toDailyPoints(rows ?? [])
    const from = range === 'all' ? '' : addDays(today, range === '3m' ? -91 : -365)
    return timeWeighted(all.filter((p) => p.date >= from))
  }, [rows, range, today])
  if (!rows) return null

  const growth = periodReturn(points)
  const drawdown = maxDrawdown(points)
  const benchmark = benchmarkReturn(points)
  return (
    <Card className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">มูลค่าพอร์ตตามเวลา</h2>
        <Segmented
          label="ช่วงเวลา"
          singleRow
          options={RANGES.map((value) => ({
            value,
            label: RANGE_LABELS[value],
          }))}
          value={range}
          onChange={setRange}
        />
      </div>
      {points.length < 2 ? (
        <p className="text-sm text-muted-foreground">แอปบันทึกมูลค่าพอร์ตวันละครั้งตอนเปิดแอป กราฟจะขึ้นเมื่อมีข้อมูลอย่างน้อย 2 วัน</p>
      ) : (
        <>
          <ChartSlot height={220}>
            <ValueChart
              base={base}
              data={points.map((p) => ({
                date: p.date,
                value: p.value.toNumber(),
                invested: p.invested.toNumber(),
              }))}
            />
          </ChartSlot>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:flex sm:gap-8">
            <div>
              <dt className="text-[12.5px] text-muted-foreground">ผลตอบแทนช่วงนี้ (ตัดผลเงินเข้าออก)</dt>
              <dd className={cn('font-display text-lg font-semibold', plClass(growth))}>{pct(growth)}</dd>
            </div>
            <div>
              <dt className="text-[12.5px] text-muted-foreground">ลดลงหนักสุดจากจุดสูงสุด</dt>
              <dd className="font-display text-lg font-semibold">
                <span className={plClass(drawdown?.pct)}>{drawdown ? pct(drawdown.pct) : 'ไม่มี'}</span>
                {drawdown && (
                  <span className="block text-[12px] font-normal text-muted-foreground">
                    {fmtDate(drawdown.peakDate)} → {fmtDate(drawdown.troughDate)}
                  </span>
                )}
              </dd>
            </div>
            {benchmark && (
              <div>
                <dt className="text-[12.5px] text-muted-foreground">{benchmark.symbol} ช่วงเดียวกัน</dt>
                <dd className={cn('font-display text-lg font-semibold', plClass(benchmark.change))}>{pct(benchmark.change)}</dd>
                <dd className="text-[12px] text-muted-foreground">ตั้งแต่ {fmtDate(benchmark.from)}</dd>
              </div>
            )}
          </dl>
          <p className="text-[12px] text-muted-foreground">เส้นทึบคือมูลค่า เส้นประคือเงินลงทุนสุทธิ</p>
        </>
      )}
    </Card>
  )
}

const WEEKDAYS = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา']

export function PlCalendar({ events, base, today }: { events: readonly RealizedEvent[]; base: string; today: string }) {
  const byDay = useMemo(() => realizedByDay(events), [events])
  const latest = [...byDay.keys()].sort().at(-1)?.slice(0, 7) ?? today.slice(0, 7)
  const [month, setMonth] = useState(latest)
  const step = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1 + delta, 1))
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  const total = monthTotal(month, byDay)
  return (
    <div className="grid w-full max-w-xl gap-2">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="icon" aria-label="เดือนก่อน" onClick={() => step(-1)}>
          <ChevronLeft aria-hidden />
        </Button>
        <p className="text-center">
          <b>{fmtMonth(month, true)}</b>
          <span className={cn('ml-2 tabular-nums', plClass(total))}>{fmtSigned(total, 0)}</span>
        </p>
        <Button type="button" variant="ghost" size="icon" aria-label="เดือนถัดไป" onClick={() => step(1)}>
          <ChevronRight aria-hidden />
        </Button>
      </div>
      <div role="grid" aria-label={`กำไรขาดทุนรายวัน ${fmtMonth(month, true)}`} className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((d) => (
          <span key={d} role="columnheader" className="text-[11.5px] text-muted-foreground">
            {d}
          </span>
        ))}
        {monthGrid(month, byDay).map((cell, i) =>
          cell ? (
            <span
              key={cell.date}
              role="gridcell"
              title={cell.pl ? `${fmtDate(cell.date)} ${fmtHeadline(cell.pl, base)}` : fmtDate(cell.date)}
              className={cn(
                'grid min-h-11 content-center rounded-lg text-[11px] leading-tight',
                cell.pl?.gt(0) && 'bg-gain-soft text-gain-ink',
                cell.pl?.lt(0) && 'bg-loss-soft text-loss',
                !cell.pl && 'text-muted-foreground',
              )}
            >
              <span>{cell.day}</span>
              {cell.pl && <span className="truncate font-semibold tabular-nums">{fmtSigned(cell.pl, 0)}</span>}
            </span>
          ) : (
            <span key={`pad-${i}`} aria-hidden />
          ),
        )}
      </div>
    </div>
  )
}

export function RealizedHistoryCard({ events, base, today }: { events: readonly RealizedEvent[]; base: string; today: string }) {
  const series = useMemo(() => cumulativeRealized(events), [events])
  if (series.length === 0) return null
  return (
    <Card className="grid gap-4">
      <h2 className="text-lg font-semibold">กำไรที่ขายแล้วสะสม</h2>
      {series.length > 1 && (
        <ChartSlot height={200}>
          <RealizedChart
            base={base}
            data={series.map((p) => ({
              date: p.date,
              total: p.total.toNumber(),
            }))}
          />
        </ChartSlot>
      )}
      <PlCalendar events={events} base={base} today={today} />
    </Card>
  )
}

export function PriceHistoryCard({ transactions, instrument }: { transactions: readonly Transaction[]; instrument: Instrument }) {
  const points = useMemo(
    () =>
      tradePricePoints(
        transactions,
        instrument.id,
        instrument.lastPrice && instrument.lastPriceAt
          ? {
              price: instrument.lastPrice,
              date: instrument.lastPriceAt.slice(0, 10),
            }
          : undefined,
      ),
    [transactions, instrument],
  )
  if (points.length < 2) return null
  return (
    <Card className="grid gap-3">
      <h2 className="text-lg font-semibold">ราคาที่ซื้อขาย</h2>
      <ChartSlot height={200}>
        <PriceChart
          currency={instrument.currency}
          data={points.map((p) => ({
            date: p.date,
            price: p.price.toNumber(),
            kind: p.kind,
          }))}
        />
      </ChartSlot>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
        <span>
          <span className="mr-1 inline-block size-2 rounded-full bg-gain" aria-hidden />
          ซื้อ
        </span>
        <span>
          <span className="mr-1 inline-block size-2 rounded-full bg-loss" aria-hidden />
          ขาย
        </span>
        <span>
          <span className="mr-1 inline-block size-2 rounded-full bg-primary" aria-hidden />
          ยอดยกมา
        </span>
        <span>แอปไม่เก็บราคาย้อนหลัง เส้นนี้ลากจากราคาที่คุณซื้อขายจริงและราคาล่าสุด</span>
      </p>
    </Card>
  )
}

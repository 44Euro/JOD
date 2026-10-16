import { useMemo, useState } from 'react'
import { Card } from '../../components/ui/card'
import { Segmented } from '../../components/ui/segmented'
import { Table, Td, Th } from '../../components/ui/table'
import { todayLocal } from '../../domain/dates'
import { sumBy } from '../../domain/decimal'
import { instrumentStats } from '../../domain/holdings'
import {
  INCOME_KINDS,
  changePct,
  comparisonRange,
  incomeBuckets,
  incomeByAsset,
  inRange,
  periodRange,
  recentIncome,
  sumIncome,
  type AssetIncomeRow,
  type IncomePeriod,
} from '../../domain/income'
import type { IncomeEvent } from '../../domain/ledger'
import type { Instrument } from '../../domain/types'
import { valuePosition } from '../../domain/valuation'
import { cn } from '../../lib/cn'
import { IncomeBars } from '../components/IncomeBars'
import { CashPill, MarketPill } from '../components/MarketPill'
import { PageHeader } from '../components/PageHeader'
import { Stat, SummaryPanel } from '../components/Summary'
import { fmtDate, fmtHeadline, fmtMoney, fmtNumber, fmtPct, fmtSigned, fmtSignedPct, fmtValue, fmtYield, plClass } from '../format'
import { useAppData, useLedger } from '../hooks'
import { INCOME_SERIES, TX_TYPE_LABELS, marketOf } from '../labels'
import { useIsDesktop } from '../useIsDesktop'

const PERIODS = [
  { value: 'year', label: 'ปีนี้' },
  { value: '12m', label: '12 เดือนล่าสุด' },
  { value: 'all', label: 'ทั้งหมด' },
] as const satisfies readonly { value: IncomePeriod; label: string }[]

const PERIOD_INCOME_LABEL: Record<IncomePeriod, string> = { year: 'รายได้ปีนี้', '12m': 'รายได้ 12 เดือนล่าสุด', all: 'รายได้ทั้งหมด' }

// e.g. "SET 10% · US 15%": the share of gross income withheld, per market, in the order the assets are listed.
function withholdingNote(rows: readonly AssetIncomeRow[]): string {
  const markets = new Map<string, AssetIncomeRow[]>()
  for (const row of rows) {
    if (!row.instrumentId || row.taxBase.isZero()) continue
    const market = marketOf(row.instrumentId)
    markets.set(market, [...(markets.get(market) ?? []), row])
  }
  return [...markets]
    .map(([market, list]) => {
      const gross = sumBy(list, (r) => r.grossBase)
      return `${market} ${fmtPct(sumBy(list, (r) => r.taxBase).div(gross).times(100), 0)}`
    })
    .join(' · ')
}

// A row's own currency is only the first event's, so cash interest in two currencies would be mislabelled.
function cashCurrencies(events: readonly IncomeEvent[]): Map<string, string[]> {
  const byAccount = new Map<string, string[]>()
  for (const e of events) {
    if (e.instrumentId) continue
    const list = byAccount.get(e.accountId) ?? []
    if (!list.includes(e.currency)) byAccount.set(e.accountId, [...list, e.currency].sort())
  }
  return byAccount
}

function AssetCell({
  row,
  instrument,
  accountName,
  currencies,
  compact,
}: {
  row: AssetIncomeRow
  instrument?: Instrument
  accountName: string
  currencies: readonly string[]
  compact: boolean
}) {
  if (!row.instrumentId) {
    return (
      <span className="flex min-w-0 items-center gap-2.5">
        <CashPill label={currencies.join('/')} />
        <b className="truncate font-display text-base font-semibold">{accountName}</b>
        {!compact && <span className="truncate text-[12.5px] text-muted-foreground">ดอกเบี้ยเงินสด</span>}
      </span>
    )
  }
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <MarketPill market={instrument?.market ?? marketOf(row.instrumentId)} assetType={instrument?.assetType} />
      <b className="font-display text-base font-semibold">{instrument?.symbol ?? row.instrumentId.split(':')[1]}</b>
      {row.kinds.length === 1 && row.kinds[0] === 'interest' && (
        <span className="truncate text-[12.5px] text-muted-foreground">ดอกเบี้ย/คูปอง</span>
      )}
    </span>
  )
}

export function IncomePage() {
  const data = useAppData()
  const ledger = useLedger(data)
  const isDesktop = useIsDesktop()
  const [period, setPeriod] = useState<IncomePeriod>('year')
  const today = todayLocal()
  // Yield on cost only needs the cost of what is held, so no price or rate is fetched here.
  const valuations = useMemo(() => (ledger ? ledger.positions.map((p) => valuePosition(p)) : []), [ledger])

  if (!data || !ledger) return <p className="text-muted-foreground">กำลังโหลด…</p>
  const base = data.settings.baseCurrency
  const events = ledger.income
  const header = (
    <PageHeader title="รายได้">
      <Segmented label="ช่วงเวลา" options={PERIODS} value={period} onChange={setPeriod} />
    </PageHeader>
  )
  if (events.length === 0) {
    return (
      <>
        {header}
        <Card>
          <p className="font-semibold">ยังไม่มีรายได้</p>
          <p className="text-muted-foreground">บันทึกปันผลหรือดอกเบี้ยแล้วจะสรุปให้ที่นี่</p>
        </Card>
      </>
    )
  }

  const range = periodRange(period, today, events)
  const totals = sumIncome(events, range)
  const previous = sumIncome(events, comparisonRange(period, today)).netBase
  // "All" has no earlier twin, so it shows how this year compares with last year instead.
  const compared = period === 'all' ? sumIncome(events, periodRange('year', today)).netBase : totals.netBase
  const twelve = sumIncome(events, periodRange('12m', today)).netBase
  const monthlyAverage = twelve.div(12)
  const change = changePct(compared, previous)
  const buckets = incomeBuckets(events, period, today)
  const rows = incomeByAsset(events, range)
  const currenciesByAccount = cashCurrencies(inRange(events, range))
  const instruments = new Map(data.instruments.map((i) => [i.id, i]))
  const accountNames = new Map(data.accounts.map((a) => [a.id, a.name]))
  const yieldOf = (row: AssetIncomeRow) =>
    row.instrumentId ? (instrumentStats(row.instrumentId, valuations, ledger, today)?.yieldOnCostPct ?? null) : null
  const symbolOf = (instrumentId: string) => instruments.get(instrumentId)?.symbol ?? instrumentId.split(':')[1]
  const assetCell = (row: AssetIncomeRow, compact = false) => (
    <AssetCell
      row={row}
      instrument={instruments.get(row.instrumentId)}
      accountName={accountNames.get(row.accountId) ?? '—'}
      currencies={currenciesByAccount.get(row.accountId) ?? [row.currency]}
      compact={compact}
    />
  )

  return (
    <>
      {header}

      <SummaryPanel
        label={`${PERIOD_INCOME_LABEL[period]} · หลังหักภาษี`}
        value={fmtHeadline(totals.netBase, base)}
        footer={
          <>
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{period === 'all' ? 'รายปี' : 'รายเดือน'}</h2>
              <p className="flex flex-wrap gap-4 text-[12.5px] text-ink-2">
                {INCOME_KINDS.map((kind) => (
                  <span key={kind} className="flex items-center gap-1.5">
                    <i aria-hidden className={cn('size-2.5 rounded-[3px]', INCOME_SERIES[kind].className)} />
                    {INCOME_SERIES[kind].label} {fmtHeadline(totals.byKind[kind], base)}
                  </span>
                ))}
              </p>
            </div>
            <IncomeBars buckets={buckets} base={base} />
          </>
        }
      >
        <Stat
          label={period === 'all' ? 'ปีนี้เทียบปีก่อน' : 'เทียบปีก่อน'}
          value={fmtSignedPct(change)}
          tone={plClass(change)}
          note={
            period === 'all'
              ? `ปีนี้ ${fmtHeadline(compared, base)} · ช่วงเดียวกันปีก่อน ${fmtHeadline(previous, base)}`
              : `${period === '12m' ? '12 เดือนก่อนหน้า' : 'ช่วงเดียวกันปีก่อน'} ${fmtHeadline(previous, base)}`
          }
        />
        <Stat label="เฉลี่ยต่อเดือน" value={fmtHeadline(monthlyAverage, base)} note={`12 เดือนล่าสุด ${fmtHeadline(twelve, base)}`} />
        <Stat label="ภาษีที่ถูกหัก" value={fmtHeadline(totals.taxBase, base)} note={withholdingNote(rows) || undefined} />
      </SummaryPanel>

      <div className="grid items-start gap-3.5 md:gap-[22px] xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <h2 className="mb-3 text-lg font-semibold">ตามสินทรัพย์</h2>
          {isDesktop ? (
            <Table>
              <thead>
                <tr>
                  <Th>สินทรัพย์</Th>
                  <Th className="text-right">{PERIOD_INCOME_LABEL[period]} ({base})</Th>
                  <Th className="text-right">ปันผล/ทุน</Th>
                  <Th className="text-right">ภาษีที่ถูกหัก</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <Td className="max-w-72">{assetCell(row)}</Td>
                    <Td className="text-right font-display font-semibold">{fmtValue(row.netBase)}</Td>
                    <Td className="text-right">{fmtYield(yieldOf(row))}</Td>
                    <Td className="text-right text-muted-foreground">{fmtValue(row.taxBase)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <ul aria-label="รายได้ตามสินทรัพย์">
              {rows.map((row) => (
                <li
                  key={row.key}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 border-t border-muted py-3 first:border-t-0"
                >
                  {assetCell(row, true)}
                  <span className="font-display font-semibold">{fmtValue(row.netBase)}</span>
                  <span className="col-span-2 text-[12.5px] text-muted-foreground">
                    {row.instrumentId ? `ปันผล/ทุน ${fmtYield(yieldOf(row))}` : 'ดอกเบี้ยเงินสด'} · หัก {fmtValue(row.taxBase)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-semibold">ล่าสุด</h2>
          <ul aria-label="รายได้ล่าสุด">
            {recentIncome(events, 5).map((e) => (
              <li key={e.txId} className="flex items-center justify-between gap-3 border-t border-muted py-3 first:border-t-0">
                <span className="min-w-0">
                  <span className="block truncate">
                    {e.instrumentId ? `${symbolOf(e.instrumentId)} ${TX_TYPE_LABELS[e.kind]}` : `${accountNames.get(e.accountId) ?? '—'} ดอกเบี้ย`}
                  </span>
                  <span className="block text-[12.5px] text-muted-foreground">
                    {fmtDate(e.date)}
                    {!e.taxQuote.isZero() && ` · หัก ${e.currency === base ? fmtNumber(e.taxQuote) : fmtMoney(e.taxQuote, e.currency)}`}
                  </span>
                </span>
                <span className={cn('shrink-0 font-display font-semibold', plClass(e.netBase))}>{fmtSigned(e.netBase, 0)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}

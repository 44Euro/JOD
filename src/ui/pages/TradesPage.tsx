import { Check } from 'lucide-react'
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Alert } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { buttonVariants } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Segmented } from '../../components/ui/segmented'
import { Table, Td, Th } from '../../components/ui/table'
import { daysBetween, todayLocal } from '../../domain/dates'
import { matchTrades, type Trade } from '../../domain/trades'
import {
  closedInPeriod,
  groupTrades,
  mistakeCounts,
  observations,
  tradeStats,
  type Observation,
  type TradeGroup,
  type TradePeriod,
} from '../../domain/tradeStats'
import { symbolOf, type Emotion, type Instrument, type Transaction } from '../../domain/types'
import { cn } from '../../lib/cn'
import { MarketPill } from '../components/MarketPill'
import { PageHeader } from '../components/PageHeader'
import { Stat } from '../components/Summary'
import { TradeReviewForm } from '../components/TradeReviewForm'
import { fmtDate, fmtMoney, fmtMonth, fmtNumber, fmtPct, fmtSigned, plClass } from '../format'
import { useAppData, useLedger } from '../hooks'
import { EMOTION_LABELS, MISTAKE_LABELS, TRADE_PERIOD_LABELS, marketOf } from '../labels'
import { useIsDesktop } from '../useIsDesktop'

const PERIODS = (Object.keys(TRADE_PERIOD_LABELS) as TradePeriod[]).map((value) => ({ value, label: TRADE_PERIOD_LABELS[value] }))

const RECENT_COUNT = 10

type GroupBy = 'strategy' | 'emotion' | 'month'

function groupName(by: GroupBy, key: string): string {
  if (key === '') return 'ไม่ระบุ'
  if (by === 'emotion') return EMOTION_LABELS[key as Emotion]
  return by === 'month' ? fmtMonth(key, true) : key
}

function observationText({ by, group }: Observation): string {
  const subject = by === 'emotion' ? `เทรดตอน ${groupName(by, group.key)}` : `กลยุทธ์ ${group.key}`
  const noStop = group.noStopCount > 0 ? ` · ${group.noStopCount} ใน ${group.count} ครั้งไม่ได้ตั้ง Stop loss` : ''
  return `${subject} ชนะแค่ ${fmtPct(group.winRatePct, 0)} และขาดทุนรวม ${fmtSigned(group.totalBase, 0)}${noStop}`
}

function AssetLabel({ instrumentId, instrument }: { instrumentId: string; instrument?: Instrument }) {
  const symbol = symbolOf(instrumentId)
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <MarketPill market={instrument?.market ?? marketOf(instrumentId)} assetType={instrument?.assetType} />
      <b className="min-w-0 truncate font-display text-base font-semibold" title={symbol}>
        {symbol}
      </b>
    </span>
  )
}

function GroupTable({
  title,
  head,
  by,
  groups,
  currencyMark,
  isDesktop,
  className,
}: {
  title: string
  head: string
  by: GroupBy
  groups: readonly TradeGroup[]
  currencyMark: string
  isDesktop: boolean
  className?: string
}) {
  return (
    <Card className={className}>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {isDesktop ? (
        <Table>
          <thead>
            <tr>
              <Th>{head}</Th>
              <Th className="text-right">เทรด</Th>
              <Th className="text-right">ชนะ</Th>
              <Th className="text-right">รวม ({currencyMark})</Th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.key}>
                <Td className="max-w-56 truncate font-semibold">{groupName(by, group.key)}</Td>
                <Td className="text-right">{group.count}</Td>
                <Td className="text-right">{fmtPct(group.winRatePct, 0)}</Td>
                <Td className={cn('text-right font-display font-semibold', plClass(group.totalBase))}>{fmtSigned(group.totalBase, 0)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <ul aria-label={title}>
          {groups.map((group) => (
            <li
              key={group.key}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 border-t border-muted py-3 first:border-t-0"
            >
              <b className="min-w-0 truncate font-display text-base font-semibold">{groupName(by, group.key)}</b>
              <span className={cn('font-display font-semibold', plClass(group.totalBase))}>{fmtSigned(group.totalBase, 0)}</span>
              <span className="col-span-2 text-[12.5px] text-muted-foreground">
                {`${group.count} เทรด · ชนะ ${fmtPct(group.winRatePct, 0)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// The button is the 44px target on a phone; the badge inside is what the eye sees, as in the mock.
function ReviewButton({ reviewed, open, onClick }: { reviewed: boolean; open: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onClick}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 max-md:-my-3 md:min-h-0 md:min-w-0"
    >
      {reviewed ? (
        <Badge variant="ok">
          <Check aria-hidden />
          รีวิวแล้ว
        </Badge>
      ) : (
        <Badge variant="warning">รีวิว</Badge>
      )}
    </button>
  )
}

export function TradesPage() {
  const data = useAppData()
  const ledger = useLedger(data)
  const isDesktop = useIsDesktop()
  const [period, setPeriod] = useState<TradePeriod>('year')
  const [reviewing, setReviewing] = useState<string | null>(null)
  const trades = useMemo(() => (data && ledger ? matchTrades(data.transactions, ledger) : []), [data, ledger])

  if (!data || !ledger) return <p className="text-muted-foreground">กำลังโหลด…</p>
  const header = (
    <PageHeader title="เทรด">
      <Segmented
        label="ช่วงเวลา"
        options={PERIODS}
        value={period}
        onChange={(value) => {
          setPeriod(value)
          setReviewing(null)
        }}
      />
    </PageHeader>
  )
  if (trades.length === 0) {
    return (
      <>
        {header}
        <Card className="grid justify-items-start gap-3">
          <div>
            <p className="font-semibold">ยังไม่มีเทรด</p>
            <p className="text-muted-foreground">บันทึกการซื้อและขายแล้วสถิติจะขึ้นที่นี่</p>
          </div>
          <Link to="/transactions/new" className={buttonVariants({ size: 'sm' })}>
            บันทึกรายการ
          </Link>
        </Card>
      </>
    )
  }

  const today = todayLocal()
  const currencyMark = data.settings.baseCurrency === 'THB' ? '฿' : data.settings.baseCurrency
  const instruments = new Map(data.instruments.map((i) => [i.id, i]))
  const transactions = new Map<string, Transaction>(data.transactions.map((tx) => [tx.id, tx]))
  const open = trades.filter((trade) => trade.closeDate === null)
  const closed = closedInPeriod(trades, period, today)
  const stats = tradeStats(closed)
  const [warning] = observations(closed)
  const mistakes = mistakeCounts(closed)

  // The review is written on the sell that closed the trade. A swap holds no journal, and a trade that closed by paying
  // another asset's fee has no sell of its own, so neither can be reviewed.
  const closingSell = (trade: Trade) => {
    const tx = trade.closingTxId ? transactions.get(trade.closingTxId) : undefined
    return tx?.type === 'sell' && tx.instrumentId === trade.instrumentId ? tx : undefined
  }
  const toReview = closed.filter((trade) => !trade.reviewed && closingSell(trade) !== undefined).length
  const recent = [...closed].sort((a, b) => (b.closeDate ?? '').localeCompare(a.closeDate ?? '')).slice(0, RECENT_COUNT)

  const days = (value: number | null) => (value === null ? '—' : `${value} วัน`)
  const extremes = [
    stats.maxLossStreak > 0 && `แพ้ติดกันมากสุด ${stats.maxLossStreak} ครั้ง`,
    stats.best && `เทรดดีสุด ${fmtSigned(stats.best.realizedBase, 0)} (${symbolOf(stats.best.instrumentId)})`,
    // A single closed trade is both the best and the worst.
    stats.worst && stats.worst !== stats.best && `แย่สุด ${fmtSigned(stats.worst.realizedBase, 0)} (${symbolOf(stats.worst.instrumentId)})`,
  ]
    .filter(Boolean)
    .join(' · ')

  const toggleReview = (trade: Trade) => setReviewing((current) => (current === trade.id ? null : trade.id))
  const reviewForm = (trade: Trade): ReactNode => {
    const sell = closingSell(trade)
    if (reviewing !== trade.id || !sell) return null
    return <TradeReviewForm name={symbolOf(trade.instrumentId)} txId={sell.id} journal={sell.journal} onClose={() => setReviewing(null)} />
  }
  const reviewButton = (trade: Trade): ReactNode =>
    closingSell(trade) ? <ReviewButton reviewed={trade.reviewed} open={reviewing === trade.id} onClick={() => toggleReview(trade)} /> : null
  const assetOf = (trade: Trade) => <AssetLabel instrumentId={trade.instrumentId} instrument={instruments.get(trade.instrumentId)} />

  return (
    <>
      {header}

      <Card className="grid grid-cols-2 gap-2 max-md:[&>:first-child]:col-span-2 md:grid-cols-3 md:gap-x-6 md:gap-y-5 xl:grid-cols-5">
        <Stat label="เทรดที่ปิดแล้ว" value={String(stats.closed)} note={`เปิดอยู่ ${open.length}`} />
        <Stat label="Win rate" value={fmtPct(stats.winRatePct, 0)} note={`ชนะ ${stats.wins} · แพ้ ${stats.losses}`} />
        <Stat
          label="Profit factor"
          value={fmtMoney(stats.profitFactor)}
          note={`ชนะเฉลี่ย ${fmtNumber(stats.avgWinBase, 0)} · แพ้เฉลี่ย ${fmtNumber(stats.avgLossBase, 0)}`}
        />
        <Stat
          label="ได้ต่อเทรด"
          value={fmtSigned(stats.expectancyBase, 0)}
          tone={plClass(stats.expectancyBase)}
          note={stats.closed > 0 ? `รวม ${fmtSigned(stats.totalBase, 0)}` : undefined}
        />
        <Stat
          label="ถือเฉลี่ย"
          value={days(stats.avgHoldDays)}
          note={`ชนะ ${days(stats.avgHoldWinDays)} · แพ้ ${days(stats.avgHoldLossDays)}`}
        />
      </Card>

      {warning && <Alert role="note">{observationText(warning)}</Alert>}

      {closed.length === 0 ? (
        <Card>
          <p className="text-muted-foreground">ไม่มีเทรดที่ปิดในช่วงนี้</p>
        </Card>
      ) : (
        <>
          <div className="grid items-start gap-3.5 md:gap-[22px] xl:grid-cols-2">
            <GroupTable
              title="กลยุทธ์ไหนทำเงิน"
              head="กลยุทธ์"
              by="strategy"
              groups={groupTrades(closed, 'strategy')}
              currencyMark={currencyMark}
              isDesktop={isDesktop}
            />
            <GroupTable
              title="อารมณ์ตอนเข้า"
              head="อารมณ์"
              by="emotion"
              groups={groupTrades(closed, 'emotion')}
              currencyMark={currencyMark}
              isDesktop={isDesktop}
            />
            <GroupTable
              title="แยกตามเดือน"
              head="เดือน"
              by="month"
              groups={groupTrades(closed, 'month')}
              currencyMark={currencyMark}
              isDesktop={isDesktop}
              className="xl:col-span-2"
            />
          </div>

          <div className="grid items-start gap-3.5 md:gap-[22px] xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">เทรดที่ปิดล่าสุด</h2>
                {toReview > 0 && <Badge variant="warning">{`ยังไม่ได้รีวิว ${toReview}`}</Badge>}
              </div>
              {isDesktop ? (
                <Table>
                  <thead>
                    <tr>
                      <Th>สินทรัพย์</Th>
                      <Th>กลยุทธ์</Th>
                      <Th className="text-right">ถือ</Th>
                      <Th className="text-right">ผล ({currencyMark})</Th>
                      <Th>
                        <span className="sr-only">รีวิว</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((trade) => {
                      const form = reviewForm(trade)
                      return (
                        <Fragment key={trade.id}>
                          <tr>
                            <Td className="max-w-56">{assetOf(trade)}</Td>
                            <Td className="max-w-48 truncate">{trade.strategy ?? '—'}</Td>
                            <Td className="text-right">{days(trade.holdingDays)}</Td>
                            <Td className={cn('text-right font-display font-semibold', plClass(trade.realizedBase))}>
                              {fmtSigned(trade.realizedBase, 0)}
                            </Td>
                            <Td className="text-right">{reviewButton(trade)}</Td>
                          </tr>
                          {form && (
                            <tr>
                              <td colSpan={5} className="px-2 pt-1 pb-4">
                                {form}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </Table>
              ) : (
                <ul aria-label="เทรดที่ปิดล่าสุด">
                  {recent.map((trade) => {
                    const form = reviewForm(trade)
                    return (
                      <li key={trade.id} className="border-t border-muted py-3 first:border-t-0">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1">
                          {assetOf(trade)}
                          <span className={cn('font-display font-semibold', plClass(trade.realizedBase))}>{fmtSigned(trade.realizedBase, 0)}</span>
                          <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">
                            {`${trade.strategy ?? '—'} · ถือ ${days(trade.holdingDays)}`}
                          </span>
                          <span className="justify-self-end">{reviewButton(trade)}</span>
                        </div>
                        {form && <div className="mt-3">{form}</div>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>

            <Card>
              <h2 className="mb-3 text-lg font-semibold">ข้อผิดพลาดที่ทำบ่อย</h2>
              {mistakes.length === 0 ? (
                <p className="text-sm text-muted-foreground">ยังไม่มีข้อผิดพลาดที่บันทึกไว้</p>
              ) : (
                <ul aria-label="ข้อผิดพลาดที่ทำบ่อย">
                  {mistakes.map(({ mistake, count }) => (
                    <li key={mistake} className="flex items-center justify-between gap-3 border-t border-muted py-3 first:border-t-0">
                      <span>{MISTAKE_LABELS[mistake]}</span>
                      <span className="font-display font-semibold">{count} ครั้ง</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2.5 text-[12.5px] text-muted-foreground">{extremes}</p>
            </Card>
          </div>
        </>
      )}

      {open.length > 0 && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold">เทรดที่เปิดอยู่</h2>
          {isDesktop ? (
            <Table>
              <thead>
                <tr>
                  <Th>สินทรัพย์</Th>
                  <Th>เปิดเมื่อ</Th>
                  <Th className="text-right">ถือมา</Th>
                  <Th>กลยุทธ์</Th>
                </tr>
              </thead>
              <tbody>
                {open.map((trade) => (
                  <tr key={trade.id}>
                    <Td className="max-w-56">{assetOf(trade)}</Td>
                    <Td>{fmtDate(trade.openDate)}</Td>
                    <Td className="text-right">{days(daysBetween(trade.openDate, today))}</Td>
                    <Td className="max-w-48 truncate">{trade.strategy ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <ul aria-label="เทรดที่เปิดอยู่">
              {open.map((trade) => (
                <li
                  key={trade.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 border-t border-muted py-3 first:border-t-0"
                >
                  {assetOf(trade)}
                  <span className="text-[13px] text-muted-foreground">{`ถือมา ${days(daysBetween(trade.openDate, today))}`}</span>
                  <span className="col-span-2 truncate text-[12.5px] text-muted-foreground">
                    {`เปิดเมื่อ ${fmtDate(trade.openDate)}${trade.strategy ? ` · ${trade.strategy}` : ''}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  )
}

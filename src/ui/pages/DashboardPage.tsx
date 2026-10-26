import { CalendarClock, DatabaseBackup, Plus, type LucideIcon } from 'lucide-react'
import { Link, Navigate } from 'react-router'
import { Alert } from '../../components/ui/alert'
import { buttonVariants } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { todayLocal } from '../../domain/dates'
import { D, type Decimal } from '../../domain/decimal'
import { instrumentStats } from '../../domain/holdings'
import { accountTracksCash } from '../../domain/ledger'
import { positionValueBase } from '../../domain/investor'
import { portfolioReturn, staleInstruments } from '../../domain/returns'
import { unpricedInstrumentCount, type PositionValuation } from '../../domain/valuation'
import { cn } from '../../lib/cn'
import { PortfolioHistoryCard } from '../components/HistoryCards'
import { HoldingsTable } from '../components/HoldingsTable'
import { MiniRoute, MoneyRoute } from '../components/MoneyRoute'
import { PageHeader } from '../components/PageHeader'
import { RateBoard } from '../components/RateBoard'
import { Stat, SummaryPanel } from '../components/Summary'
import { fmtDate, fmtHeadline, fmtNumber, fmtPrice, fmtRate, fmtSigned, fmtSignedPct, plClass } from '../format'
import { useAppData, useInvestor } from '../hooks'
import { investorRoute } from '../moneyRoutes'
import { buildNotices, type Notice, type NoticeKind } from '../notices'
import { hasSampleData } from '../../db/sampleData'
import { assetPath } from '../nav'
import { EyeButton } from '../privacy'
import { buildRateBoard } from '../rateBoard'

function byValue(a: PositionValuation, b: PositionValuation): number {
  return positionValueBase(b).comparedTo(positionValueBase(a))
}

// The instrument with the most money in it, across every account that holds it.
// Largest first, by value today in the base currency.
function instrumentsBySize(valuations: readonly PositionValuation[]): string[] {
  const totals = new Map<string, Decimal>()
  for (const v of valuations) {
    const id = v.position.instrumentId
    totals.set(id, (totals.get(id) ?? D(0)).plus(positionValueBase(v)))
  }
  return [...totals].sort((a, b) => b[1].comparedTo(a[1])).map(([id]) => id)
}

const NOTICE_ICONS: Partial<Record<NoticeKind, LucideIcon>> = { backup: DatabaseBackup, review: CalendarClock }

function NoticeAlert({ notice }: { notice: Notice }) {
  return (
    <Alert role={notice.tone === 'warning' ? 'alert' : 'note'} icon={NOTICE_ICONS[notice.kind]}>
      {notice.text}
      {notice.to && (
        <>
          {' · '}
          <Link to={notice.to}>{notice.linkText}</Link>
        </>
      )}
    </Alert>
  )
}

export function DashboardPage() {
  const data = useAppData()
  const { ledger, valuations, rates, investor } = useInvestor(data)
  if (!data || !ledger || !investor) return <p className="text-muted-foreground">กำลังโหลด…</p>

  if (data.accounts.length === 0) return <Navigate to="/welcome" replace />

  const base = data.settings.baseCurrency
  const today = todayLocal()
  const { invested, worth, gain } = investor
  const ret = portfolioReturn(investor.flows, worth.totalBase, today)
  const gainPct = ret.sinceStartPct
  const board = buildRateBoard(valuations, base, rates)
  const rateNote = board.find((row) => row.todayNote)?.todayNote
  const instruments = new Map(data.instruments.map((i) => [i.id, i]))
  const held = new Set(ledger.positions.map((p) => p.instrumentId))
  const unpriced = unpricedInstrumentCount(valuations)
  const stale = staleInstruments(ledger.positions, data.instruments, today)
  const dueReviews = data.instruments.filter((i) => held.has(i.id) && i.reviewDate !== undefined && i.reviewDate <= today)
  const top = [...valuations].sort(byValue).slice(0, 5)
  // An asset held in more than one currency has no single exchange rate to show, so the next largest one is used.
  const routed = instrumentsBySize(valuations)
    .map((id) => ({ id, stats: instrumentStats(id, valuations, ledger, today) }))
    .find(({ stats }) => stats !== null && stats.currency !== null && !stats.quantity.isZero())
  const largestId = routed?.id ?? null
  const largest = routed?.stats ?? null
  const largestSymbol = largestId ? (instruments.get(largestId)?.symbol ?? largestId.split(':')[1]) : ''
  const showRoute = largest !== null && largestId !== null
  const notices = buildNotices({
    issuesCount: ledger.issues.length,
    negativeCashAccounts: [
      ...new Set(
        ledger.cash
          .filter((c) => c.amount.lessThan(0) && accountTracksCash(data.transactions, c.accountId))
          .map((c) => data.accounts.find((a) => a.id === c.accountId)?.name ?? c.accountId),
      ),
    ],
    lastBackupAt: data.settings.lastBackupAt,
    firstTxCreatedAt: data.transactions.reduce<string | undefined>((first, tx) => (!first || tx.createdAt < first ? tx.createdAt : first), undefined),
    unpricedCount: unpriced,
    staleCount: stale.length,
    missingRates: worth.missingRates,
    dueReviews,
    today,
  })
  const topNotices = notices.filter((n) => n.kind === 'issues' || n.kind === 'cash_gap')
  const sideNotices = notices.filter((n) => n.kind !== 'issues' && n.kind !== 'cash_gap')
  const hasSideColumn = showRoute || sideNotices.length > 0

  return (
    <>
      <PageHeader title="ภาพรวม" note={rateNote ? `เรทวันนี้ ${rateNote}` : undefined}>
        {hasSampleData(data.accounts) && (
          <Link
            to="/settings"
            className="inline-flex h-8 items-center rounded-full border bg-card px-3 text-[12.5px] font-semibold text-ink-2 hover:bg-muted max-md:h-11"
          >
            ข้อมูลตัวอย่าง
          </Link>
        )}
        <EyeButton />
        <Link to="/transactions/new" className={cn(buttonVariants({ size: 'sm' }), 'max-md:hidden')}>
          <Plus aria-hidden />
          บันทึกรายการ
        </Link>
      </PageHeader>

      {topNotices.map((notice) => (
        <NoticeAlert key={notice.id} notice={notice} />
      ))}

      <SummaryPanel
        label="มูลค่าวันนี้ · สินทรัพย์ + เงินสด"
        value={fmtHeadline(worth.totalBase, base)}
        footer={
          investor.flows.length > 0 && (
            <>
              <h2 className="mb-4 text-lg font-semibold">จากเงินลงทุนถึงวันนี้</h2>
              <MoneyRoute label="จากเงินลงทุนถึงวันนี้" stations={investorRoute(investor)} />
            </>
          )
        }
      >
        <Stat
          label="เงินลงทุนสุทธิ"
          value={fmtHeadline(invested.totalBase, base)}
          note={`ฝาก ${fmtNumber(invested.inBase, 0)} · ถอน ${fmtNumber(invested.outBase, 0)}`}
        />
        <Stat
          label="กำไรรวม"
          value={fmtSigned(gain.totalBase, 0)}
          tone={plClass(gain.totalBase)}
          note={ret.annualized && gainPct !== null ? `${fmtSignedPct(gainPct)} ตั้งแต่เริ่ม` : ret.startDate ? `ตั้งแต่ ${fmtDate(ret.startDate)}` : undefined}
        />
        {ret.annualized ? (
          <Stat
            label="ผลตอบแทนต่อปี"
            value={fmtSignedPct(ret.annualPct)}
            tone={plClass(ret.annualPct)}
            note="คิดตามจังหวะเงินเข้า-ออก"
            flag={stale.length > 0 ? 'ราคาเก่า' : undefined}
          />
        ) : (
          <Stat
            label="ผลตอบแทนตั้งแต่เริ่ม"
            value={fmtSignedPct(ret.sinceStartPct)}
            tone={plClass(ret.sinceStartPct)}
            note="ข้อมูลยังไม่ถึง 1 ปี"
            flag={stale.length > 0 ? 'ราคาเก่า' : undefined}
          />
        )}
      </SummaryPanel>

      <div
        className={cn(
          'grid grid-cols-[minmax(0,1fr)] items-start gap-3.5 md:gap-[22px]',
          hasSideColumn && 'xl:grid-cols-[minmax(0,1fr)_340px]',
        )}
      >
        {board.length > 0 && <RateBoard rows={board} base={base} />}
        {hasSideColumn && (
          <div className="grid min-w-0 content-start gap-4">
            {showRoute && (
              <Link to={assetPath(largestId)} className="block rounded-[18px] border bg-card p-4 hover:bg-muted md:rounded-[20px] md:px-[26px] md:py-[22px]">
                <h2 className="mb-4 text-lg font-semibold">เส้นทางเงิน · {largestSymbol}</h2>
                <MiniRoute
                  from={base === 'THB' ? 'บาท' : base}
                  via={
                    largest.currency === base
                      ? 'ไม่ต้องแลกเงิน'
                      : `แลกที่ ${fmtRate(largest.costQuote.isZero() ? null : largest.costBase.div(largest.costQuote))}`
                  }
                  to={`${largestSymbol} @${fmtPrice(largest.costQuote.div(largest.quantity))}`}
                />
              </Link>
            )}
            {sideNotices.map((notice) => (
              <NoticeAlert key={notice.id} notice={notice} />
            ))}
          </div>
        )}
      </div>

      <PortfolioHistoryCard base={base} today={today} />

      {top.length > 0 && (
        <Card>
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">สินทรัพย์ที่ถืออยู่</h2>
            <Link
              to="/portfolio"
              className="-my-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary md:my-0 md:min-h-0"
            >
              ดูพอร์ตทั้งหมด
            </Link>
          </div>
          <HoldingsTable valuations={top} instruments={instruments} base={base} rates={rates} />
        </Card>
      )}
    </>
  )
}

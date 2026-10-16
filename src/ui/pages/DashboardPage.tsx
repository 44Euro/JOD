import { CalendarClock, Plus } from 'lucide-react'
import { Link } from 'react-router'
import { Alert } from '../../components/ui/alert'
import { buttonVariants } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { todayLocal } from '../../domain/dates'
import { D, type Decimal } from '../../domain/decimal'
import { instrumentStats } from '../../domain/holdings'
import { positionValueBase } from '../../domain/investor'
import { portfolioReturn, staleInstruments } from '../../domain/returns'
import type { PositionValuation } from '../../domain/valuation'
import { cn } from '../../lib/cn'
import { HoldingsTable } from '../components/HoldingsTable'
import { MiniRoute, MoneyRoute } from '../components/MoneyRoute'
import { PageHeader } from '../components/PageHeader'
import { RateBoard } from '../components/RateBoard'
import { Stat, SummaryPanel } from '../components/Summary'
import { fmtDate, fmtHeadline, fmtNumber, fmtPrice, fmtRate, fmtSigned, fmtSignedPct, plClass } from '../format'
import { useAppData, useInvestor } from '../hooks'
import { investorRoute } from '../moneyRoutes'
import { assetPath } from '../nav'
import { buildRateBoard } from '../rateBoard'

function byValue(a: PositionValuation, b: PositionValuation): number {
  return positionValueBase(b).comparedTo(positionValueBase(a))
}

// The instrument with the most money in it, across every account that holds it.
function largestInstrument(valuations: readonly PositionValuation[]): string | null {
  const totals = new Map<string, Decimal>()
  for (const v of valuations) {
    const id = v.position.instrumentId
    totals.set(id, (totals.get(id) ?? D(0)).plus(positionValueBase(v)))
  }
  let best: string | null = null
  for (const [id, total] of totals) if (best === null || total.greaterThan(totals.get(best) ?? D(0))) best = id
  return best
}

export function DashboardPage() {
  const data = useAppData()
  const { ledger, valuations, rates, investor } = useInvestor(data)
  if (!data || !ledger || !investor) return <p className="text-muted-foreground">กำลังโหลด…</p>

  if (data.accounts.length === 0) {
    return (
      <Card className="grid max-w-2xl gap-3">
        <h1 className="text-[26px] font-semibold md:text-[34px]">ยินดีต้อนรับสู่ JOD</h1>
        <p className="text-ink-2">จดทุกเทรด รู้ทุกบาท · เริ่มจากเพิ่มบัญชีโบรกเกอร์ แล้วบันทึกรายการแรก หรือกรอกยอดยกมาของพอร์ตที่มีอยู่</p>
        <Link to="/settings" className={buttonVariants({ className: 'justify-self-start' })}>
          เพิ่มบัญชีแรก
        </Link>
      </Card>
    )
  }

  const base = data.settings.baseCurrency
  const today = todayLocal()
  const { invested, worth, gain } = investor
  const ret = portfolioReturn(investor.flows, worth.totalBase, today)
  const gainPct = ret.sinceStartPct
  const board = buildRateBoard(valuations, base, rates)
  const rateNote = board.find((row) => row.todayNote)?.todayNote
  const instruments = new Map(data.instruments.map((i) => [i.id, i]))
  const held = new Set(ledger.positions.map((p) => p.instrumentId))
  const stale = staleInstruments(ledger.positions, data.instruments, today)
  const dueReviews = data.instruments.filter((i) => held.has(i.id) && i.reviewDate !== undefined && i.reviewDate <= today)
  const top = [...valuations].sort(byValue).slice(0, 5)
  const largestId = largestInstrument(valuations)
  const largest = largestId ? instrumentStats(largestId, valuations, ledger, today) : null
  const largestSymbol = largestId ? (instruments.get(largestId)?.symbol ?? largestId.split(':')[1]) : ''

  return (
    <>
      <PageHeader title="ภาพรวม" note={rateNote ? `เรทวันนี้ ${rateNote}` : undefined}>
        <Link to="/transactions/new" className={cn(buttonVariants({ size: 'sm' }), 'max-md:hidden')}>
          <Plus aria-hidden />
          บันทึกรายการ
        </Link>
      </PageHeader>

      {ledger.issues.length > 0 && (
        <Alert>
          มี {ledger.issues.length} รายการที่คำนวณไม่ได้ · <Link to="/transactions">ไปตรวจสอบ</Link>
        </Alert>
      )}

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
          note={ret.annualized ? `${fmtSignedPct(gainPct)} ตั้งแต่เริ่ม` : ret.startDate ? `ตั้งแต่ ${fmtDate(ret.startDate)}` : undefined}
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

      <div className="grid items-start gap-3.5 md:gap-[22px] xl:grid-cols-[minmax(0,1fr)_340px]">
        {board.length > 0 && <RateBoard rows={board} base={base} />}
        <div className="grid content-start gap-4">
          {largest && largestId && !largest.quantity.isZero() && (
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
          {worth.unpricedCount > 0 && (
            <Alert role="note">
              ยังไม่มีราคาล่าสุด {worth.unpricedCount} ตัว (นับที่ทุนไปก่อน) · <Link to="/portfolio">กรอกราคา</Link>
            </Alert>
          )}
          {stale.length > 0 && (
            <Alert role="note">
              ราคา {stale.length} ตัวไม่ได้อัปเดตเกิน 7 วัน · <Link to="/portfolio">อัปเดตราคา</Link>
            </Alert>
          )}
          {worth.missingRates.length > 0 && (
            <Alert role="note">
              ยังไม่มีเรทวันนี้ของ {worth.missingRates.join(', ')} · สินทรัพย์สกุลนี้นับที่ทุน และยังไม่รวมเงินสดสกุลนี้
            </Alert>
          )}
          {dueReviews.map((instrument) => (
            <Alert key={instrument.id} role="note" icon={CalendarClock}>
              ถึงวันทบทวนเหตุผลที่ถือ {instrument.symbol} · <Link to={assetPath(instrument.id)}>เปิดดู</Link>
            </Alert>
          ))}
        </div>
      </div>

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

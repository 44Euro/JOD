import { Plus } from 'lucide-react'
import { Link } from 'react-router'
import { Alert } from '../../components/ui/alert'
import { buttonVariants } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { sumBy, type Decimal } from '../../domain/decimal'
import type { PortfolioSummary } from '../../domain/valuation'
import { cn } from '../../lib/cn'
import { HoldingsTable } from '../components/HoldingsTable'
import { MoneyRoute, type Station } from '../components/MoneyRoute'
import { PageHeader } from '../components/PageHeader'
import { RateBoard } from '../components/RateBoard'
import { Stat, SummaryPanel } from '../components/Summary'
import { fmtHeadline, fmtMoney, fmtNumber, fmtSigned, plClass } from '../format'
import { useAppData, usePortfolio } from '../hooks'
import { buildRateBoard } from '../rateBoard'

function toneOf(value: Decimal): Station['tone'] {
  return value.greaterThan(0) ? 'gain' : value.lessThan(0) ? 'loss' : undefined
}

// Each station is rounded to whole units; the currency station is the remainder by definition (spec 7.2),
// so it also absorbs the rounding and the stations always add up to the end value exactly.
function costToToday(summary: PortfolioSummary): Station[] {
  const cost = summary.costBase.toDecimalPlaces(0)
  const value = summary.marketValueBase.toDecimalPlaces(0)
  const price = summary.priceEffectBase.toDecimalPlaces(0)
  const fx = value.minus(cost).minus(price)
  return [
    { value: fmtNumber(cost, 0), label: 'ทุนของที่ถืออยู่' },
    { value: fmtSigned(price, 0), label: 'จากหุ้น · ยังไม่ขาย', tone: toneOf(price) },
    { value: fmtSigned(fx, 0), label: 'จากค่าเงิน · ยังไม่ขาย', tone: 'fx', fx: true },
    { value: fmtNumber(value, 0), label: 'มูลค่าวันนี้' },
  ]
}

export function DashboardPage() {
  const data = useAppData()
  const { ledger, valuations, summary, rates } = usePortfolio(data)
  if (!data || !ledger) return <p className="text-muted-foreground">กำลังโหลด…</p>

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
  const realized = sumBy(ledger.realized, (e) => e.realizedBase)
  const realizedPrice = sumBy(ledger.realized, (e) => e.priceEffectBase)
  const realizedFx = sumBy(ledger.realized, (e) => e.fxEffectBase)
  const income = sumBy(ledger.income, (i) => i.netBase)
  const board = buildRateBoard(valuations, base, rates)
  const rateNote = board.find((row) => row.todayNote)?.todayNote
  const instruments = new Map(data.instruments.map((i) => [i.id, i]))
  const top = [...valuations]
    .sort((a, b) => (b.marketValueBase?.toNumber() ?? 0) - (a.marketValueBase?.toNumber() ?? 0))
    .slice(0, 5)

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
      {summary.unvaluedCount > 0 && (
        <Alert role="note">
          ยังไม่มีราคาล่าสุด {summary.unvaluedCount} ตัว · <Link to="/portfolio">กรอกราคา</Link>
        </Alert>
      )}

      <SummaryPanel label="มูลค่าสินทรัพย์วันนี้ · ไม่รวมเงินสด" value={fmtHeadline(summary.marketValueBase, base)}>
        <Stat
          label="ยังไม่ขาย"
          value={fmtSigned(summary.unrealizedBase)}
          tone={plClass(summary.unrealizedBase)}
          note={`จากหุ้น ${fmtSigned(summary.priceEffectBase)} · จากค่าเงิน ${fmtSigned(summary.fxEffectBase)}`}
        />
        <Stat
          label="ขายแล้ว"
          value={fmtSigned(realized)}
          tone={plClass(realized)}
          note={`จากหุ้น ${fmtSigned(realizedPrice)} · จากค่าเงิน ${fmtSigned(realizedFx)}`}
        />
        <Stat label="ปันผลและดอกเบี้ยสุทธิ" value={fmtMoney(income, base)} note={`ค่าธรรมเนียมรวม ${fmtMoney(ledger.feesBase, base)}`} />
      </SummaryPanel>

      {summary.costBase.greaterThan(0) && (
        <Card>
          <h2 className="mb-4 text-lg font-semibold">จากทุนถึงมูลค่าวันนี้</h2>
          <MoneyRoute label="จากทุนถึงมูลค่าวันนี้" stations={costToToday(summary)} />
        </Card>
      )}

      {board.length > 0 && <RateBoard rows={board} base={base} />}

      {top.length > 0 && (
        <Card>
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">สินทรัพย์ที่ถืออยู่</h2>
            <Link to="/portfolio" className="text-sm font-semibold text-primary">
              ดูพอร์ตทั้งหมด
            </Link>
          </div>
          <HoldingsTable valuations={top} instruments={instruments} base={base} rates={rates} />
        </Card>
      )}
    </>
  )
}

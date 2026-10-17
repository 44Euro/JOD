import { ChevronLeft } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { Badge } from '../../components/ui/badge'
import { Card } from '../../components/ui/card'
import { Table, Td, Th } from '../../components/ui/table'
import { todayLocal } from '../../domain/dates'
import { D, sumBy, type Decimal } from '../../domain/decimal'
import { instrumentStats } from '../../domain/holdings'
import { feesQuote, sortTransactions } from '../../domain/ledger'
import { cn } from '../../lib/cn'
import { MarketPill } from '../components/MarketPill'
import { MoneyRoute } from '../components/MoneyRoute'
import { RateCell } from '../components/RateCell'
import { Stat, SummaryPanel } from '../components/Summary'
import { ThesisCard } from '../components/ThesisCard'
import { fmtDate, fmtHeadline, fmtNumber, fmtPrice, fmtSigned, fmtSignedPct, fmtValue, fmtYield, plClass } from '../format'
import { useAppData, usePortfolio } from '../hooks'
import { TX_TYPE_LABELS, marketOf } from '../labels'
import { assetRoute } from '../moneyRoutes'
import { describeAmount, netOf } from '../transactionText'
import { useIsDesktop } from '../useIsDesktop'

function badgeOf(value: Decimal | null): 'ok' | 'loss' | 'default' {
  if (!value) return 'default'
  return value.greaterThan(0) ? 'ok' : value.lessThan(0) ? 'loss' : 'default'
}

export function AssetPage() {
  const { id = '' } = useParams()
  const data = useAppData()
  const { ledger, valuations, rates, ready } = usePortfolio(data)
  const isDesktop = useIsDesktop()
  if (!data || !ledger || !ready) return <p className="text-muted-foreground">กำลังโหลด…</p>

  const base = data.settings.baseCurrency
  const today = todayLocal()
  const instrument = data.instruments.find((i) => i.id === id)
  const stats = instrumentStats(id, valuations, ledger, today)
  const back = (
    <Link to="/portfolio" className="-my-3 inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-primary md:my-0 md:min-h-0">
      <ChevronLeft className="size-4" aria-hidden />
      พอร์ต
    </Link>
  )
  if (!instrument && !stats) {
    return (
      <>
        {back}
        <Card>ไม่พบสินทรัพย์นี้</Card>
      </>
    )
  }

  const symbol = instrument?.symbol ?? id.split(':')[1] ?? id
  const issues = new Map(ledger.issues.map((i) => [i.txId, i.message]))
  const transactions = sortTransactions(data.transactions.filter((t) => t.instrumentId === id)).reverse()
  const fees = sumBy(
    transactions.filter((t) => !issues.has(t.id)),
    (t) => feesQuote(t).times(D(t.fxRate)),
  )
  const lastPrice = instrument?.lastPrice ? D(instrument.lastPrice) : null
  const todayRate = stats && rates[stats.currency] ? D(rates[stats.currency].rate) : null
  const route = stats ? assetRoute(stats, lastPrice, todayRate, base) : []

  return (
    <>
      {back}
      <div className="flex flex-wrap items-center gap-3">
        <MarketPill market={instrument?.market ?? marketOf(id)} assetType={instrument?.assetType} />
        <h1 className="text-[26px] font-semibold leading-tight md:text-[34px]">{symbol}</h1>
        {instrument && instrument.name !== instrument.symbol && <span className="text-muted-foreground">{instrument.name}</span>}
      </div>

      {stats && (
        <SummaryPanel
          label={
            stats.quantity.isZero()
              ? 'ขายหมดแล้ว'
              : `มูลค่าวันนี้ · ${fmtNumber(stats.quantity, 8)} หน่วย × ${fmtPrice(lastPrice)} ${stats.currency}`
          }
          value={fmtHeadline(stats.valueBase, base)}
          footer={
            route.length > 0 && (
              <>
                <h2 className="mb-4 text-lg font-semibold">เส้นทางเงินของ {symbol}</h2>
                <MoneyRoute label={`เส้นทางเงินของ ${symbol}`} stations={route} />
                <p className="mt-[18px] flex flex-wrap gap-2">
                  <Badge variant={badgeOf(stats.priceEffectBase)}>จากหุ้น {fmtSigned(stats.priceEffectBase, 0)}</Badge>
                  {stats.currency !== base && <Badge variant="auto">จากค่าเงิน {fmtSigned(stats.fxEffectBase, 0)}</Badge>}
                  <Badge>ปันผล {fmtSigned(stats.incomeBase, 0)}</Badge>
                </p>
              </>
            )
          }
        >
          <Stat
            label="ผลตอบแทนรวม"
            value={fmtSigned(stats.totalReturnBase, 0)}
            tone={plClass(stats.totalReturnBase)}
            note={stats.totalReturnPct ? `${fmtSignedPct(stats.totalReturnPct)} รวมปันผล` : undefined}
          />
          <Stat
            label="ปันผลรับแล้ว"
            value={fmtHeadline(stats.incomeBase, base)}
            note={`ปันผล/ทุน ${fmtYield(stats.yieldOnCostPct)}`}
          />
          <Stat
            label="ทุนเฉลี่ย"
            value={stats.quantity.isZero() ? '—' : fmtPrice(stats.costQuote.div(stats.quantity))}
            note={`${stats.currency} ต่อหน่วย`}
          />
        </SummaryPanel>
      )}

      <div className="grid items-start gap-3.5 md:gap-[22px] xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">ทุกรายการของ {symbol}</h2>
            <Badge>ทั้งหมด {transactions.length} รายการ</Badge>
          </div>
          {isDesktop ? (
            <Table>
              <thead>
                <tr>
                  <Th>วันที่</Th>
                  <Th>ประเภท</Th>
                  <Th>รายละเอียด</Th>
                  <Th>เรท</Th>
                  <Th className="text-right">สุทธิ ({base})</Th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const issue = issues.get(tx.id)
                  const net = netOf(tx, issue !== undefined)
                  return (
                    <tr key={tx.id} className={cn(issue && 'bg-warning-bg [&>td]:border-transparent')}>
                      <Td>
                        <Link to={`/transactions/${tx.id}`} className="hover:underline">
                          {fmtDate(tx.date)}
                        </Link>
                      </Td>
                      <Td>{TX_TYPE_LABELS[tx.type]}</Td>
                      <Td className="max-w-64 truncate">
                        {describeAmount(tx)}
                        {tx.note && <span className="text-muted-foreground"> · {tx.note}</span>}
                      </Td>
                      <Td>
                        <RateCell tx={tx} />
                      </Td>
                      <Td className={cn('text-right font-display font-semibold', net.className)}>{net.text}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          ) : (
            <ul aria-label={`ทุกรายการของ ${symbol}`}>
              {transactions.map((tx) => {
                const net = netOf(tx, issues.has(tx.id))
                return (
                  <li key={tx.id} className="border-t border-muted first:border-t-0">
                    <Link to={`/transactions/${tx.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 py-3">
                      <span>{fmtDate(tx.date)}</span>
                      <span className={cn('font-display font-semibold', net.className)}>{net.text}</span>
                      <span className="col-span-2 text-[12.5px] text-muted-foreground">
                        {TX_TYPE_LABELS[tx.type]} {describeAmount(tx)}
                        {tx.fxSource !== 'same' && ` · ${tx.fxSource === 'estimated' ? 'เรทประมาณ' : 'เรท'} ${fmtPrice(tx.fxRate)}`}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <div className="grid content-start gap-4">
          {instrument && <ThesisCard key={instrument.id} instrument={instrument} today={today} />}
          {stats && (
            <Card>
              <h2 className="mb-2 text-base font-semibold">สรุป</h2>
              <dl className="grid text-sm">
                <div className="flex justify-between gap-3 py-2.5">
                  <dt className="text-muted-foreground">กำไรที่ขายแล้ว</dt>
                  <dd className={plClass(stats.realizedBase)}>{fmtSigned(stats.realizedBase, 0)}</dd>
                </div>
                <div className="flex justify-between gap-3 border-t border-muted py-2.5">
                  <dt className="text-muted-foreground">ปันผลรวม (หลังภาษี)</dt>
                  <dd className={plClass(stats.incomeBase)}>{fmtSigned(stats.incomeBase, 0)}</dd>
                </div>
                <div className="flex justify-between gap-3 border-t border-muted py-2.5">
                  <dt className="text-muted-foreground">ค่าธรรมเนียมรวม</dt>
                  <dd>{fmtValue(fees)}</dd>
                </div>
              </dl>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}

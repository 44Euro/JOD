import { ChevronLeft, Copy, Pencil } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Badge } from '../../components/ui/badge'
import { Button, buttonVariants } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Table, Td, Th } from '../../components/ui/table'
import { todayLocal } from '../../domain/dates'
import { D, sumBy, type Decimal } from '../../domain/decimal'
import { instrumentStats } from '../../domain/holdings'
import { feesQuote, sortTransactions } from '../../domain/ledger'
import type { Transaction } from '../../domain/types'
import { cn } from '../../lib/cn'
import { MarketPill } from '../components/MarketPill'
import { MoneyRoute } from '../components/MoneyRoute'
import { RateCell } from '../components/RateCell'
import { RenameInstrument } from '../components/RenameInstrument'
import { Stat, SummaryPanel } from '../components/Summary'
import { PriceHistoryCard } from '../components/HistoryCards'
import { LotsCard } from '../components/RiskCards'
import { ThesisCard } from '../components/ThesisCard'
import { fmtDate, fmtHeadline, fmtNumber, fmtPrice, fmtSigned, fmtSignedPct, fmtValue, fmtYield, plClass } from '../format'
import { useAppData, usePortfolio } from '../hooks'
import { EMOTION_LABELS, FEE_PAID_ROW_LABEL, TX_TYPE_LABELS, marketOf, unitLabel } from '../labels'
import { assetRoute } from '../moneyRoutes'
import { describeAmount, describeFeePaid, feeFreeTransfer, feePaidNet, issueText, netOf } from '../transactionText'
import { useIsDesktop } from '../useIsDesktop'
import { t } from '../../i18n'

function badgeOf(value: Decimal | null): 'ok' | 'loss' | 'default' {
  if (!value) return 'default'
  return value.greaterThan(0) ? 'ok' : value.lessThan(0) ? 'loss' : 'default'
}

// A long strategy gives way to the emotion, which is short and is what the line is mostly for.
function JournalLine({ journal, className }: { journal: Transaction['journal']; className?: string }) {
  const strategy = journal?.strategy
  const emotion = journal?.emotion && EMOTION_LABELS[journal.emotion]
  if (!strategy && !emotion) return null
  return (
    <span className={cn('flex min-w-0 gap-1 text-[12.5px] text-muted-foreground', className)}>
      {strategy && (
        <span title={strategy} className="min-w-0 truncate">
          {strategy}
        </span>
      )}
      {emotion && <span className="shrink-0">{strategy ? ` · ${emotion}` : emotion}</span>}
    </span>
  )
}

export function AssetPage() {
  const { id = '' } = useParams()
  const data = useAppData()
  const { ledger, valuations, rates, ready } = usePortfolio(data)
  // The history table is cut off beside the sidebar on a tablet, so rows are used until 1024px.
  const isDesktop = useIsDesktop(1024)
  const [renamingId, setRenamingId] = useState<string>()
  // Coming back to an asset after visiting another must not find its form still open.
  if (renamingId !== undefined && renamingId !== id) setRenamingId(undefined)
  if (!data || !ledger || !ready) return <p className="text-muted-foreground">{t('กำลังโหลด…')}</p>

  const base = data.settings.baseCurrency
  const today = todayLocal()
  const instrument = data.instruments.find((i) => i.id === id)
  const stats = instrumentStats(id, valuations, ledger, today)
  const back = (
    <Link to="/portfolio" className="-my-3 inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-primary md:my-0 md:min-h-0">
      <ChevronLeft className="size-4" aria-hidden />
      
      {t('พอร์ต')}
    </Link>
  )
  if (!instrument && !stats) {
    return (
      <>
        {back}
        <Card>{t('ไม่พบสินทรัพย์นี้')}</Card>
      </>
    )
  }

  const symbol = instrument?.symbol ?? id.split(':')[1] ?? id
  const issues = new Map(ledger.issues.map((i) => [i.txId, issueText(i)]))
  const accountNames = new Map(data.accounts.map((a) => [a.id, a.name]))
  const instruments = new Map(data.instruments.map((i) => [i.id, i]))
  const transactions = sortTransactions(
    data.transactions.filter((t) => t.instrumentId === id || t.toInstrumentId === id || t.feeInstrumentId === id),
  ).reverse()
  const lastBuy = transactions.find((t) => t.type === 'buy' && t.instrumentId === id)
  // On the page of an asset that only paid a fee, the row is that payment, and the tax of the trade is not its own.
  const feeOnly = (t: Transaction) => t.instrumentId !== id && t.toInstrumentId !== id
  const fees = sumBy(
    transactions.filter((t) => !issues.has(t.id)),
    (t) => (feeOnly(t) ? D(t.fees) : feesQuote(t)).times(D(t.fxRate)),
  )
  // Held in one currency, the price is the one the valuation used, already in that currency. Held in several, it is
  // the instrument's own.
  const ownPrice = instrument?.lastPrice ? D(instrument.lastPrice) : null
  const lastPrice = stats?.currency === null ? ownPrice : (valuations.find((v) => v.position.instrumentId === id)?.lastPrice ?? null)
  const priceCurrency = stats?.currency ?? instrument?.currency ?? ''
  const todayRate = stats?.currency && rates[stats.currency] ? D(rates[stats.currency].rate) : null
  const route = stats ? assetRoute(stats, lastPrice, todayRate, base, instrument) : []

  return (
    <>
      {back}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-nowrap items-center gap-3">
            <MarketPill market={instrument?.market ?? marketOf(id)} assetType={instrument?.assetType} />
            <h1 className="shrink-0 text-[26px] font-semibold leading-tight md:text-[34px]">{symbol}</h1>
            {instrument && instrument.name !== instrument.symbol && (
              <span className="max-w-64 truncate text-muted-foreground max-lg:hidden">{instrument.name}</span>
            )}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {lastBuy && (
              <Link
                to={`/transactions/new?from=${lastBuy.id}`}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'max-[360px]:w-11 max-[360px]:px-0')}
              >
                <Copy aria-hidden />
                <span className="max-[360px]:sr-only">{t('ทำซ้ำรายการซื้อ')}</span>
              </Link>
            )}
            {instrument && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="aria-expanded:bg-muted max-md:w-11 max-md:px-0"
                aria-expanded={renamingId === id}
                onClick={() => setRenamingId(renamingId === id ? undefined : id)}
              >
                <Pencil aria-hidden />
                <span className="max-md:sr-only">{t('เปลี่ยนชื่อ/สัญลักษณ์')}</span>
              </Button>
            )}
          </div>
        </div>
        {instrument?.previousSymbols && instrument.previousSymbols.length > 0 && (
          <p className="mt-1 text-[12.5px] text-muted-foreground">{t('เดิม: ')}{instrument.previousSymbols.join(', ')}</p>
        )}
      </div>

      {instrument && renamingId === id && <RenameInstrument instrument={instrument} onClose={() => setRenamingId(undefined)} />}

      {stats && (
        <SummaryPanel
          label={
            stats.quantity.isZero()
              ? t('ขายหมดแล้ว')
              : t('มูลค่าวันนี้ · {0} {1} × {2} {3}', fmtNumber(stats.quantity, 8), unitLabel(instrument), fmtPrice(lastPrice), priceCurrency)
          }
          value={fmtHeadline(stats.valueBase, base)}
          footer={
            route.length > 0 && (
              <>
                <h2 className="mb-4 text-lg font-semibold">{t('เส้นทางเงินของ ')}{symbol}</h2>
                <MoneyRoute label={t('เส้นทางเงินของ {0}', symbol)} stations={route} />
                <p className="mt-[18px] flex flex-wrap gap-2">
                  <Badge variant={badgeOf(stats.priceEffectBase)}>{t('จากหุ้น ')}{fmtSigned(stats.priceEffectBase, 0)}</Badge>
                  {stats.currency !== base && <Badge variant="auto">{t('จากค่าเงิน ')}{fmtSigned(stats.fxEffectBase, 0)}</Badge>}
                  <Badge>{t('ปันผล ')}{fmtSigned(stats.incomeBase, 0)}</Badge>
                </p>
              </>
            )
          }
        >
          <Stat
            label={t('ผลตอบแทนรวม')}
            value={fmtSigned(stats.totalReturnBase, 0)}
            tone={plClass(stats.totalReturnBase)}
            note={stats.totalReturnPct ? t('{0} รวมปันผล', fmtSignedPct(stats.totalReturnPct)) : undefined}
          />
          <Stat
            label={t('ปันผลรับแล้ว')}
            value={fmtHeadline(stats.incomeBase, base)}
            note={t('ปันผล/ทุน {0}', fmtYield(stats.yieldOnCostPct))}
          />
          <Stat
            label={t('ทุนเฉลี่ย')}
            value={stats.quantity.isZero() || stats.currency === null ? '—' : fmtPrice(stats.costQuote.div(stats.quantity))}
            note={stats.currency === null ? t('ถือหลายสกุลเงิน') : t('{0} ต่อหน่วย', stats.currency)}
          />
        </SummaryPanel>
      )}

      <div className="grid items-start gap-3.5 md:gap-[22px] xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{t('ทุกรายการของ ')}{symbol}</h2>
            <Badge>{t('ทั้งหมด ')}{transactions.length} {t(' รายการ')}</Badge>
          </div>
          {isDesktop ? (
            <Table>
              <thead>
                <tr>
                  <Th>{t('วันที่')}</Th>
                  <Th>{t('ประเภท')}</Th>
                  <Th>{t('รายละเอียด')}</Th>
                  <Th>{t('เรท')}</Th>
                  <Th className="text-right">{t('สุทธิ (')}{base})</Th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const issue = issues.get(tx.id)
                  const feeRow = feeOnly(tx)
                  const net = feeRow ? feePaidNet(tx, issue !== undefined) : netOf(tx, issue !== undefined)
                  return (
                    <tr key={tx.id} className={cn(issue && 'bg-warning-bg [&>td]:border-transparent')}>
                      <Td>
                        <Link to={`/transactions/${tx.id}`} className="hover:underline">
                          {fmtDate(tx.date)}
                        </Link>
                      </Td>
                      <Td>{feeRow ? FEE_PAID_ROW_LABEL : TX_TYPE_LABELS[tx.type]}</Td>
                      <Td className="max-w-64 truncate">
                        {feeRow ? describeFeePaid(tx) : describeAmount(tx, accountNames, instruments)}
                        {tx.note && <span className="text-muted-foreground"> · {tx.note}</span>}
                        {!feeRow && <JournalLine journal={tx.journal} />}
                      </Td>
                      <Td>{feeFreeTransfer(tx) ? <span className="text-muted-foreground">—</span> : <RateCell tx={tx} />}</Td>
                      <Td className={cn('text-right font-display font-semibold', net.className)}>{net.text}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          ) : (
            <ul aria-label={t('ทุกรายการของ {0}', symbol)}>
              {transactions.map((tx) => {
                const feeRow = feeOnly(tx)
                const net = feeRow ? feePaidNet(tx, issues.has(tx.id)) : netOf(tx, issues.has(tx.id))
                return (
                  <li key={tx.id} className="border-t border-muted first:border-t-0">
                    <Link to={`/transactions/${tx.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 py-3">
                      <span>{fmtDate(tx.date)}</span>
                      <span className={cn('font-display font-semibold', net.className)}>{net.text}</span>
                      <span className="col-span-2 text-[12.5px] text-muted-foreground">
                        {feeRow ? `${FEE_PAID_ROW_LABEL} ${describeFeePaid(tx)}` : `${TX_TYPE_LABELS[tx.type]} ${describeAmount(tx, accountNames, instruments)}`}
                        {tx.fxSource !== 'same' && !feeFreeTransfer(tx) && ` · ${tx.fxSource === 'estimated' ? t('เรทประมาณ') : t('เรท')} ${fmtPrice(tx.fxRate)}`}
                      </span>
                      {!feeRow && <JournalLine journal={tx.journal} className="col-span-2" />}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <div className="grid content-start gap-4">
          {instrument && <PriceHistoryCard transactions={data.transactions} instrument={instrument} />}
          {instrument && (
            <LotsCard transactions={data.transactions} instrument={instrument} accounts={data.accounts} averageRealized={stats?.realizedBase ?? null} />
          )}
          {instrument && <ThesisCard key={instrument.id} instrument={instrument} today={today} />}
          {stats && (
            <Card>
              <h2 className="mb-2 text-base font-semibold">{t('สรุป')}</h2>
              <dl className="grid text-sm">
                <div className="flex justify-between gap-3 py-2.5">
                  <dt className="text-muted-foreground">{t('กำไรที่ขายแล้ว')}</dt>
                  <dd className={plClass(stats.realizedBase)}>{fmtSigned(stats.realizedBase, 0)}</dd>
                </div>
                <div className="flex justify-between gap-3 border-t border-muted py-2.5">
                  <dt className="text-muted-foreground">{t('ปันผลรวม (หลังภาษี)')}</dt>
                  <dd className={plClass(stats.incomeBase)}>{fmtSigned(stats.incomeBase, 0)}</dd>
                </div>
                <div className="flex justify-between gap-3 border-t border-muted py-2.5">
                  <dt className="text-muted-foreground">{t('ค่าธรรมเนียมรวม')}</dt>
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

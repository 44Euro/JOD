import { Check } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import { Link } from 'react-router'
import { Alert } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { buttonVariants } from '../../components/ui/button-variants'
import { Card } from '../../components/ui/card'
import { Segmented } from '../../components/ui/segmented'
import { Table, Td, Th } from '../../components/ui/table'
import { daysBetween, todayLocal } from '../../domain/dates'
import type { Ledger } from '../../domain/ledger'
import { RealizedHistoryCard } from '../components/HistoryCards'
import { PositionSizeCard, RiskSummaryCard } from '../components/RiskCards'
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
import { currencyMark, fmtDate, fmtMonth, fmtNumber, fmtPct, fmtRatio, fmtSigned, plClass } from '../format'
import { useAppData, useLedger, type AppData } from '../hooks'
import { EMOTION_LABELS, MISTAKE_LABELS, TRADE_PERIOD_LABELS, marketOf } from '../labels'
import { useIsDesktop } from '../useIsDesktop'
import { t } from '../../i18n'

const PERIODS = (['month', 'year', 'all'] as const).map((value) => ({ value, label: TRADE_PERIOD_LABELS[value] }))

const RECENT_COUNT = 10

// A tile is about 112px wide at 768px, which holds +7,171,435 at 20px. 28px only fits from about 881px, so lg is the safe
// step. All five tiles share the size.
const TILE_VALUE = 'md:text-[20px] lg:text-[28px]'

// The sidebar takes 240px from 768px up, which leaves a table card about 440px, too narrow for these tables.
const TABLE_MIN_WIDTH = 1024

type GroupBy = 'strategy' | 'emotion' | 'month'

function groupName(by: GroupBy, key: string): string {
  if (key === '') return t('ไม่ระบุ')
  if (by === 'emotion') return EMOTION_LABELS[key as Emotion]
  return by === 'month' ? fmtMonth(key, true) : key
}

function observationText({ by, group }: Observation): string {
  const subject = by === 'emotion' ? t('เทรดตอน {0}', groupName(by, group.key)) : t('กลยุทธ์ {0}', group.key)
  const noStop = group.noStopCount > 0 ? t(' · {0} ใน {1} ครั้งไม่ได้ตั้ง Stop loss', group.noStopCount, group.count) : ''
  return t('{0} ชนะแค่ {1} และขาดทุนรวม {2}{3}', subject, fmtPct(group.winRatePct, 0), fmtSigned(group.totalBase, 0), noStop)
}

// Each part stays whole and the dot stays with the part before it, so a line can end on a dot but never start with one.
function Dotted({ parts }: { parts: readonly string[] }) {
  return parts.map((part, i) => (
    <Fragment key={part}>
      {i > 0 && ' '}
      <span className="whitespace-nowrap">{i < parts.length - 1 ? `${part} ·` : part}</span>
    </Fragment>
  ))
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
  mark,
  isDesktop,
  className,
}: {
  title: string
  head: string
  by: GroupBy
  groups: readonly TradeGroup[]
  mark: string
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
              <Th className="text-right">{t('เทรด')}</Th>
              <Th className="text-right">{t('ชนะ')}</Th>
              <Th className="text-right">{t('รวม (')}{mark})</Th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.key}>
                <Td className="max-w-56 truncate font-semibold" title={groupName(by, group.key)}>
                  {groupName(by, group.key)}
                </Td>
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
              <b className="min-w-0 truncate font-display text-base font-semibold" title={groupName(by, group.key)}>
                {groupName(by, group.key)}
              </b>
              <span className={cn('font-display font-semibold', plClass(group.totalBase))}>{fmtSigned(group.totalBase, 0)}</span>
              <span className="col-span-2 text-[12.5px] text-muted-foreground">
                {t('{0} เทรด · ชนะ {1}', group.count, fmtPct(group.winRatePct, 0))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

const pressedBadge = 'bg-warning-fg text-warning-bg'
const focusRing = 'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35'
// In the list layout the button is the 44px target and the badge inside is what the eye sees, as in the mock. The negative
// margin lets the target use the row's padding so the second line stays as tall as its text.
const listTarget = 'min-h-11 min-w-11 justify-end -my-3'

function ReviewButton({
  ref,
  symbol,
  closed,
  reviewed,
  open,
  list,
  onClick,
}: {
  ref: Ref<HTMLButtonElement>
  symbol: string
  closed: string
  reviewed: boolean
  open: boolean
  list: boolean
  onClick(): void
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={t('{0} {1} ปิด {2}', reviewed ? t('แก้รีวิว') : t('รีวิว'), symbol, closed)}
      aria-expanded={open}
      onClick={onClick}
      className={cn('inline-flex items-center justify-center rounded-lg', focusRing, list && listTarget)}
    >
      {reviewed ? (
        <Badge variant="ok" className={open ? 'bg-gain-ink text-gain-soft' : undefined}>
          <Check aria-hidden />
          {t('รีวิวแล้ว')}
        </Badge>
      ) : (
        <Badge variant="warning" className={open ? pressedBadge : undefined}>
          {t('รีวิว')}
        </Badge>
      )}
    </button>
  )
}

function UnreviewedToggle({
  ref,
  count,
  pressed,
  list,
  onClick,
}: {
  ref: Ref<HTMLButtonElement>
  count: number
  pressed: boolean
  list: boolean
  onClick(): void
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn('inline-flex items-center justify-center rounded-lg', focusRing, list && 'min-h-11 min-w-11')}
    >
      <Badge variant="warning" className={pressed ? pressedBadge : undefined}>
        {t('ยังไม่ได้รีวิว {0}', count)}
      </Badge>
    </button>
  )
}

export function TradesPage() {
  const data = useAppData()
  const ledger = useLedger(data)
  if (!data || !ledger) return <p className="text-muted-foreground">{t('กำลังโหลด…')}</p>
  return <TradesView data={data} ledger={ledger} />
}

function TradesView({ data, ledger }: { data: AppData; ledger: Ledger }) {
  const isDesktop = useIsDesktop(TABLE_MIN_WIDTH)
  const [period, setPeriod] = useState<TradePeriod>('year')
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false)
  const reviewButtons = useRef(new Map<string, HTMLButtonElement>())
  const toggle = useRef<HTMLButtonElement>(null)
  const recentHeading = useRef<HTMLHeadingElement>(null)
  // Set before a review is written from the list of trades still to review, where the saved row may be about to leave it.
  // The data it holds is the data from before the write, so any data that differs from it has the write in it.
  const afterSave = useRef<{ savedId: string; nextId: string | undefined; data: AppData; moved: boolean } | null>(null)
  const trades = useMemo(() => matchTrades(data.transactions, ledger), [data, ledger])

  const today = todayLocal()
  const mark = currencyMark(data.settings.baseCurrency)
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
  const newestFirst = [...closed].sort((a, b) => (b.closeDate ?? '').localeCompare(a.closeDate ?? ''))
  const unreviewed = newestFirst.filter((trade) => !trade.reviewed && closingSell(trade) !== undefined)
  // Once the last one is reviewed there is nothing left to filter to, so the list falls back to the latest trades and
  // the filter is switched off, or it would come back by itself the next time a trade is left unreviewed.
  const showUnreviewed = onlyUnreviewed && unreviewed.length > 0
  if (onlyUnreviewed && unreviewed.length === 0) setOnlyUnreviewed(false)
  const recent = showUnreviewed ? unreviewed : newestFirst.slice(0, RECENT_COUNT)
  const recentTitle = showUnreviewed ? t('ยังไม่ได้รีวิว') : t('เทรดที่ปิดล่าสุด')

  // The write reaches the page as new data, before or after the save call returns. A saved row that has left the list of
  // trades still to review takes the focus with it, so the focus goes to the next row, else the toggle, else the heading of
  // the card, which is always there. A row that is still to review keeps it, and the save call gives it back to the row.
  useEffect(() => {
    const saved = afterSave.current
    if (!saved || saved.moved || saved.data === data) return
    if (unreviewed.some((trade) => trade.id === saved.savedId)) {
      afterSave.current = null
      return
    }
    saved.moved = true
    const next = saved.nextId ? reviewButtons.current.get(saved.nextId) : undefined
    const target = next ?? toggle.current ?? recentHeading.current
    target?.focus()
  })

  const header = (
    <PageHeader title={t('เทรด')}>
      <Segmented
        label={t('ช่วงเวลา')}
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
            <p className="font-semibold">{t('ยังไม่มีเทรด')}</p>
            <p className="text-muted-foreground">{t('บันทึกการซื้อและขายแล้วสถิติจะขึ้นที่นี่')}</p>
          </div>
          <Link to="/transactions/new" className={buttonVariants({ size: 'sm' })}>
            {t('บันทึกรายการ')}
          </Link>
        </Card>
      </>
    )
  }

  const days = (value: number | null) => (value === null ? '—' : t('{0} วัน', value))
  const extremes = [
    stats.maxLossStreak > 0 && t('แพ้ติดกันมากสุด {0} ครั้ง', stats.maxLossStreak),
    stats.best?.realizedBase.greaterThan(0) && t('เทรดดีสุด {0} ({1})', fmtSigned(stats.best.realizedBase, 0), symbolOf(stats.best.instrumentId)),
    stats.worst?.realizedBase.lessThanOrEqualTo(0) && t('แย่สุด {0} ({1})', fmtSigned(stats.worst.realizedBase, 0), symbolOf(stats.worst.instrumentId)),
  ].filter((part): part is string => typeof part === 'string')

  const toggleReview = (trade: Trade) => setReviewing((current) => (current === trade.id ? null : trade.id))
  // The form is gone by the time a keyboard user looks for their place, so focus goes back to the button that opened it.
  const closeReview = (trade: Trade) => {
    setReviewing(null)
    reviewButtons.current.get(trade.id)?.focus()
  }
  const startSaving = (trade: Trade) => {
    afterSave.current = showUnreviewed
      ? { savedId: trade.id, nextId: recent[recent.indexOf(trade) + 1]?.id, data, moved: false }
      : null
  }
  const failSaving = () => {
    afterSave.current = null
  }
  const finishSaving = (trade: Trade) => {
    // When the data came in first, the focus has already been put where it belongs and must not be taken back.
    if (afterSave.current?.moved) {
      afterSave.current = null
      setReviewing(null)
    } else {
      closeReview(trade)
    }
  }
  const reviewForm = (trade: Trade): ReactNode => {
    const sell = closingSell(trade)
    if (reviewing !== trade.id || !sell) return null
    return (
      <TradeReviewForm
        name={symbolOf(trade.instrumentId)}
        txId={sell.id}
        journal={sell.journal}
        onSaving={() => startSaving(trade)}
        onSaveFailed={failSaving}
        onSaved={() => finishSaving(trade)}
        onClose={() => closeReview(trade)}
      />
    )
  }
  const reviewButton = (trade: Trade): ReactNode =>
    closingSell(trade) ? (
      <ReviewButton
        ref={(button) => {
          if (button) reviewButtons.current.set(trade.id, button)
          else reviewButtons.current.delete(trade.id)
        }}
        symbol={symbolOf(trade.instrumentId)}
        closed={fmtDate(trade.closeDate ?? undefined)}
        reviewed={trade.reviewed}
        open={reviewing === trade.id}
        list={!isDesktop}
        onClick={() => toggleReview(trade)}
      />
    ) : null
  const assetOf = (trade: Trade) => <AssetLabel instrumentId={trade.instrumentId} instrument={instruments.get(trade.instrumentId)} />

  return (
    <>
      {header}

      <Card className="grid grid-cols-2 gap-2 max-md:[&>:first-child]:col-span-2 md:grid-cols-3 md:gap-x-6 md:gap-y-5 xl:grid-cols-5">
        <Stat label={t('เทรดที่ปิดแล้ว')} value={String(stats.closed)} valueClassName={TILE_VALUE} note={t('เปิดอยู่ {0}', open.length)} />
        <Stat label="Win rate" value={fmtPct(stats.winRatePct, 0)} valueClassName={TILE_VALUE} note={t('ชนะ {0} · แพ้ {1}', stats.wins, stats.losses)} />
        <Stat
          label="Profit factor"
          value={fmtRatio(stats.profitFactor)}
          valueClassName={TILE_VALUE}
          note={<Dotted parts={[t('ชนะเฉลี่ย {0}', fmtNumber(stats.avgWinBase, 0)), t('แพ้เฉลี่ย {0}', fmtNumber(stats.avgLossBase, 0))]} />}
        />
        <div className="max-md:hidden">
          <Stat
            label={t('ได้ต่อเทรด')}
            value={fmtSigned(stats.expectancyBase, 0)}
            tone={plClass(stats.expectancyBase)}
            valueClassName={TILE_VALUE}
            note={stats.closed > 0 ? t('รวม {0}', fmtSigned(stats.totalBase, 0)) : undefined}
          />
        </div>
        <div className="max-md:hidden">
          <Stat
            label={t('ถือเฉลี่ย')}
            value={days(stats.avgHoldDays)}
            valueClassName={TILE_VALUE}
            note={<Dotted parts={[t('ชนะ {0}', days(stats.avgHoldWinDays)), t('แพ้ {0}', days(stats.avgHoldLossDays))]} />}
          />
        </div>
      </Card>

      {warning && <Alert role="note">{observationText(warning)}</Alert>}

      {closed.length === 0 ? (
        <Card>
          <p className="text-muted-foreground">{t('ไม่มีเทรดที่ปิดในช่วงนี้')}</p>
        </Card>
      ) : (
        <>
          <div className="grid items-stretch gap-3.5 md:gap-[22px] xl:grid-cols-2">
            <GroupTable
              title={t('กลยุทธ์ไหนทำเงิน')}
              head={t('กลยุทธ์')}
              by="strategy"
              groups={groupTrades(closed, 'strategy')}
              mark={mark}
              isDesktop={isDesktop}
            />
            <GroupTable
              title={t('อารมณ์ตอนเข้า')}
              head={t('อารมณ์')}
              by="emotion"
              groups={groupTrades(closed, 'emotion')}
              mark={mark}
              isDesktop={isDesktop}
            />
            <GroupTable
              title={t('แยกตามเดือน')}
              head={t('เดือน')}
              by="month"
              groups={groupTrades(closed, 'month')}
              mark={mark}
              isDesktop={isDesktop}
              className="xl:col-span-2"
            />
          </div>

          <div className="grid items-start gap-3.5 md:gap-[22px] xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 ref={recentHeading} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
                  {recentTitle}
                </h2>
                {unreviewed.length > 0 && (
                  <UnreviewedToggle
                    ref={toggle}
                    count={unreviewed.length}
                    pressed={showUnreviewed}
                    list={!isDesktop}
                    onClick={() => setOnlyUnreviewed(!onlyUnreviewed)}
                  />
                )}
              </div>
              {isDesktop ? (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t('สินทรัพย์')}</Th>
                      <Th>{t('กลยุทธ์')}</Th>
                      <Th className="text-right">{t('ถือ')}</Th>
                      <Th className="text-right">{t('ผล (')}{mark})</Th>
                      <Th>
                        <span className="sr-only">{t('รีวิว')}</span>
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
                            <Td className="max-w-48 truncate" title={trade.strategy}>
                              {trade.strategy ?? '—'}
                            </Td>
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
                <ul aria-label={recentTitle}>
                  {recent.map((trade) => {
                    const form = reviewForm(trade)
                    return (
                      <li key={trade.id} className="border-t border-muted py-3 first:border-t-0">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1">
                          {assetOf(trade)}
                          <span className={cn('justify-self-end font-display font-semibold', plClass(trade.realizedBase))}>
                            {fmtSigned(trade.realizedBase, 0)}
                          </span>
                          <span className="flex min-w-0 gap-1 text-[12.5px] text-muted-foreground">
                            <span className="min-w-0 truncate" title={trade.strategy}>
                              {trade.strategy ?? '—'}
                            </span>
                            <span className="shrink-0 whitespace-nowrap">
                              {` · ${[days(trade.holdingDays), trade.emotion && EMOTION_LABELS[trade.emotion]].filter(Boolean).join(' · ')}`}
                            </span>
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
              <h2 className="mb-3 text-lg font-semibold">{t('ข้อผิดพลาดที่ทำบ่อย')}</h2>
              {mistakes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('ยังไม่มีข้อผิดพลาดที่บันทึกไว้')}</p>
              ) : (
                <ul aria-label={t('ข้อผิดพลาดที่ทำบ่อย')}>
                  {mistakes.map(({ mistake, count }) => (
                    <li key={mistake} className="flex items-center justify-between gap-3 border-t border-muted py-3 first:border-t-0">
                      <span>{MISTAKE_LABELS[mistake]}</span>
                      <span className="font-display font-semibold">{count} {t(' ครั้ง')}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2.5 text-[12.5px] text-muted-foreground">
                <Dotted parts={extremes} />
              </p>
            </Card>
          </div>
        </>
      )}

      {open.length > 0 && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold">{t('เทรดที่เปิดอยู่')}</h2>
          {isDesktop ? (
            <Table>
              <thead>
                <tr>
                  <Th>{t('สินทรัพย์')}</Th>
                  <Th>{t('เปิดเมื่อ')}</Th>
                  <Th>{t('กลยุทธ์')}</Th>
                  <Th className="text-right">{t('ถือมา')}</Th>
                </tr>
              </thead>
              <tbody>
                {open.map((trade) => (
                  <tr key={trade.id}>
                    <Td className="max-w-56">{assetOf(trade)}</Td>
                    <Td>{fmtDate(trade.openDate)}</Td>
                    <Td className="max-w-48 truncate" title={trade.strategy}>
                      {trade.strategy ?? '—'}
                    </Td>
                    <Td className="text-right">{days(daysBetween(trade.openDate, today))}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <ul aria-label={t('เทรดที่เปิดอยู่')}>
              {open.map((trade) => (
                <li
                  key={trade.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 border-t border-muted py-3 first:border-t-0"
                >
                  {assetOf(trade)}
                  <span className="text-[13px] text-muted-foreground">{t('ถือมา {0}', days(daysBetween(trade.openDate, today)))}</span>
                  <span className="col-span-2 truncate text-[12.5px] text-muted-foreground" title={trade.strategy}>
                    {t('เปิดเมื่อ {0}{1}', fmtDate(trade.openDate), trade.strategy ? ` · ${trade.strategy}` : '')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <RealizedHistoryCard events={ledger.realized} base={data.settings.baseCurrency} today={today} />
      <div className="grid items-start gap-3.5 md:gap-[22px] xl:grid-cols-2">
        <RiskSummaryCard closed={closed} transactions={transactions} />
        <PositionSizeCard base={data.settings.baseCurrency} />
      </div>
    </>
  )
}

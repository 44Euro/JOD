import { Plus } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Badge } from '../../components/ui/badge'
import { buttonVariants } from '../../components/ui/button-variants'
import { Card } from '../../components/ui/card'
import { Table, Td, Th } from '../../components/ui/table'
import { D, sumBy, type Decimal } from '../../domain/decimal'
import { cashFxRows, convertHistory, convertSummaries, fxWallet, remittancesByTaxYear, type CashFxRow, type ConvertRow } from '../../domain/fx'
import { SPREAD_WARNING_PCT } from '../../domain/fxConvert'
import { cn } from '../../lib/cn'
import { CashPill } from '../components/MarketPill'
import { PageHeader } from '../components/PageHeader'
import { RateBoard } from '../components/RateBoard'
import { currencyMark, fmtAmount, fmtDate, fmtHeadline, fmtNumber, fmtPct, fmtRate, fmtSigned, fmtSignedPct } from '../format'
import { useAppData, useInvestor } from '../hooks'
import { buildRateBoard } from '../rateBoard'
import { useIsDesktop } from '../useIsDesktop'
import { t } from '../../i18n'

const NEW_EXCHANGE = '/transactions/new?type=fx_convert'

// The sidebar takes 240px from 768px up, which leaves a table card about 440px, too narrow for these tables.
const TABLE_MIN_WIDTH = 1024

function shown(value: Decimal | null): value is Decimal {
  return value !== null && !value.toDecimalPlaces(0).isZero()
}

// A part that is nothing, or that has no figures behind it, is left out of the sentence. Thai has no spaces to glue the
// words of a part with, so each part is a no-wrap span and a line can only break between parts; inside a part the figure,
// the sign and the word after it are held by non-breaking spaces as well.
function effectCaption(asset: Decimal | null, cash: Decimal | null, mark: string): ReactNode {
  const parts = [
    shown(asset) && t('{0} {1} จากสินทรัพย์', fmtSigned(asset, 0), mark),
    shown(cash) && t('{0} {1} จากเงินสดที่ถืออยู่', fmtSigned(cash, 0), mark),
  ].filter((part): part is string => part !== false)
  if (parts.length === 0) return undefined
  const total = (asset ?? D(0)).plus(cash ?? D(0))
  return (
    <>
      <span className="whitespace-nowrap">{t('ค่าเงินทำให้พอร์ต{0}', total.isNegative() ? t('ลดลง') : t('เพิ่มขึ้น'))}</span>{' '}
      {parts.map((part, i) => (
        <Fragment key={part}>
          {i > 0 && t(' และ ')}
          <span className="whitespace-nowrap">{part}</span>
        </Fragment>
      ))}
    </>
  )
}

function sumOrNull(values: readonly (Decimal | null)[]): Decimal | null {
  const present = values.filter((value): value is Decimal => value !== null)
  return present.length > 0 ? sumBy(present, (value) => value) : null
}

function Section({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card role="region" aria-labelledby={id}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  )
}

function Line({ label, plain, children }: { label: string; plain?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-muted py-3 first:border-t-0">
      <dt className={plain ? undefined : 'text-muted-foreground'}>{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}

function SpreadBadge({ pct }: { pct: Decimal | null }) {
  if (!pct) return '—'
  return <Badge variant={pct.greaterThan(SPREAD_WARNING_PCT) ? 'warning' : 'auto'}>{fmtSignedPct(pct, 2)}</Badge>
}

function CashLabel({ currency, accountName }: { currency: string; accountName: string }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
      <CashPill label={currency} />
      <b className="min-w-0 whitespace-normal break-words line-clamp-2 font-display text-base font-semibold" title={accountName}>
        {accountName}
      </b>
    </span>
  )
}

function CashRows({
  rows,
  accountNames,
  mark,
  isDesktop,
}: {
  rows: readonly CashFxRow[]
  accountNames: ReadonlyMap<string, string>
  mark: string
  isDesktop: boolean
}) {
  const nameOf = (row: CashFxRow) => accountNames.get(row.accountId) ?? '—'
  if (isDesktop) {
    return (
      <Table>
        <thead>
          <tr>
            <Th>{t('บัญชี')}</Th>
            <Th className="text-right">{t('จำนวน')}</Th>
            <Th className="text-right">{t('ต้นทุน (')}{mark})</Th>
            <Th className="text-right">{t('มูลค่าวันนี้ (')}{mark})</Th>
            <Th className="text-right">{t('ผลค่าเงิน (')}{mark})</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.accountId}|${row.currency}`}>
              <Td>
                <CashLabel currency={row.currency} accountName={nameOf(row)} />
              </Td>
              <Td className="text-right">{`${fmtAmount(row.amount)} ${row.currency}`}</Td>
              <Td className="text-right">{fmtNumber(row.costBase, 0)}</Td>
              <Td className="text-right">{fmtNumber(row.valueBase, 0)}</Td>
              <Td className="text-right font-display font-semibold text-fx">{fmtSigned(row.effectBase, 0)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    )
  }
  return (
    <ul>
      {rows.map((row) => (
        <li
          key={`${row.accountId}|${row.currency}`}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 border-t border-muted py-3 first:border-t-0"
        >
          <CashLabel currency={row.currency} accountName={nameOf(row)} />
          <span className="font-display font-semibold text-fx">{fmtSigned(row.effectBase, 0)}</span>
          <span className="col-span-2 text-[12.5px] text-muted-foreground">
            {t('{0} {1} · ต้นทุน {2} · วันนี้ {3}', fmtAmount(row.amount), row.currency, fmtNumber(row.costBase, 0), fmtNumber(row.valueBase, 0))}
          </span>
        </li>
      ))}
    </ul>
  )
}

function HistoryRows({ rows, base, isDesktop }: { rows: readonly ConvertRow[]; base: string; isDesktop: boolean }) {
  if (isDesktop) {
    return (
      <Table>
        <thead>
          <tr>
            <Th>{t('วันที่')}</Th>
            <Th>{t('จาก → เป็น')}</Th>
            <Th className="text-right">{t('เรทที่ได้')}</Th>
            <Th className="text-right">{t('เรทตลาด')}</Th>
            <Th className="text-right">{t('ส่วนต่าง')}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.txId}>
              <Td>{fmtDate(row.date)}</Td>
              <Td>{`${fmtAmount(row.amount)} ${row.from} → ${fmtAmount(row.toAmount)} ${row.to}`}</Td>
              <Td className="text-right font-display font-semibold">{fmtRate(row.effectiveRate)}</Td>
              <Td className="text-right">{fmtRate(row.marketRate)}</Td>
              <Td className="text-right">
                <SpreadBadge pct={row.spreadPct} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    )
  }
  return (
    <ul>
      {rows.map((row) => (
        <li
          key={row.txId}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 border-t border-muted py-3 first:border-t-0"
        >
          <span>{fmtDate(row.date)}</span>
          <span className="font-display font-semibold">{fmtRate(row.effectiveRate)}</span>
          <span className="col-span-2 text-[12.5px] text-muted-foreground">
            {`${fmtAmount(row.amount)}${row.from === base ? '' : ` ${row.from}`} → ${fmtAmount(row.toAmount)} ${row.to}`}
            {row.marketRate && t(' · ตลาด {0}', fmtRate(row.marketRate))}
            {row.spreadPct && (
              <>
                {' · '}
                {row.spreadPct.greaterThan(SPREAD_WARNING_PCT) ? <SpreadBadge pct={row.spreadPct} /> : fmtSignedPct(row.spreadPct, 2)}
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function FxPage() {
  const data = useAppData()
  const { ledger, valuations, rates, investor } = useInvestor(data)
  const isDesktop = useIsDesktop(TABLE_MIN_WIDTH)
  if (!data || !ledger || !investor) return <p className="text-muted-foreground">{t('กำลังโหลด…')}</p>

  const base = data.settings.baseCurrency
  const mark = currencyMark(base)
  const board = buildRateBoard(valuations, base, rates)
  const cashRows = cashFxRows(investor.worth.cash, ledger, base)
  const summaries = convertSummaries(data.transactions, ledger)
  const history = convertHistory(data.transactions, ledger)
  const remittances = remittancesByTaxYear(data.transactions, ledger)
  const accountNames = new Map(data.accounts.map((a) => [a.id, a.name]))
  const caption = effectCaption(
    sumOrNull(board.map((row) => row.effectBase)),
    sumOrNull(cashRows.map((row) => row.effectBase)),
    mark,
  )
  const ecbNote = Object.values(rates).find((info) => info.note.startsWith('ECB'))?.note
  const lostWord = base === 'THB' ? t('บาท') : base
  const exchangeLink = (
    <Link to={NEW_EXCHANGE} className={buttonVariants({ size: 'sm' })}>
      <Plus aria-hidden />
      
      {t('บันทึกการแลกเงิน')}
    </Link>
  )

  if (board.length + cashRows.length + summaries.length + history.length + remittances.length === 0) {
    return (
      <>
        <PageHeader title={t('ค่าเงิน')} />
        <Card className="grid justify-items-start gap-3">
          <div>
            <p className="font-semibold">{t('ยังไม่มีเงินหรือสินทรัพย์ต่างประเทศ')}</p>
            <p className="text-muted-foreground">{t('แลกเงินหรือซื้อสินทรัพย์ต่างประเทศแล้วผลของค่าเงินจะขึ้นที่นี่')}</p>
          </div>
          {exchangeLink}
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader title={t('ค่าเงิน')} note={ecbNote ? t('เรทกลาง {0}', ecbNote) : undefined} />

      {board.length > 0 && <RateBoard rows={board} base={base} caption={caption} full />}

      {cashRows.length > 0 && (
        <Section id="fx-cash-title" title={t('เงินสดต่างประเทศ')}>
          {board.length === 0 && caption && <p className="mb-3 text-[13px] text-muted-foreground">{caption}</p>}
          <p className="mb-3 text-[13px] text-muted-foreground">{t('เฉพาะเงินสดที่ยังถืออยู่ · ไม่รวมส่วนที่ใช้ไปแล้ว')}</p>
          <div role="group" aria-label={t('เงินแต่ละสกุล')} className="mb-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {fxWallet(cashRows).map((w) => (
              <div key={w.currency} className="grid gap-0.5 rounded-xl border bg-background px-4 py-3">
                <span className="flex items-baseline justify-between gap-2">
                  <b className="font-display text-lg">{`${fmtAmount(w.amount)} ${w.currency}`}</b>
                  <span className="font-display font-semibold text-fx">{fmtSigned(w.effectBase, 0)}</span>
                </span>
                <span className="text-[13px] text-muted-foreground tabular-nums">
                  
                  {t('เรทเฉลี่ยที่ได้มา ')}{fmtRate(w.avgRate)} {t(' → วันนี้ ')}{fmtRate(w.todayRate)}
                </span>
              </div>
            ))}
          </div>
          <CashRows rows={cashRows} accountNames={accountNames} mark={mark} isDesktop={isDesktop} />
        </Section>
      )}

      {(summaries.length > 0 || remittances.length > 0) && (
        <div className="grid items-start gap-3.5 md:gap-[22px] xl:grid-cols-2">
          {summaries.length > 0 && (
            <Section id="fx-summary-title" title={t('สรุปการแลกเงิน')}>
              <div className="[&>dl+dl]:mt-3 [&>dl+dl]:border-t [&>dl+dl]:border-muted">
                {summaries.map((pair) => {
                  const cheaper = pair.avgSpreadPct?.toDecimalPlaces(2).lessThan(0) === true
                  return (
                    <dl key={`${pair.from}|${pair.to}`}>
                      <Line label={`${pair.from} → ${pair.to}`}>
                        {t('{0} ครั้ง · {1} → {2}', pair.count, fmtAmount(pair.fromTotal), fmtAmount(pair.toTotal))}
                      </Line>
                      <Line label={t('เรทเฉลี่ยที่ได้')}>
                        <span className="font-display font-semibold">{fmtRate(pair.avgRate)}</span>
                      </Line>
                      <Line label={cheaper ? t('ถูกกว่าเรทกลางเฉลี่ย') : t('แพงกว่าเรทกลางเฉลี่ย')}>
                        <span className="font-display font-semibold text-fx">
                          {cheaper ? fmtPct(pair.avgSpreadPct?.abs(), 2, 2) : fmtSignedPct(pair.avgSpreadPct, 2)}
                        </span>
                      </Line>
                      <Line label={t('spread ที่เสียไปรวม')}>
                        <span className={cn('font-display font-semibold', pair.spreadLostBase?.greaterThan(0) && 'text-loss')}>
                          {pair.spreadLostBase ? `≈ ${fmtNumber(pair.spreadLostBase, 0)} ${lostWord}` : '—'}
                        </span>
                      </Line>
                    </dl>
                  )
                })}
              </div>
            </Section>
          )}
          {remittances.length > 0 && (
            <Section id="fx-remit-title" title={t('เงินโอนกลับเข้าไทย')}>
              <dl>
                {remittances.map((year) => (
                  <Line key={year.taxYear} label={t('ปีภาษี {0} ({1})', year.taxYear + 543, year.taxYear)} plain>
                    <span className="font-display font-semibold">{fmtHeadline(year.totalBase, base)}</span>{' '}
                    <span className="text-[12.5px] text-muted-foreground">{t('· {0} ครั้ง', year.count)}</span>
                  </Line>
                ))}
              </dl>
              <p className="mt-2.5 text-[12.5px] text-muted-foreground">
                
                {t('ใช้เตรียมข้อมูลเงินได้จากต่างประเทศที่นำเข้าไทย ไม่ใช่คำแนะนำภาษี')}
              </p>
            </Section>
          )}
        </div>
      )}

      <Section id="fx-history-title" title={t('ประวัติการแลกเงิน')} action={exchangeLink}>
        {history.length > 0 ? (
          <HistoryRows rows={history} base={base} isDesktop={isDesktop} />
        ) : (
          <p className="text-muted-foreground">{t('ยังไม่มีการแลกเงิน')}</p>
        )}
      </Section>
    </>
  )
}

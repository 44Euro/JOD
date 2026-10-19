import { Plus } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Badge } from '../../components/ui/badge'
import { buttonVariants } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Table, Td, Th } from '../../components/ui/table'
import { D, sumBy, type Decimal } from '../../domain/decimal'
import { cashFxRows, convertHistory, convertSummaries, remittancesByTaxYear, type CashFxRow, type ConvertRow } from '../../domain/fx'
import { cn } from '../../lib/cn'
import { CashPill } from '../components/MarketPill'
import { PageHeader } from '../components/PageHeader'
import { RateBoard } from '../components/RateBoard'
import { currencyMark, fmtAmount, fmtDate, fmtHeadline, fmtNumber, fmtRate, fmtSigned, fmtSignedPct } from '../format'
import { useAppData, useInvestor } from '../hooks'
import { buildRateBoard } from '../rateBoard'
import { useIsDesktop } from '../useIsDesktop'

const NEW_EXCHANGE = '/transactions/new?type=fx_convert'

// The sidebar takes 240px from 768px up, which leaves a table card about 440px, too narrow for these tables.
const TABLE_MIN_WIDTH = 1024

// An exchange that cost more than this over the mid rate gets the yellow badge.
const SPREAD_WARNING_PCT = 1

function shown(value: Decimal | null): value is Decimal {
  return value !== null && !value.toDecimalPlaces(0).isZero()
}

// A part that is nothing, or that has no figures behind it, is left out of the sentence. Thai has no spaces to glue the
// words of a part with, so each part is a no-wrap span and a line can only break between parts; inside a part the figure,
// the sign and the word after it are held by non-breaking spaces as well.
function effectCaption(asset: Decimal | null, cash: Decimal | null, mark: string): ReactNode {
  const parts = [
    shown(asset) && `${fmtSigned(asset, 0)}\u00A0${mark}\u00A0จากสินทรัพย์`,
    shown(cash) && `${fmtSigned(cash, 0)}\u00A0${mark}\u00A0จากเงินสดที่ถืออยู่`,
  ].filter((part): part is string => part !== false)
  if (parts.length === 0) return undefined
  const total = (asset ?? D(0)).plus(cash ?? D(0))
  return (
    <>
      <span className="whitespace-nowrap">{`ค่าเงินทำให้พอร์ต${total.isNegative() ? 'ลดลง' : 'เพิ่มขึ้น'}`}</span>{' '}
      {parts.map((part, i) => (
        <Fragment key={part}>
          {i > 0 && ' และ '}
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
            <Th>บัญชี</Th>
            <Th className="text-right">จำนวน</Th>
            <Th className="text-right">ต้นทุน ({mark})</Th>
            <Th className="text-right">มูลค่าวันนี้ ({mark})</Th>
            <Th className="text-right">ผลค่าเงิน ({mark})</Th>
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
            {`${fmtAmount(row.amount)} ${row.currency} · ต้นทุน ${fmtNumber(row.costBase, 0)} · วันนี้ ${fmtNumber(row.valueBase, 0)}`}
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
            <Th>วันที่</Th>
            <Th>จาก → เป็น</Th>
            <Th className="text-right">เรทที่ได้</Th>
            <Th className="text-right">เรทตลาด</Th>
            <Th className="text-right">ส่วนต่าง</Th>
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
            {row.marketRate && ` · ตลาด ${fmtRate(row.marketRate)}`}
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
  if (!data || !ledger || !investor) return <p className="text-muted-foreground">กำลังโหลด…</p>

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
  const lostWord = base === 'THB' ? 'บาท' : base
  const exchangeLink = (
    <Link to={NEW_EXCHANGE} className={buttonVariants({ size: 'sm' })}>
      <Plus aria-hidden />
      บันทึกการแลกเงิน
    </Link>
  )

  if (board.length + cashRows.length + summaries.length + history.length + remittances.length === 0) {
    return (
      <>
        <PageHeader title="ค่าเงิน" />
        <Card className="grid justify-items-start gap-3">
          <div>
            <p className="font-semibold">ยังไม่มีเงินหรือสินทรัพย์ต่างประเทศ</p>
            <p className="text-muted-foreground">แลกเงินหรือซื้อสินทรัพย์ต่างประเทศแล้วผลของค่าเงินจะขึ้นที่นี่</p>
          </div>
          {exchangeLink}
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader title="ค่าเงิน" note={ecbNote ? `เรทกลาง ${ecbNote}` : undefined} />

      {board.length > 0 && <RateBoard rows={board} base={base} caption={caption} full />}

      {cashRows.length > 0 && (
        <Section id="fx-cash-title" title="เงินสดต่างประเทศ">
          {board.length === 0 && caption && <p className="mb-3 text-[13px] text-muted-foreground">{caption}</p>}
          <CashRows rows={cashRows} accountNames={accountNames} mark={mark} isDesktop={isDesktop} />
        </Section>
      )}

      {(summaries.length > 0 || remittances.length > 0) && (
        <div className="grid items-start gap-3.5 md:gap-[22px] xl:grid-cols-2">
          {summaries.length > 0 && (
            <Section id="fx-summary-title" title="สรุปการแลกเงิน">
              {summaries.map((pair) => (
                <dl key={`${pair.from}|${pair.to}`} className="mt-3 border-t border-muted first:mt-0 first:border-t-0">
                  <Line label={`${pair.from} → ${pair.to}`}>
                    {`${pair.count} ครั้ง · ${fmtAmount(pair.fromTotal)} → ${fmtAmount(pair.toTotal)}`}
                  </Line>
                  <Line label="เรทเฉลี่ยที่ได้">
                    <span className="font-display font-semibold">{fmtRate(pair.avgRate)}</span>
                  </Line>
                  <Line label="แพงกว่าเรทกลางเฉลี่ย">
                    <span className="font-display font-semibold text-fx">{fmtSignedPct(pair.avgSpreadPct, 2)}</span>
                  </Line>
                  <Line label="spread ที่เสียไปรวม">
                    <span className={cn('font-display font-semibold', pair.spreadLostBase?.greaterThan(0) && 'text-loss')}>
                      {pair.spreadLostBase ? `≈ ${fmtNumber(pair.spreadLostBase, 0)} ${lostWord}` : '—'}
                    </span>
                  </Line>
                </dl>
              ))}
            </Section>
          )}
          {remittances.length > 0 && (
            <Section id="fx-remit-title" title="เงินโอนกลับเข้าไทย">
              <dl>
                {remittances.map((year) => (
                  <Line key={year.taxYear} label={`ปีภาษี ${year.taxYear + 543} (${year.taxYear})`} plain>
                    <span className="font-display font-semibold">{fmtHeadline(year.totalBase, base)}</span>{' '}
                    <span className="text-[12.5px] text-muted-foreground">{`· ${year.count} ครั้ง`}</span>
                  </Line>
                ))}
              </dl>
              <p className="mt-2.5 text-[12.5px] text-muted-foreground">
                ใช้เตรียมข้อมูลเงินได้จากต่างประเทศที่นำเข้าไทย ไม่ใช่คำแนะนำภาษี
              </p>
            </Section>
          )}
        </div>
      )}

      <Section id="fx-history-title" title="ประวัติการแลกเงิน" action={exchangeLink}>
        {history.length > 0 ? (
          <HistoryRows rows={history} base={base} isDesktop={isDesktop} />
        ) : (
          <p className="text-muted-foreground">ยังไม่มีการแลกเงิน</p>
        )}
      </Section>
    </>
  )
}

import { Download, Pencil, Plus, Search, Trash2, TriangleAlert } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Alert } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button, buttonVariants } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { chipSelectClass } from '../../components/ui/chip'
import { Input, NativeSelect } from '../../components/ui/input'
import { Table, Td, Th } from '../../components/ui/table'
import { transactionsToCsv } from '../../db/backup'
import { db } from '../../db/db'
import { deleteTransaction } from '../../db/repo'
import { todayLocal } from '../../domain/dates'
import { D } from '../../domain/decimal'
import { fxConvertSummary } from '../../domain/fxConvert'
import { acquisitionCostQuote, cashDeltaQuote, sortTransactions } from '../../domain/ledger'
import { MARKETS, TX_TYPES, type Instrument, type Transaction } from '../../domain/types'
import { cn } from '../../lib/cn'
import { CashPill, MarketPill } from '../components/MarketPill'
import { PageHeader } from '../components/PageHeader'
import { downloadText } from '../download'
import { fmtDate, fmtDay, fmtNumber, fmtPrice, fmtSigned, fmtValue, plClass } from '../format'
import { useAppData, useLedger } from '../hooks'
import { FX_SOURCE_LABELS, MARKET_LABELS, TX_TYPE_LABELS, marketOf } from '../labels'
import { useIsDesktop } from '../useIsDesktop'

function describeAmount(tx: Transaction): string {
  switch (tx.type) {
    case 'buy':
    case 'sell':
      return `${fmtNumber(tx.quantity, 8)} × ${fmtPrice(tx.price)}`
    case 'opening':
      return tx.instrumentId ? `${fmtNumber(tx.quantity, 8)} × ${fmtPrice(tx.price)}` : fmtNumber(tx.amount)
    case 'split':
      return `× ${fmtNumber(tx.splitRatio, 4)}`
    case 'fx_convert':
      return `${fmtNumber(tx.amount)} ${tx.currency} → ${fmtNumber(tx.toAmount)} ${tx.toCurrency ?? ''}`
    default:
      return fmtNumber(tx.amount)
  }
}

function AssetLabel({ tx, instrument, accountName }: { tx: Transaction; instrument?: Instrument; accountName: string }) {
  if (!tx.instrumentId) {
    return (
      <span className="flex min-w-0 items-center gap-2.5">
        <CashPill label={tx.type === 'fx_convert' ? `${tx.currency}→${tx.toCurrency ?? ''}` : tx.currency} />
        <b className="truncate font-display text-base font-semibold">{accountName}</b>
      </span>
    )
  }
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <MarketPill market={instrument?.market ?? marketOf(tx.instrumentId)} assetType={instrument?.assetType} />
      <b className="font-display text-base font-semibold">{instrument?.symbol ?? tx.instrumentId.split(':')[1]}</b>
      <span className="truncate text-[12.5px] text-muted-foreground">{accountName}</span>
    </span>
  )
}

function RateCell({ tx }: { tx: Transaction }) {
  if (tx.type === 'fx_convert') {
    const { effectiveRate, spreadPct } = fxConvertSummary(tx)
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {fmtPrice(effectiveRate)}
        {spreadPct && !spreadPct.isZero() && (
          <Badge variant={spreadPct.abs().greaterThanOrEqualTo(1) ? 'warning' : 'default'}>
            {spreadPct.greaterThan(0) ? 'แพงกว่า' : 'ถูกกว่า'}ตลาด {fmtNumber(spreadPct.abs())}%
          </Badge>
        )}
      </span>
    )
  }
  if (tx.fxSource === 'same') return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      {fmtPrice(tx.fxRate)}
      <Badge variant={tx.fxSource}>{FX_SOURCE_LABELS[tx.fxSource]}</Badge>
    </span>
  )
}

// A transaction the ledger skipped moves no cash, so showing its amount would mislead. An opening holding was
// paid for before the app existed, so its row shows what it cost instead; a split moves nothing at all.
function netOf(tx: Transaction, skipped: boolean): { text: string; className: string } {
  if (skipped || tx.type === 'split') return { text: '—', className: 'text-muted-foreground' }
  if (tx.type === 'opening' && tx.instrumentId) {
    return { text: `ทุน ${fmtValue(acquisitionCostQuote(tx).times(D(tx.fxRate)))}`, className: 'text-muted-foreground' }
  }
  const net = cashDeltaQuote(tx).times(D(tx.fxRate))
  return { text: fmtSigned(net), className: plClass(net) }
}

export function TransactionsPage() {
  const data = useAppData()
  const ledger = useLedger(data)
  const isDesktop = useIsDesktop()
  const [accountId, setAccountId] = useState('')
  const [type, setType] = useState('')
  const [market, setMarket] = useState('')
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    if (!data) return []
    const q = query.trim().toUpperCase()
    return sortTransactions(data.transactions)
      .reverse()
      .filter(
        (tx) =>
          (!accountId || tx.accountId === accountId) &&
          (!type || tx.type === type) &&
          (!market || (tx.instrumentId !== undefined && marketOf(tx.instrumentId) === market)) &&
          (!q || (tx.instrumentId ?? '').includes(q) || tx.note.toUpperCase().includes(q)),
      )
  }, [data, accountId, type, market, query])

  if (!data || !ledger) return <p className="text-muted-foreground">กำลังโหลด…</p>
  const base = data.settings.baseCurrency
  const accountNames = new Map(data.accounts.map((a) => [a.id, a.name]))
  const instruments = new Map(data.instruments.map((i) => [i.id, i]))
  const issues = new Map(ledger.issues.map((i) => [i.txId, i.message]))

  async function handleDelete(tx: Transaction) {
    if (!window.confirm(`ลบรายการ${TX_TYPE_LABELS[tx.type]} วันที่ ${fmtDate(tx.date)}?`)) return
    await deleteTransaction(db, tx.id)
  }

  const label = (tx: Transaction) => `${TX_TYPE_LABELS[tx.type]} ${tx.date}`
  const assetOf = (tx: Transaction) => (
    <AssetLabel
      tx={tx}
      instrument={tx.instrumentId ? instruments.get(tx.instrumentId) : undefined}
      accountName={accountNames.get(tx.accountId) ?? '—'}
    />
  )

  return (
    <>
      <PageHeader title="รายการทั้งหมด">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rows.length === 0}
          onClick={() =>
            downloadText(`jod-transactions-${todayLocal()}.csv`, transactionsToCsv(rows, data.accounts, base), 'text/csv;charset=utf-8')
          }
        >
          <Download aria-hidden />
          ส่งออก CSV
        </Button>
        <Link to="/transactions/new" className={cn(buttonVariants({ size: 'sm' }), 'max-md:hidden')}>
          <Plus aria-hidden />
          บันทึกรายการ
        </Link>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-placeholder" aria-hidden />
          <Input
            aria-label="ค้นหา"
            placeholder="ค้นหาสัญลักษณ์ หรือหมายเหตุ"
            className="h-11 pl-10 md:h-[42px]"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <NativeSelect aria-label="กรองตามบัญชี" className={chipSelectClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">ทุกบัญชี</option>
          {data.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="กรองตามประเภท" className={chipSelectClass} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">ทุกประเภท</option>
          {TX_TYPES.map((t) => (
            <option key={t} value={t}>
              {TX_TYPE_LABELS[t]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="กรองตามตลาด" className={chipSelectClass} value={market} onChange={(e) => setMarket(e.target.value)}>
          <option value="">ทุกตลาด</option>
          {MARKETS.map((m) => (
            <option key={m} value={m}>
              {MARKET_LABELS[m]}
            </option>
          ))}
        </NativeSelect>
      </div>

      {ledger.issues.length > 0 && (
        <Alert>
          มี {ledger.issues.length} รายการที่คำนวณไม่ได้ (แถวสีเหลือง) มักเกิดจากขายเกินจำนวนที่ถือ หรือแก้/ลบรายการซื้อก่อนหน้า
        </Alert>
      )}

      {rows.length === 0 ? (
        <Card>
          <p className="text-muted-foreground">
            {data.transactions.length === 0 ? 'ยังไม่มีรายการ เริ่มจากปุ่มบันทึกรายการ' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
          </p>
        </Card>
      ) : isDesktop ? (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>เวลา</Th>
                <Th>ประเภท</Th>
                <Th>สินทรัพย์</Th>
                <Th>จำนวน / ยอด</Th>
                <Th>เรท</Th>
                <Th className="text-right">สุทธิ ({base})</Th>
                <Th>
                  <span className="sr-only">จัดการ</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tx, index) => {
                const issue = issues.get(tx.id)
                const net = netOf(tx, issue !== undefined)
                const newDay = index === 0 || rows[index - 1].date !== tx.date
                return (
                  <Fragment key={tx.id}>
                    {newDay && (
                      <tr>
                        <th colSpan={7} scope="colgroup" className="px-2 pt-4 pb-1 text-left text-[12.5px] font-semibold text-muted-foreground">
                          {fmtDay(tx.date)}
                        </th>
                      </tr>
                    )}
                    <tr className={cn(issue && 'bg-warning-bg [&>td]:border-transparent')}>
                      <Td className="text-muted-foreground">{tx.time ?? '—'}</Td>
                      <Td>{TX_TYPE_LABELS[tx.type]}</Td>
                      <Td className="max-w-72">
                        <span className="flex items-center gap-2">
                          {assetOf(tx)}
                          {issue && (
                            <Badge variant="warning">
                              <TriangleAlert aria-hidden />
                              ไม่นับในพอร์ต
                            </Badge>
                          )}
                        </span>
                      </Td>
                      <Td>
                        {describeAmount(tx)}
                        {tx.type !== 'fx_convert' && <span className="text-muted-foreground"> {tx.currency}</span>}
                      </Td>
                      <Td>
                        <RateCell tx={tx} />
                      </Td>
                      <Td className={cn('text-right font-display font-semibold', net.className)}>{net.text}</Td>
                      <Td className="text-right">
                        <span className="inline-flex items-center gap-1">
                          <Link
                            to={`/transactions/${tx.id}`}
                            aria-label={`แก้ไขรายการ ${label(tx)}`}
                            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
                          >
                            <Pencil aria-hidden />
                          </Link>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`ลบรายการ ${label(tx)}`}
                            onClick={() => void handleDelete(tx)}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </span>
                      </Td>
                    </tr>
                    {issue && (
                      <tr className="bg-warning-bg">
                        <td colSpan={7} className="px-2 pb-3 text-[12.5px] text-warning-fg">
                          <span>{issue}</span> · แก้รายการนี้ หรือรายการก่อนหน้าที่เกี่ยวข้อง แล้วตัวเลขพอร์ตจะกลับมาครบ
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </Table>
        </Card>
      ) : (
        <Card className="py-2">
          <ul aria-label="รายการทั้งหมด">
            {rows.map((tx, index) => {
              const issue = issues.get(tx.id)
              const net = netOf(tx, issue !== undefined)
              const newDay = index === 0 || rows[index - 1].date !== tx.date
              return (
                <Fragment key={tx.id}>
                  {newDay && <li className="pt-4 pb-1 text-[12.5px] font-semibold text-muted-foreground">{fmtDay(tx.date)}</li>}
                  <li className={cn('border-t border-muted', issue && 'rounded-xl border-transparent bg-warning-bg px-2.5')}>
                    <Link to={`/transactions/${tx.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 py-3">
                      <span className="flex min-w-0 items-center gap-2">
                        {assetOf(tx)}
                        <span className="shrink-0 text-[13px] text-muted-foreground">{TX_TYPE_LABELS[tx.type]}</span>
                      </span>
                      <span className={cn('font-display font-semibold', net.className)}>{net.text}</span>
                      <span className="col-span-2 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-muted-foreground">
                        <span>
                          {describeAmount(tx)}
                          {tx.type !== 'fx_convert' && ` ${tx.currency}`}
                        </span>
                        {(tx.type === 'fx_convert' || tx.fxSource !== 'same') && (
                          <>
                            <span>· เรท</span>
                            <RateCell tx={tx} />
                          </>
                        )}
                      </span>
                      {issue && <span className="col-span-2 text-[12.5px] text-warning-fg">{issue}</span>}
                    </Link>
                  </li>
                </Fragment>
              )
            })}
          </ul>
        </Card>
      )}
    </>
  )
}

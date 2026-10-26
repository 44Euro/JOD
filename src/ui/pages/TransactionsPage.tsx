import { Download, Pencil, Plus, Search, Trash2, TriangleAlert, Undo2 } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Alert } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button, buttonVariants } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { chipSelectClass } from '../../components/ui/chip'
import { Input, NativeSelect } from '../../components/ui/input'
import { Table, Td, Th } from '../../components/ui/table'
import { transactionsToCsv } from '../../db/backup'
import { db } from '../../db/db'
import { todayLocal } from '../../domain/dates'
import { sortTransactions } from '../../domain/ledger'
import { MARKETS, TX_TYPES, type Instrument, type Transaction } from '../../domain/types'
import { cn } from '../../lib/cn'
import { CashPill, MarketPill } from '../components/MarketPill'
import { PageHeader } from '../components/PageHeader'
import { RateCell } from '../components/RateCell'
import { downloadText } from '../download'
import { fmtDay } from '../format'
import { useAppData, useLedger } from '../hooks'
import { MARKET_LABELS, TX_TYPE_LABELS, TX_TYPE_SHORT_LABELS, marketOf } from '../labels'
import { describeBody, describeMain, feeFreeTransfer, feeNote, feeNoteText, issueText, netOf, taxNoteText } from '../transactionText'
import { SEARCH_INPUT_ID } from '../shortcuts'
import { deleteWithUndo, settleRestored, undoDelete, usePendingDeletes } from '../undoDelete'
import { useIsDesktop } from '../useIsDesktop'
import { t } from '../../i18n'

// The phone row has no room for the account beside the symbol, so it puts the account on its second line instead, and
// a symbol that is still too long is cut with an ellipsis.
function AssetLabel({
  tx,
  instrument,
  accountName,
  withAccount = true,
  struck = false,
}: {
  tx: Transaction
  instrument?: Instrument
  accountName: string
  withAccount?: boolean
  struck?: boolean
}) {
  const strike = struck && 'line-through text-muted-foreground'
  if (!tx.instrumentId) {
    return (
      <span className="flex min-w-0 items-center gap-2.5 overflow-hidden">
        <CashPill label={tx.type === 'fx_convert' ? `${tx.currency}→${tx.toCurrency ?? ''}` : tx.currency} />
        <b className={cn('truncate font-display text-base font-semibold', strike)}>{accountName}</b>
      </span>
    )
  }
  const symbol = instrument?.symbol ?? tx.instrumentId.split(':')[1]
  return (
    <span className="flex min-w-0 items-center gap-2.5 overflow-hidden">
      <MarketPill market={instrument?.market ?? marketOf(tx.instrumentId)} assetType={instrument?.assetType} />
      <b
        className={cn('font-display text-base font-semibold', !withAccount && 'min-w-0 truncate', strike)}
        title={withAccount ? undefined : symbol}
      >
        {symbol}
      </b>
      {withAccount && <span className={cn('truncate text-[12.5px] text-muted-foreground', struck && 'line-through')}>{accountName}</span>}
    </span>
  )
}

// An exchange and a transfer of cash spell out their currency; a transfer of units or a swap shows units only,
// so the currency there belongs to the fee or the value.
function namesCurrency(tx: Transaction): boolean {
  return tx.type === 'fx_convert' || tx.type === 'transfer' || tx.type === 'swap'
}

function instrumentIds(tx: Transaction): string[] {
  return [tx.instrumentId, tx.toInstrumentId, tx.feeInstrumentId].filter((id): id is string => id !== undefined)
}

// The table needs about 890px; beside the 240px sidebar the card only has that from about 1280px wide.
const TABLE_MIN_WIDTH = 1280

function showsRate(tx: Transaction): boolean {
  return (tx.type === 'fx_convert' || tx.fxSource !== 'same') && !feeFreeTransfer(tx)
}

function UndoButton({ label, className, onUndo }: { label: string; className?: string; onUndo: () => void }) {
  return (
    <button
      type="button"
      aria-label={t('ย้อนกลับการลบ {0}', label)}
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-[13.5px] font-semibold text-primary-ink underline-offset-[3px] hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none [&_svg]:size-4',
        className,
      )}
      onClick={onUndo}
    >
      <Undo2 aria-hidden />
      
      {t('ย้อนกลับ')}
    </button>
  )
}

export function TransactionsPage() {
  const data = useAppData()
  const ledger = useLedger(data)
  const isDesktop = useIsDesktop(TABLE_MIN_WIDTH)
  const [accountId, setAccountId] = useState('')
  const [type, setType] = useState('')
  const [market, setMarket] = useState('')
  const [query, setQuery] = useState('')
  const [undoError, setUndoError] = useState('')
  const pending = usePendingDeletes()
  const focusSearch = (useLocation().state as { focusSearch?: boolean } | null)?.focusSearch === true

  const matches = useMemo(() => {
    const q = query.trim().toUpperCase()
    return (tx: Transaction) =>
      (!accountId || tx.accountId === accountId || tx.toAccountId === accountId) &&
      (!type || tx.type === type) &&
      (!market || instrumentIds(tx).some((id) => marketOf(id) === market)) &&
      (!q || instrumentIds(tx).some((id) => id.includes(q)) || tx.note.toUpperCase().includes(q))
  }, [accountId, type, market, query])

  const waiting = useMemo(() => pending.filter((p) => !p.restored), [pending])
  const pendingIds = useMemo(() => new Set(waiting.map((p) => p.tx.id)), [waiting])

  // The live query trails a delete or an undo by a moment. A row waiting for undo is taken out of the stored list by id
  // and shown from the pending store; a row just put back is shown from the store until the query returns it, so the
  // list never has a gap.
  const rows = useMemo(() => {
    if (!data) return []
    const stored = data.transactions.filter((tx) => !pendingIds.has(tx.id))
    const storedIds = new Set(stored.map((tx) => tx.id))
    const returning = pending.filter((p) => p.restored && !storedIds.has(p.tx.id)).map((p) => p.tx)
    return sortTransactions([...stored, ...returning]).reverse().filter(matches)
  }, [data, pending, pendingIds, matches])

  useEffect(() => {
    if (data) settleRestored(new Set(data.transactions.map((tx) => tx.id)))
  }, [data])

  const shown = useMemo(() => {
    const back = waiting.map((p) => p.tx).filter(matches)
    return back.length === 0 ? rows : sortTransactions([...rows, ...back]).reverse()
  }, [rows, waiting, matches])

  if (!data || !ledger) return <p className="text-muted-foreground">{t('กำลังโหลด…')}</p>
  const base = data.settings.baseCurrency
  const accountNames = new Map(data.accounts.map((a) => [a.id, a.name]))
  const instruments = new Map(data.instruments.map((i) => [i.id, i]))
  const issues = new Map(ledger.issues.map((i) => [i.txId, issueText(i)]))

  async function handleDelete(tx: Transaction) {
    setUndoError('')
    await deleteWithUndo(db, tx)
  }

  async function handleUndo(tx: Transaction) {
    setUndoError('')
    try {
      await undoDelete(db, tx.id)
    } catch (error) {
      setUndoError(error instanceof Error ? error.message : t('ย้อนกลับไม่สำเร็จ'))
    }
  }

  const label = (tx: Transaction) => `${TX_TYPE_LABELS[tx.type]} ${tx.date}`
  const assetOf = (tx: Transaction, withAccount = true, struck = false) => (
    <AssetLabel
      tx={tx}
      instrument={tx.instrumentId ? instruments.get(tx.instrumentId) : undefined}
      accountName={accountNames.get(tx.accountId) ?? '—'}
      withAccount={withAccount}
      struck={struck}
    />
  )

  return (
    <>
      <PageHeader title={t('รายการทั้งหมด')}>
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
          
          {t('ส่งออก CSV')}
        </Button>
        <Link to="/transactions/new" className={cn(buttonVariants({ size: 'sm' }), 'max-md:hidden')}>
          <Plus aria-hidden />
          
          {t('บันทึกรายการ')}
        </Link>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-placeholder" aria-hidden />
          <Input
            id={SEARCH_INPUT_ID}
            aria-keyshortcuts="/"
            autoFocus={focusSearch}
            aria-label={t('ค้นหา')}
            placeholder={t('ค้นหาสัญลักษณ์ หรือหมายเหตุ')}
            className="h-11 pl-10 md:h-[42px]"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <NativeSelect aria-label={t('กรองตามบัญชี')} className={chipSelectClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">{t('ทุกบัญชี')}</option>
          {data.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={t('กรองตามประเภท')} className={chipSelectClass} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">{t('ทุกประเภท')}</option>
          {TX_TYPES.map((t) => (
            <option key={t} value={t}>
              {TX_TYPE_LABELS[t]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={t('กรองตามตลาด')} className={chipSelectClass} value={market} onChange={(e) => setMarket(e.target.value)}>
          <option value="">{t('ทุกตลาด')}</option>
          {MARKETS.map((m) => (
            <option key={m} value={m}>
              {MARKET_LABELS[m]}
            </option>
          ))}
        </NativeSelect>
      </div>

      {ledger.issues.length > 0 && (
        <Alert>
          
          {t('มี ')}{ledger.issues.length} {t(' รายการที่คำนวณไม่ได้ (แถวสีเหลือง) มักเกิดจากขายเกินจำนวนที่ถือ หรือแก้/ลบรายการซื้อก่อนหน้า')}
        </Alert>
      )}

      {undoError && <Alert tone="error">{undoError}</Alert>}

      {shown.length === 0 ? (
        <Card>
          <p className="text-muted-foreground">
            {data.transactions.length === 0 ? t('ยังไม่มีรายการ เริ่มจากปุ่มบันทึกรายการ') : t('ไม่พบรายการที่ตรงกับตัวกรอง')}
          </p>
        </Card>
      ) : isDesktop ? (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>{t('เวลา')}</Th>
                <Th>{t('ประเภท')}</Th>
                <Th>{t('สินทรัพย์')}</Th>
                <Th>{t('จำนวน / ยอด')}</Th>
                <Th>{t('เรท')}</Th>
                <Th className="text-right">{t('สุทธิ (')}{base})</Th>
                {/* Wide enough for the undo link as well as the edit and delete icons, so a pending row doesn't shift the columns. */}
                <Th className="w-28">
                  <span className="sr-only">{t('จัดการ')}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((tx, index) => {
                const issue = issues.get(tx.id)
                const net = netOf(tx, issue !== undefined)
                const notes = [taxNoteText(tx), feeNoteText(tx)].filter(Boolean)
                const newDay = index === 0 || shown[index - 1].date !== tx.date
                const dayHeading = newDay && (
                  <tr>
                    <th colSpan={7} scope="colgroup" className="px-2 pt-4 pb-1 text-left text-[12.5px] font-semibold text-muted-foreground">
                      {fmtDay(tx.date)}
                    </th>
                  </tr>
                )
                if (pendingIds.has(tx.id)) {
                  return (
                    <Fragment key={tx.id}>
                      {dayHeading}
                      <tr>
                        <Td className="text-muted-foreground">{tx.time ?? '—'}</Td>
                        <Td className="text-muted-foreground">{TX_TYPE_LABELS[tx.type]}</Td>
                        <Td className="max-w-72">
                          <span className="flex items-center gap-2">
                            {assetOf(tx, true, true)}
                            <Badge variant="void">{t('ยกเลิกแล้ว')}</Badge>
                          </span>
                        </Td>
                        <Td className="text-muted-foreground">
                          <span className="line-through">
                            {describeMain(tx, accountNames, instruments)}
                            {!namesCurrency(tx) && ` ${tx.currency}`}
                          </span>
                          {' · '}
                          <span>{t('ลบเมื่อสักครู่')}</span>
                        </Td>
                        <Td />
                        <Td />
                        <Td className="text-right">
                          <UndoButton label={label(tx)} onUndo={() => void handleUndo(tx)} />
                        </Td>
                      </tr>
                    </Fragment>
                  )
                }
                return (
                  <Fragment key={tx.id}>
                    {dayHeading}
                    <tr className={cn(issue && 'bg-warning-bg [&>td]:border-transparent')}>
                      <Td className="text-muted-foreground">{tx.time ?? '—'}</Td>
                      <Td>{TX_TYPE_LABELS[tx.type]}</Td>
                      <Td className="max-w-72">
                        <span className="flex items-center gap-2">
                          {assetOf(tx)}
                          {issue && (
                            <Badge variant="warning">
                              <TriangleAlert aria-hidden />
                              
                              {t('ไม่นับในพอร์ต')}
                            </Badge>
                          )}
                        </span>
                      </Td>
                      <Td>
                        {describeMain(tx, accountNames, instruments)}
                        {!namesCurrency(tx) && <span className="text-muted-foreground"> {tx.currency}</span>}
                        {notes.map((note) => (
                          <span key={note} className="block text-[12.5px] text-muted-foreground">
                            {note}
                          </span>
                        ))}
                      </Td>
                      <Td>{feeFreeTransfer(tx) ? <span className="text-muted-foreground">—</span> : <RateCell tx={tx} />}</Td>
                      <Td className={cn('text-right font-display font-semibold', net.className)}>{net.text}</Td>
                      <Td className="text-right">
                        <span className="inline-flex items-center gap-1">
                          <Link
                            to={`/transactions/${tx.id}`}
                            aria-label={t('แก้ไขรายการ {0}', label(tx))}
                            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
                          >
                            <Pencil aria-hidden />
                          </Link>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('ลบรายการ {0}', label(tx))}
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
                          <span>{issue}</span> {t(' · แก้รายการนี้ หรือรายการก่อนหน้าที่เกี่ยวข้อง แล้วตัวเลขพอร์ตจะกลับมาครบ')}
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
          <ul aria-label={t('รายการทั้งหมด')}>
            {shown.map((tx, index) => {
              const issue = issues.get(tx.id)
              const net = netOf(tx, issue !== undefined)
              const newDay = index === 0 || shown[index - 1].date !== tx.date
              const dayHeading = newDay && <li className="pt-4 pb-1 text-[12.5px] font-semibold text-muted-foreground">{fmtDay(tx.date)}</li>
              if (pendingIds.has(tx.id)) {
                return (
                  <Fragment key={tx.id}>
                    {dayHeading}
                    <li className="border-t border-muted py-1.5">
                      <div className="flex min-w-0 items-center gap-2 pt-1.5">
                        {assetOf(tx, false, true)}
                        <Badge variant="void">{t('ยกเลิกแล้ว')}</Badge>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[12.5px] text-muted-foreground">
                        <span className="min-w-0">
                          {TX_TYPE_SHORT_LABELS[tx.type] ?? TX_TYPE_LABELS[tx.type]} ·{' '}
                          <span className="line-through">
                            {describeMain(tx, accountNames, instruments)}
                            {!namesCurrency(tx) && ` ${tx.currency}`}
                          </span>{' '}
                          
                          {t('· ลบเมื่อสักครู่')}
                        </span>
                        <UndoButton label={label(tx)} className="-mr-2" onUndo={() => void handleUndo(tx)} />
                      </div>
                    </li>
                  </Fragment>
                )
              }
              return (
                <Fragment key={tx.id}>
                  {dayHeading}
                  <li className={cn('border-t border-muted', issue && 'rounded-xl border-transparent bg-warning-bg px-2.5')}>
                    <Link to={`/transactions/${tx.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 py-3">
                      <span className="flex min-w-0 items-center gap-2">
                        {assetOf(tx, false)}
                        <span className="shrink-0 text-[13px] text-muted-foreground">{TX_TYPE_SHORT_LABELS[tx.type] ?? TX_TYPE_LABELS[tx.type]}</span>
                      </span>
                      <span className={cn('shrink-0 font-display font-semibold', net.className)}>{net.text}</span>
                      <span className="col-span-2 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-muted-foreground">
                        {tx.instrumentId && <span>{accountNames.get(tx.accountId) ?? '—'} ·</span>}
                        {/* The dot is drawn after this part, joined by a no-break space, so a wrapped line never starts with one. */}
                        <span className={cn(showsRate(tx) && "after:content-[' ·']")}>
                          {describeBody(tx, accountNames, instruments)}
                          {!namesCurrency(tx) && ` ${tx.currency}`}
                          {feeNote(tx)}
                        </span>
                        {showsRate(tx) && (
                          <span className="inline-flex items-center gap-x-1.5 whitespace-nowrap">
                            <span>{t('เรท')}</span>
                            <RateCell tx={tx} />
                          </span>
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

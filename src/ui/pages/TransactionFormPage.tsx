import { Check, Copy, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Alert } from '../../components/ui/alert'
import { Button, buttonVariants } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Chip } from '../../components/ui/chip'
import { Field } from '../../components/ui/field'
import { Input, NativeSelect, Textarea } from '../../components/ui/input'
import { db } from '../../db/db'
import { deleteTransaction, newId, saveTransactions, upsertInstrument } from '../../db/repo'
import { CURRENCY_OPTIONS } from '../../domain/currencies'
import { isIsoDate, todayLocal } from '../../domain/dates'
import { D, isDecimalString } from '../../domain/decimal'
import { fxConvertSummary, spreadPct } from '../../domain/fxConvert'
import { computeLedger, positionKey } from '../../domain/ledger'
import { findInstrument, instrumentKey, symbolOf, unitOf, type Market, type Transaction } from '../../domain/types'
import { useFxProvider } from '../../fx/context'
import { getFxQuote } from '../../fx/fxService'
import { cn } from '../../lib/cn'
import { previewAfterSave } from '../afterSave'
import { MiniRoute } from '../components/MoneyRoute'
import { PageHeader } from '../components/PageHeader'
import { ConvertFields, ConvertSummary } from '../components/txform/ConvertFields'
import { FeeTaxFields } from '../components/txform/FeeTaxFields'
import { AfterSavePanel, TotalPanel } from '../components/txform/FormSidePanels'
import { FxRateBox } from '../components/txform/FxRateBox'
import { InstrumentFields } from '../components/txform/InstrumentFields'
import { ReceiveFields, ReceiveTaxField } from '../components/txform/ReceiveFields'
import { ReinvestFields } from '../components/txform/ReinvestFields'
import { SwapFields, SwapSummary } from '../components/txform/SwapFields'
import { TransferAmountField, TransferFields } from '../components/txform/TransferFields'
import { TypePicker } from '../components/txform/TypePicker'
import { WithdrawFields } from '../components/txform/WithdrawFields'
import { fmtDate, fmtMoney, fmtNumber, fmtPrice } from '../format'
import { useAppData, type AppData } from '../hooks'
import { TX_TYPE_LABELS, UNIT_LABELS, unitLabel } from '../labels'
import {
  applyReferenceRate,
  changeAssetType,
  changeCurrency,
  changeDate,
  changeMarket,
  changeOpeningKind,
  changeType,
  draftFromTransaction,
  draftToTransaction,
  duplicateDraft,
  emptyDraft,
  isOpeningAsset,
  movesNoMoney,
  pickSymbol,
  reinvestTransaction,
  showsInstrument,
  syncFees,
  syncReceived,
  totalForDisplay,
  withTransferTarget,
  type Draft,
} from '../transactionDraft'
import { useIsDesktop } from '../useIsDesktop'

export function TransactionFormPage() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const data = useAppData()
  if (!data) return <p className="text-muted-foreground">กำลังโหลด…</p>
  if (data.accounts.length === 0) {
    return (
      <Card>
        ยังไม่มีบัญชี{' '}
        <Link to="/settings" className="font-semibold text-primary underline underline-offset-[3px]">
          เพิ่มบัญชีก่อน
        </Link>
      </Card>
    )
  }
  const existing = id ? data.transactions.find((t) => t.id === id) : undefined
  if (id && !existing) return <Card>ไม่พบรายการนี้</Card>
  const from = id ? null : searchParams.get('from')
  const copyOf = from ? data.transactions.find((t) => t.id === from) : undefined
  return <TransactionForm key={id ?? `new-${from ?? ''}`} data={data} existing={existing} copyOf={copyOf} />
}

function positiveDecimal(value: string | undefined): boolean {
  return value !== undefined && isDecimalString(value) && D(value).greaterThan(0)
}

// Units moved between accounts have no currency of their own here, so the field only says what the fee is paid in.
function currencyLabel(draft: Draft): string {
  if (draft.type === 'fx_convert') return 'สกุลเงินต้นทาง'
  if (draft.type === 'swap') return 'สกุลเงินที่ใช้วัดมูลค่า'
  return draft.type === 'transfer' && draft.transferKind === 'asset' ? 'สกุลเงินของค่าธรรมเนียม' : 'สกุลเงิน'
}

function amountLabel(draft: Draft): string {
  switch (draft.type) {
    case 'dividend':
      return 'ปันผลก่อนหักภาษี'
    case 'interest':
      return 'ดอกเบี้ย/คูปองก่อนหักภาษี'
    case 'fx_convert':
      return 'จำนวนเงินต้นทาง'
    case 'opening':
      return 'เงินสดยกมา'
    case 'swap':
      return 'มูลค่ารวม ณ ตอนแลก'
    default:
      return 'จำนวนเงิน'
  }
}

// Keeps account, date, type, market, currency and rate so several lines from one statement go in quickly.
function clearEntry(draft: Draft): Draft {
  return {
    ...draft,
    time: '',
    symbol: '',
    instrumentName: '',
    toSymbol: '',
    toInstrumentName: '',
    toQuantity: '',
    quantity: '',
    price: '',
    amount: '',
    fees: '',
    feesSource: 'auto',
    tax: '',
    feeQuantity: '',
    splitRatio: '',
    toAmount: '',
    toAmountSource: 'auto',
    note: '',
    reinvest: false,
    reinvestQuantity: '',
    reinvestPrice: '',
    reinvestFees: '',
  }
}

function marketRateKey(draft: Draft): string {
  return `${draft.toCurrency}|${draft.currency}|${draft.date}`
}

function TransactionForm({ data, existing, copyOf }: { data: AppData; existing?: Transaction; copyOf?: Transaction }) {
  const navigate = useNavigate()
  const provider = useFxProvider()
  const isDesktop = useIsDesktop()
  const base = data.settings.baseCurrency
  const [draft, setDraftState] = useState<Draft>(() => {
    if (existing) return draftFromTransaction(existing, data.instruments)
    if (copyOf) return duplicateDraft(copyOf, data.instruments, todayLocal())
    return emptyDraft(data.accounts[0].id, todayLocal())
  })
  // The accounts come from a live query that hands over a new array on every write, and setDraft is a dependency of
  // the rate lookups below, so a ref keeps it stable.
  const accountsRef = useRef(data.accounts)
  useEffect(() => {
    accountsRef.current = data.accounts
  }, [data.accounts])
  // Every change passes through here so the received amount of an exchange and the fee from the account formula are
  // recomputed in one place.
  const setDraft = useCallback(
    (change: (d: Draft) => Draft) => setDraftState((d) => syncReceived(syncFees(change(d), accountsRef.current))),
    [],
  )
  const [errors, setErrors] = useState<string[]>([])
  const [fxMessage, setFxMessage] = useState('')
  const [noRateFor, setNoRateFor] = useState('')
  const [savedNote, setSavedNote] = useState('')
  const [copiedFrom, setCopiedFrom] = useState(copyOf)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const savingRef = useRef(false)
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  const needsFx = draft.currency !== base && draft.type !== 'split' && !movesNoMoney(draft)
  const openingAsset = isOpeningAsset(draft)
  const isTrade = draft.type === 'buy' || draft.type === 'sell'
  const usesAmountField = !isTrade && !openingAsset && draft.type !== 'split' && draft.type !== 'transfer' && draft.type !== 'receive_asset'

  const others = useMemo(() => data.transactions.filter((t) => t.id !== existing?.id), [data.transactions, existing?.id])
  const heldLedger = useMemo(() => computeLedger(others), [others])

  useEffect(() => {
    if (!needsFx || !isIsoDate(draft.date)) return
    let cancelled = false
    getFxQuote(db, provider, draft.currency, base, draft.date)
      .then((quote) => {
        if (cancelled) return
        setFxMessage(`เรทกลาง ECB ${fmtDate(quote.rateDate)}`)
        setDraft((d) => applyReferenceRate(d, quote))
      })
      .catch((error: Error) => {
        if (!cancelled) setFxMessage(error.message)
      })
    return () => {
      cancelled = true
    }
  }, [needsFx, draft.currency, draft.date, base, provider, setDraft])

  useEffect(() => {
    const { type, toCurrency, currency, date } = draft
    if (type !== 'fx_convert' || !toCurrency || toCurrency === currency || !isIsoDate(date)) return
    let cancelled = false
    getFxQuote(db, provider, toCurrency, currency, date)
      .then((quote) => {
        if (cancelled) return
        setNoRateFor('')
        setDraft((d) => ({ ...d, marketRate: quote.rate, marketRateDate: quote.rateDate }))
      })
      .catch(() => {
        if (cancelled) return
        setNoRateFor(marketRateKey(draft))
        setDraft((d) => ({ ...d, marketRate: '', marketRateDate: '' }))
      })
    return () => {
      cancelled = true
    }
  }, [draft.type, draft.toCurrency, draft.currency, draft.date, provider, setDraft])

  const now = new Date()
  const preview = draftToTransaction(draft, {
    id: existing?.id ?? 'preview',
    createdAt: existing?.createdAt ?? now.toISOString(),
    baseCurrency: base,
    today: todayLocal(now),
  })
  const symbol = draft.symbol.trim().toUpperCase()
  const known = findInstrument(data.instruments, draft.market, symbol)
  const offersReinvest = !existing && draft.type === 'dividend' && symbol !== ''
  const reinvesting = offersReinvest && draft.reinvest
  const reinvested = reinvesting
    ? reinvestTransaction(draft, preview.tx, { id: 'preview-buy', createdAt: preview.tx.createdAt, today: todayLocal(now) })
    : null
  const reinvestPlan =
    reinvested && preview.errors.length === 0 && reinvested.errors.length === 0
      ? { dividend: preview.tx, buy: reinvested.tx }
      : null
  const total = preview.errors.length === 0 ? totalForDisplay(preview.tx) : null
  const rate = needsFx && positiveDecimal(preview.tx.fxRate) ? preview.tx.fxRate : null
  const rateSpread =
    draft.fxSource !== 'auto' && positiveDecimal(preview.tx.fxRate) ? spreadPct(preview.tx.fxRate, draft.referenceFxRate) : null
  const convert =
    draft.type === 'fx_convert' && positiveDecimal(preview.tx.amount) && positiveDecimal(preview.tx.toAmount)
      ? fxConvertSummary(preview.tx)
      : null
  const accountNames = new Map(data.accounts.map((a) => [a.id, a.name]))
  const afterSave =
    preview.errors.length === 0
      ? previewAfterSave(others, preview.tx, base, symbol, existing, accountNames, reinvestPlan ? [reinvestPlan.buy] : [])
      : null
  const hintFor = (market: Market, typed: string) => {
    const entered = typed.trim()
    if (!entered) return undefined
    const held = heldLedger.positions.find((p) => p.key === positionKey(draft.accountId, instrumentKey(market, entered)))
    const instrument = findInstrument(data.instruments, market, entered)
    const hint = [instrument?.name, held && `ถืออยู่ ${fmtNumber(held.quantity, 8)} ${unitLabel(instrument)}`].filter(Boolean).join(' · ')
    return hint || undefined
  }

  async function save(addAnother: boolean) {
    if (savingRef.current) return
    setSaveFailed(false)
    const at = new Date()
    const { tx, errors: dividendErrors } = draftToTransaction(draft, {
      id: existing?.id ?? newId(),
      createdAt: existing?.createdAt ?? at.toISOString(),
      baseCurrency: base,
      today: todayLocal(at),
    })
    // The buy sorts right after the dividend even when both carry the same date and time.
    const buy = reinvesting
      ? reinvestTransaction(draft, tx, { id: newId(), createdAt: new Date(at.getTime() + 1).toISOString(), today: todayLocal(at) })
      : null
    const written = buy ? [tx, buy.tx] : [tx]
    const found = [...new Set([...dividendErrors, ...(buy?.errors ?? [])])]
    const ledgerErrors =
      found.length > 0
        ? []
        : [
            ...new Set(
              computeLedger([...others, ...written])
                .issues.filter((issue) => written.some((t) => t.id === issue.txId))
                .map((issue) => issue.message),
            ),
          ]
    if (found.length > 0 || ledgerErrors.length > 0) {
      setErrors([...found, ...ledgerErrors])
      setSavedNote('')
      return
    }
    savingRef.current = true
    setSaving(true)
    try {
      // A dividend can be paid in another currency than the one the instrument trades in, so a known
      // instrument keeps what is stored for it.
      const entered = [
        { id: tx.instrumentId, market: draft.market, symbol, name: draft.instrumentName, assetType: draft.assetType, unit: draft.unit },
        {
          id: tx.toInstrumentId,
          market: draft.toMarket,
          symbol: draft.toSymbol.trim().toUpperCase(),
          name: draft.toInstrumentName,
          assetType: draft.toAssetType,
          unit: draft.toUnit,
        },
      ]
      for (const { id, name, ...instrument } of entered) {
        if (id && !data.instruments.some((i) => i.id === id)) {
          await upsertInstrument(db, { ...instrument, id, name: name.trim() || instrument.symbol, currency: draft.currency })
        }
      }
      await saveTransactions(db, written, at)
    } catch {
      savingRef.current = false
      setSaving(false)
      setSaveFailed(true)
      return
    }
    if (!addAnother) {
      // The guard stays on while the page leaves, so a tap during navigation cannot save a second copy.
      navigate('/transactions')
      return
    }
    savingRef.current = false
    setSaving(false)
    setDraft(clearEntry)
    setCopiedFrom(undefined)
    setErrors([])
    const subject = tx.toInstrumentId ? `${symbol} → ${symbolOf(tx.toInstrumentId)}` : symbol
    setSavedNote(buy ? `บันทึกแล้ว · ปันผล + ซื้อ ${symbol}` : `บันทึกแล้ว · ${TX_TYPE_LABELS[tx.type]} ${subject}`.trim())
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void save(false)
  }

  async function handleDelete() {
    if (!existing || !window.confirm(`ลบรายการ${TX_TYPE_LABELS[existing.type]} วันที่ ${fmtDate(existing.date)}?`)) return
    await deleteTransaction(db, existing.id)
    navigate('/transactions')
  }

  const totalPanel = total && <TotalPanel total={total} currency={draft.currency} base={base} rate={rate} />

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-3.5 md:gap-[22px]">
      <PageHeader title={existing ? 'แก้ไขรายการ' : 'บันทึกรายการ'} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3.5 md:gap-[22px] xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="grid gap-[18px]">
          {copiedFrom && (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Copy className="size-4 shrink-0" aria-hidden />
              ทำซ้ำจากรายการวันที่ {fmtDate(copiedFrom.date)}
            </p>
          )}
          <TypePicker type={draft.type} onChange={(type) => setDraft((d) => withTransferTarget(changeType(d, type, base), data.accounts))} />

          <div className="grid gap-3.5 sm:grid-cols-3 md:max-[880px]:grid-cols-2">
            <Field id="tx-account" label="บัญชี">
              <NativeSelect
                id="tx-account"
                value={draft.accountId}
                onChange={(e) => {
                  const accountId = e.target.value
                  setDraft((d) => withTransferTarget({ ...d, accountId }, data.accounts))
                }}
              >
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="tx-date" label="วันที่">
              <Input
                id="tx-date"
                type="date"
                value={draft.date}
                max={todayLocal()}
                onChange={(e) => {
                  const date = e.target.value
                  setDraft((d) => changeDate(d, date))
                  setFxMessage('')
                }}
              />
            </Field>
            <Field id="tx-time" label="เวลา (ไม่บังคับ)">
              <Input id="tx-time" type="time" value={draft.time} onChange={(e) => update({ time: e.target.value })} />
            </Field>
          </div>

          {draft.type === 'opening' && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="ยอดยกมาของ">
              <Chip active={draft.openingKind === 'asset'} onClick={() => setDraft((d) => changeOpeningKind(d, 'asset'))}>
                สินทรัพย์ที่ถืออยู่
              </Chip>
              <Chip active={draft.openingKind === 'cash'} onClick={() => setDraft((d) => changeOpeningKind(d, 'cash'))}>
                เงินสดคงเหลือ
              </Chip>
            </div>
          )}

          {draft.type === 'transfer' && <TransferFields draft={draft} accounts={data.accounts} update={update} />}

          {showsInstrument(draft) && draft.type !== 'swap' && draft.type !== 'receive_asset' && (
            <InstrumentFields
              idPrefix="tx"
              symbolLabel={draft.type === 'interest' ? 'สัญลักษณ์ (ถ้าเป็นคูปองหุ้นกู้)' : 'สัญลักษณ์'}
              market={draft.market}
              symbol={draft.symbol}
              name={draft.instrumentName}
              assetType={draft.assetType}
              unit={draft.unit}
              instruments={data.instruments}
              hint={hintFor(draft.market, draft.symbol)}
              onMarket={(market) => setDraft((d) => changeMarket(d, market, data.instruments))}
              onSymbol={(value) => setDraft((d) => pickSymbol(d, value, data.instruments))}
              onName={(instrumentName) => update({ instrumentName })}
              onAssetType={(assetType) => setDraft((d) => changeAssetType(d, assetType))}
              onUnit={(unit) => update({ unit })}
            />
          )}

          {draft.type === 'swap' && (
            <SwapFields
              draft={draft}
              instruments={data.instruments}
              fromHint={hintFor(draft.market, draft.symbol)}
              toHint={hintFor(draft.toMarket, draft.toSymbol)}
              setDraft={setDraft}
            />
          )}

          {draft.type === 'receive_asset' && (
            <ReceiveFields draft={draft} instruments={data.instruments} hint={hintFor(draft.market, draft.symbol)} setDraft={setDraft} />
          )}

          <div className={cn('grid gap-3.5', isTrade || openingAsset ? 'grid-cols-[minmax(5.5rem,auto)_1fr_1fr]' : 'sm:grid-cols-2')}>
            {draft.type !== 'split' && !movesNoMoney(draft) && (
              <Field id="tx-currency" label={currencyLabel(draft)}>
                <NativeSelect id="tx-currency" value={draft.currency} onChange={(e) => setDraft((d) => changeCurrency(d, e.target.value))}>
                  {CURRENCY_OPTIONS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {(isTrade || openingAsset) && (
              <>
                <Field id="tx-quantity" label="จำนวนหน่วย">
                  <Input id="tx-quantity" inputMode="decimal" value={draft.quantity} onChange={(e) => update({ quantity: e.target.value })} />
                </Field>
                <Field id="tx-price" label={openingAsset ? 'ต้นทุนเฉลี่ยต่อหน่วย' : 'ราคาต่อหน่วย'}>
                  <Input id="tx-price" inputMode="decimal" value={draft.price} onChange={(e) => update({ price: e.target.value })} />
                </Field>
              </>
            )}
            {draft.type === 'split' && (
              <Field id="tx-split" label="อัตราแตกพาร์ (หุ้นใหม่ต่อหุ้นเดิม)" hint="4 = 1 หุ้นเป็น 4 หุ้น, 0.1 = 10 หุ้นเป็น 1 หุ้น">
                <Input id="tx-split" inputMode="decimal" value={draft.splitRatio} onChange={(e) => update({ splitRatio: e.target.value })} />
              </Field>
            )}
            {draft.type === 'transfer' && <TransferAmountField draft={draft} update={update} />}
            {draft.type === 'receive_asset' && <ReceiveTaxField draft={draft} update={update} />}
            {usesAmountField && (
              <Field id="tx-amount" label={amountLabel(draft)}>
                <Input id="tx-amount" inputMode="decimal" value={draft.amount} onChange={(e) => update({ amount: e.target.value })} />
              </Field>
            )}
            {draft.type === 'fx_convert' && (
              <ConvertFields draft={draft} rateMissing={noRateFor === marketRateKey(draft)} update={update} />
            )}
          </div>

          {draft.type !== 'split' && draft.type !== 'opening' && draft.type !== 'receive_asset' && (
            <FeeTaxFields
              draft={draft}
              account={data.accounts.find((a) => a.id === draft.accountId)}
              instruments={data.instruments}
              feeHint={hintFor(draft.feeMarket, draft.feeSymbol)}
              update={update}
            />
          )}

          {draft.type === 'withdraw' && <WithdrawFields draft={draft} update={update} />}

          {needsFx && <FxRateBox draft={draft} base={base} fxMessage={fxMessage} rateSpread={rateSpread} update={update} />}

          {convert && <ConvertSummary draft={draft} summary={convert} />}

          {afterSave?.swap && <SwapSummary draft={draft} outcome={afterSave.swap} />}

          {offersReinvest && <ReinvestFields draft={draft} plan={reinvestPlan} update={update} />}

          <Field id="tx-note" label="หมายเหตุ">
            <Textarea id="tx-note" value={draft.note} onChange={(e) => update({ note: e.target.value })} />
          </Field>

          {!isDesktop && totalPanel}
          {!isDesktop && afterSave?.warning && <Alert role="note">{afterSave.warning}</Alert>}

          {errors.length > 0 && (
            <Alert tone="error">
              <ul className="list-disc pl-4">
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </Alert>
          )}
          {saveFailed && <Alert tone="error">บันทึกไม่สำเร็จ ข้อมูลยังไม่ถูกบันทึก ลองอีกครั้ง</Alert>}
          {savedNote && (
            <p role="status" className="text-sm font-semibold text-gain">
              {savedNote}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={saving}>
              <Check aria-hidden />
              บันทึก
            </Button>
            {!existing && (
              <Button type="button" variant="outline" disabled={saving} onClick={() => void save(true)}>
                บันทึกแล้วเพิ่มอีก
              </Button>
            )}
            <Link to="/transactions" className={buttonVariants({ variant: 'ghost' })}>
              ยกเลิก
            </Link>
            {existing && (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Link to={`/transactions/new?from=${existing.id}`} className={buttonVariants({ variant: 'outline' })}>
                  <Copy aria-hidden />
                  ทำซ้ำ
                </Link>
                <Button type="button" variant="ghost" className="text-destructive" onClick={() => void handleDelete()}>
                  <Trash2 aria-hidden />
                  ลบรายการนี้
                </Button>
              </div>
            )}
          </div>
        </Card>

        {isDesktop && (
          <div className="grid content-start gap-4">
            {totalPanel}
            {rate && total && preview.tx.instrumentId && (draft.type === 'buy' || openingAsset) && (
              <Card>
                <h2 className="mb-4 text-base font-semibold">เส้นทางเงินของรายการนี้</h2>
                <MiniRoute
                  from={fmtMoney(total.times(D(rate)), base)}
                  via={`แลกที่ ${fmtPrice(rate)}`}
                  to={`${symbol} ${fmtNumber(preview.tx.quantity, 8)} ${UNIT_LABELS[known ? unitOf(known) : draft.unit]}`}
                />
              </Card>
            )}
            {afterSave && afterSave.rows.length > 0 && <AfterSavePanel preview={afterSave} />}
          </div>
        )}
      </div>
    </form>
  )
}

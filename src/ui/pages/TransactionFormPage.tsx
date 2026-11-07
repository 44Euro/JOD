import { Check, Copy, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { buttonVariants } from '../../components/ui/button-variants'
import { Card } from '../../components/ui/card'
import { Chip } from '../../components/ui/chip'
import { Field } from '../../components/ui/field'
import { Input, NativeSelect, Textarea } from '../../components/ui/input'
import { db } from '../../db/db'
import { addPictures } from '../../db/repo'
import { CURRENCY_OPTIONS } from '../../domain/currencies'
import { isIsoDate, todayLocal } from '../../domain/dates'
import { D, isDecimalString } from '../../domain/decimal'
import { fxConvertSummary, spreadPct } from '../../domain/fxConvert'
import { computeLedger, positionKey } from '../../domain/ledger'
import { ASSET_TYPES, MARKETS, TX_TYPES, findInstrument, instrumentKey, symbolOf, unitOf, type Market, type Transaction, type TxType } from '../../domain/types'
import { useFxProvider } from '../../fx/context'
import { quoteWithPegFallback } from '../../fx/fxService'
import type { FoundAsset } from '../../market/client'
import { cn } from '../../lib/cn'
import { previewAfterSave } from '../afterSave'
import { prepareSave, writeSave } from '../saveDraft'
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
import { JournalPictures } from '../components/txform/JournalPictures'
import { TradeJournalFields } from '../components/txform/TradeJournalFields'
import { MoveCurrencyFields, TransferAmountField, TransferFields } from '../components/txform/TransferFields'
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
  emptyJournalDraft,
  isOpeningAsset,
  knownStrategies,
  movesNoMoney,
  pickFound,
  pickSymbol,
  reinvestTransaction,
  showsInstrument,
  syncFees,
  syncReceived,
  totalForDisplay,
  withTransferTarget,
  type Draft,
} from '../transactionDraft'
import { deleteWithUndo } from '../undoDelete'
import { useIsDesktop } from '../useIsDesktop'
import { t } from '../../i18n'

export function TransactionFormPage() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const data = useAppData()
  if (!data) return <p className="text-muted-foreground">{t('กำลังโหลด…')}</p>
  if (data.accounts.length === 0) {
    return (
      <Card>
        {t('ยังไม่มีบัญชี')}{' '}
        <Link to="/settings" className="font-semibold text-primary underline underline-offset-[3px]">
          {t('เพิ่มบัญชีก่อน')}
        </Link>
      </Card>
    )
  }
  const existing = id ? data.transactions.find((t) => t.id === id) : undefined
  if (id && !existing) return <Card>{t('ไม่พบรายการนี้')}</Card>
  const from = id ? null : searchParams.get('from')
  const copyOf = from ? data.transactions.find((t) => t.id === from) : undefined
  const asked = searchParams.get('type')
  const startType = !id && !from ? TX_TYPES.find((type) => type === asked) : undefined
  const startFound = !id && !from ? foundFrom(searchParams) : undefined
  return (
    <TransactionForm
      key={id ?? `new-${from ?? ''}-${startType ?? ''}-${startFound?.market ?? ''}:${startFound?.symbol ?? ''}`}
      data={data}
      existing={existing}
      copyOf={copyOf}
      startType={startType}
      startFound={startFound}
    />
  )
}

// A pick from the market search that the app did not know arrives in the address; anything else in it is ignored.
function foundFrom(params: URLSearchParams): FoundAsset | undefined {
  const market = MARKETS.find((m) => m === params.get('market'))
  const symbol = params.get('symbol')?.trim().toUpperCase()
  if (!market || !symbol) return undefined
  return { market, symbol, name: params.get('name')?.trim() ?? '', assetType: ASSET_TYPES.find((a) => a === params.get('assetType')) ?? 'stock' }
}

function positiveDecimal(value: string | undefined): boolean {
  return value !== undefined && isDecimalString(value) && D(value).greaterThan(0)
}

// Units moved between accounts have no currency of their own here, so the field only says what the fee is paid in.
function currencyLabel(draft: Draft): string {
  if (draft.type === 'fx_convert') return t('สกุลเงินต้นทาง')
  if (draft.type === 'swap') return t('สกุลเงินที่ใช้วัดมูลค่า')
  return draft.type === 'transfer' && draft.transferKind === 'asset' ? t('สกุลเงินของค่าธรรมเนียม') : t('สกุลเงิน')
}

function amountLabel(draft: Draft): string {
  switch (draft.type) {
    case 'dividend':
      return t('ปันผลก่อนหักภาษี')
    case 'interest':
      return t('ดอกเบี้ย/คูปองก่อนหักภาษี')
    case 'fx_convert':
      return t('จำนวนเงินต้นทาง')
    case 'opening':
      return t('เงินสดยกมา')
    case 'swap':
      return t('มูลค่ารวม ณ ตอนแลก')
    default:
      return t('จำนวนเงิน')
  }
}

// Keeps account, date, type, market, currency and rate so several lines from one statement go in quickly, and the
// strategy of the journal because the next line is often another trade of the same plan.
function clearEntry(draft: Draft): Draft {
  return {
    ...draft,
    journal: { ...emptyJournalDraft(), strategy: draft.journal.strategy },
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

function marketRateKey(draft: Pick<Draft, 'toCurrency' | 'currency' | 'date'>): string {
  return `${draft.toCurrency}|${draft.currency}|${draft.date}`
}

function TransactionForm({
  data,
  existing,
  copyOf,
  startType,
  startFound,
}: {
  data: AppData
  existing?: Transaction
  copyOf?: Transaction
  startType?: TxType
  startFound?: FoundAsset
}) {
  const navigate = useNavigate()
  const provider = useFxProvider()
  const isDesktop = useIsDesktop()
  const base = data.settings.baseCurrency
  const [draft, setDraftState] = useState<Draft>(() => {
    if (existing) return draftFromTransaction(existing, data.instruments)
    if (copyOf) return duplicateDraft(copyOf, data.instruments, todayLocal())
    const blank = emptyDraft(data.accounts[0].id, todayLocal())
    const started = startType ? withTransferTarget(changeType(blank, startType, base), data.accounts) : blank
    return startFound ? pickFound(started, startFound, data.instruments) : started
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
  // The preview only needs a clock for its placeholder timestamp and today's date; saving reads its own.
  const [openedAt] = useState(() => new Date())
  const [savedNote, setSavedNote] = useState('')
  const [copiedFrom, setCopiedFrom] = useState(copyOf)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [pictures, setPictures] = useState<File[]>([])
  const savingRef = useRef(false)
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  const needsFx = draft.currency !== base && draft.type !== 'split' && !movesNoMoney(draft)
  const openingAsset = isOpeningAsset(draft)
  const isTrade = draft.type === 'buy' || draft.type === 'sell'
  const usesAmountField =
    !isTrade && !openingAsset && draft.type !== 'split' && draft.type !== 'transfer' && draft.type !== 'receive_asset' && !(draft.type === 'swap' && draft.exercise)

  const others = useMemo(() => data.transactions.filter((t) => t.id !== existing?.id), [data.transactions, existing?.id])
  const heldLedger = useMemo(() => computeLedger(others), [others])
  const strategies = useMemo(() => knownStrategies(data.transactions), [data.transactions])

  useEffect(() => {
    if (!needsFx || !isIsoDate(draft.date)) return
    let cancelled = false
    quoteWithPegFallback(db, provider, draft.currency, base, draft.date)
      .then(({ quote, borrowed }) => {
        if (cancelled) return
        const day = `ECB ${fmtDate(quote.rateDate)}`
        setFxMessage(borrowed ? t('ใช้เรท USD{0}', quote.rateDate === draft.date ? '' : ` · ${day}`) : t('เรทกลาง {0}', day))
        setDraft((d) => applyReferenceRate(d, quote, borrowed))
      })
      .catch((error: Error) => {
        if (!cancelled) setFxMessage(error.message)
      })
    return () => {
      cancelled = true
    }
  }, [needsFx, draft.currency, draft.date, base, provider, setDraft])

  // The rate a moved holding is re-counted at is the destination currency's rate on the day of the move.
  const moveCurrencyToRate =
    draft.type === 'transfer' && draft.transferKind === 'asset' && draft.moveCurrency && draft.moveCurrency !== base && !draft.moveRate
      ? draft.moveCurrency
      : ''
  const moveDate = draft.date
  useEffect(() => {
    const moveCurrency = moveCurrencyToRate
    if (!moveCurrency || !isIsoDate(moveDate)) return
    let cancelled = false
    quoteWithPegFallback(db, provider, moveCurrency, base, moveDate)
      .then(({ quote }) => {
        if (!cancelled) setDraft((d) => (d.moveCurrency === moveCurrency && !d.moveRate ? { ...d, moveRate: quote.rate } : d))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [moveCurrencyToRate, moveDate, base, provider, setDraft])

  const { type: convertType, toCurrency: convertTo, currency: convertFrom, date: convertDate } = draft
  useEffect(() => {
    if (convertType !== 'fx_convert' || !convertTo || convertTo === convertFrom || !isIsoDate(convertDate)) return
    let cancelled = false
    quoteWithPegFallback(db, provider, convertTo, convertFrom, convertDate)
      .then(({ quote }) => {
        if (cancelled) return
        setNoRateFor('')
        setDraft((d) => ({ ...d, marketRate: quote.rate, marketRateDate: quote.rateDate }))
      })
      .catch(() => {
        if (cancelled) return
        setNoRateFor(marketRateKey({ toCurrency: convertTo, currency: convertFrom, date: convertDate }))
        setDraft((d) => ({ ...d, marketRate: '', marketRateDate: '' }))
      })
    return () => {
      cancelled = true
    }
  }, [convertType, convertTo, convertFrom, convertDate, provider, setDraft])

  const preview = draftToTransaction(draft, {
    id: existing?.id ?? 'preview',
    createdAt: existing?.createdAt ?? openedAt.toISOString(),
    baseCurrency: base,
    today: todayLocal(openedAt),
    instruments: data.instruments,
  })
  const symbol = draft.symbol.trim().toUpperCase()
  const known = findInstrument(data.instruments, draft.market, symbol)
  const offersReinvest = !existing && draft.type === 'dividend' && symbol !== ''
  const reinvesting = offersReinvest && draft.reinvest
  const reinvested = reinvesting
    ? reinvestTransaction(draft, preview.tx, { id: 'preview-buy', createdAt: preview.tx.createdAt, today: todayLocal(openedAt) })
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
  const movedHolding =
    draft.type === 'transfer' && draft.transferKind === 'asset' && symbol
      ? heldLedger.positions.find((p) => p.key === positionKey(draft.accountId, instrumentKey(draft.market, symbol)))
      : undefined
  // A destination that already holds the coin in another currency can only take it in that currency.
  const destinationCurrency =
    movedHolding && heldLedger.positions.find((p) => p.key === positionKey(draft.toAccountId, movedHolding.instrumentId))?.currency
  useEffect(() => {
    if (!movedHolding || !destinationCurrency || destinationCurrency === movedHolding.currency) return
    setDraft((d) => (d.moveCurrency ? d : { ...d, moveCurrency: destinationCurrency, moveRate: destinationCurrency === base ? '1' : '' }))
  }, [movedHolding, destinationCurrency, base, setDraft])
  const hintFor = (market: Market, typed: string) => {
    const entered = typed.trim()
    if (!entered) return undefined
    const held = heldLedger.positions.find((p) => p.key === positionKey(draft.accountId, instrumentKey(market, entered)))
    const instrument = findInstrument(data.instruments, market, entered)
    const hint = [instrument?.name, held && t('ถืออยู่ {0} {1}', fmtNumber(held.quantity, 8), unitLabel(instrument))].filter(Boolean).join(' · ')
    return hint || undefined
  }

  async function save(addAnother: boolean) {
    if (savingRef.current) return
    setSaveFailed(false)
    // eslint-disable-next-line react/purity -- save runs on a click, not during render
    const at = new Date()
    const prepared = prepareSave(draft, { existing, others, instruments: data.instruments, baseCurrency: base, reinvesting, at })
    const { tx } = prepared
    if (prepared.errors.length > 0) {
      setErrors(prepared.errors)
      setSavedNote('')
      return
    }
    savingRef.current = true
    setSaving(true)
    try {
      await writeSave(db, draft, prepared, data.instruments, at)
      if (pictures.length > 0 && (draft.type === 'buy' || draft.type === 'sell')) await addPictures(db, tx.id, pictures, at)
      setPictures([])
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
    setSavedNote(prepared.written.length > 1 ? t('บันทึกแล้ว · ปันผล + ซื้อ {0}', symbol) : t('บันทึกแล้ว · {0} {1}', TX_TYPE_LABELS[tx.type], subject).trim())
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void save(false)
  }

  async function handleDelete() {
    if (!existing) return
    await deleteWithUndo(db, existing)
    navigate('/transactions')
  }

  const totalPanel = total && <TotalPanel total={total} currency={draft.currency} base={base} rate={rate} />

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-3.5 md:gap-6">
      <PageHeader title={existing ? t('แก้ไขรายการ') : t('บันทึกรายการ')} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3.5 md:gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="grid gap-5">
          {copiedFrom && (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Copy className="size-4 shrink-0" aria-hidden />
              {t('ทำซ้ำจากรายการวันที่ ')}{fmtDate(copiedFrom.date)}
            </p>
          )}
          <TypePicker type={draft.type} onChange={(type) => setDraft((d) => withTransferTarget(changeType(d, type, base), data.accounts))} />

          <div className="grid gap-3.5 sm:grid-cols-3 md:max-[880px]:grid-cols-2">
            <Field id="tx-account" label={t('บัญชี')}>
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
            <Field id="tx-date" label={t('วันที่')}>
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
            <Field id="tx-time" label={t('เวลา (ไม่บังคับ)')}>
              <Input id="tx-time" type="time" value={draft.time} onChange={(e) => update({ time: e.target.value })} />
            </Field>
          </div>

          {draft.type === 'opening' && (
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('ยอดยกมาของ')}>
              <Chip active={draft.openingKind === 'asset'} onClick={() => setDraft((d) => changeOpeningKind(d, 'asset'))}>
                {t('สินทรัพย์ที่ถืออยู่')}
              </Chip>
              <Chip active={draft.openingKind === 'cash'} onClick={() => setDraft((d) => changeOpeningKind(d, 'cash'))}>
                {t('เงินสดคงเหลือ')}
              </Chip>
            </div>
          )}

          {draft.type === 'transfer' && <TransferFields draft={draft} accounts={data.accounts} update={update} />}

          {showsInstrument(draft) && draft.type !== 'swap' && draft.type !== 'receive_asset' && (
            <InstrumentFields
              idPrefix="tx"
              symbolLabel={draft.type === 'interest' ? t('สัญลักษณ์ (ถ้าเป็นคูปองหุ้นกู้)') : t('สัญลักษณ์')}
              market={draft.market}
              symbol={draft.symbol}
              name={draft.instrumentName}
              assetType={draft.assetType}
              unit={draft.unit}
              instruments={data.instruments}
              hint={hintFor(draft.market, draft.symbol)}
              onMarket={(market) => setDraft((d) => changeMarket(d, market, data.instruments, heldLedger.positions))}
              onSymbol={(value) => setDraft((d) => pickSymbol(d, value, data.instruments, heldLedger.positions))}
              onName={(instrumentName) => update({ instrumentName })}
              onAssetType={(assetType) => setDraft((d) => changeAssetType(d, assetType))}
              onUnit={(unit) => update({ unit })}
              onFound={(found) => setDraft((d) => pickFound(d, found, data.instruments, heldLedger.positions))}
            />
          )}

          {draft.type === 'swap' && (
            <SwapFields
              draft={draft}
              instruments={data.instruments}
              held={heldLedger.positions}
              fromHint={hintFor(draft.market, draft.symbol)}
              toHint={hintFor(draft.toMarket, draft.toSymbol)}
              setDraft={setDraft}
            />
          )}

          {draft.type === 'receive_asset' && (
            <ReceiveFields
              draft={draft}
              instruments={data.instruments}
              held={heldLedger.positions}
              hint={hintFor(draft.market, draft.symbol)}
              setDraft={setDraft}
            />
          )}

          <div className={cn('grid gap-3.5', isTrade || openingAsset ? 'grid-cols-[minmax(5.5rem,auto)_1fr] sm:grid-cols-3' : 'sm:grid-cols-2')}>
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
                <Field id="tx-quantity" label={t('จำนวนหน่วย')}>
                  <Input id="tx-quantity" inputMode="decimal" value={draft.quantity} onChange={(e) => update({ quantity: e.target.value })} />
                </Field>
                <Field id="tx-price" label={openingAsset ? t('ต้นทุนเฉลี่ยต่อหน่วย') : t('ราคาต่อหน่วย')} className="col-span-2 sm:col-span-1">
                  <Input id="tx-price" inputMode="decimal" value={draft.price} onChange={(e) => update({ price: e.target.value })} />
                </Field>
              </>
            )}
            {draft.type === 'split' && (
              <Field id="tx-split" label={t('อัตราแตกพาร์ (หุ้นใหม่ต่อหุ้นเดิม)')} hint={t('4 = 1 หุ้นเป็น 4 หุ้น, 0.1 = 10 หุ้นเป็น 1 หุ้น')}>
                <Input id="tx-split" inputMode="decimal" value={draft.splitRatio} onChange={(e) => update({ splitRatio: e.target.value })} />
              </Field>
            )}
            {draft.type === 'transfer' && <TransferAmountField draft={draft} update={update} />}
            {draft.type === 'receive_asset' && <ReceiveTaxField draft={draft} update={update} />}
            {draft.type === 'swap' && draft.exercise && (
              <Field id="tx-paid" label={t('เงินที่จ่ายค่าใช้สิทธิ')} hint={t('ราคาใช้สิทธิ × จำนวนหุ้นที่ได้ · ต้นทุนวอร์แรนต์จะยกไปรวมกับหุ้นให้เอง')}>
                <Input id="tx-paid" inputMode="decimal" value={draft.paid} onChange={(e) => update({ paid: e.target.value })} />
              </Field>
            )}
            {draft.type === 'buy' && (
              <label className="flex min-h-11 items-center gap-2.5 text-sm sm:col-span-2">
                <input type="checkbox" className="size-5 accent-primary" checked={draft.rightsOffer} onChange={(e) => update({ rightsOffer: e.target.checked })} />
                {t('ซื้อหุ้นเพิ่มทุนตามสิทธิ (XR) ที่ราคาจองซื้อ')}
              </label>
            )}
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

          {movedHolding && <MoveCurrencyFields draft={draft} heldCurrency={movedHolding.currency} base={base} update={update} />}

          {draft.type === 'withdraw' && <WithdrawFields draft={draft} update={update} />}

          {needsFx && <FxRateBox draft={draft} base={base} fxMessage={fxMessage} rateSpread={rateSpread} update={update} />}

          {isTrade && <TradeJournalFields draft={draft} strategies={strategies} checklist={data.settings.checklist} setDraft={setDraft} />}
          {isTrade && <JournalPictures txId={existing?.id} pending={pictures} setPending={setPictures} />}

          {convert && <ConvertSummary draft={draft} summary={convert} />}

          {afterSave?.swap && <SwapSummary draft={draft} outcome={afterSave.swap} />}

          {offersReinvest && <ReinvestFields draft={draft} plan={reinvestPlan} update={update} />}

          <Field id="tx-note" label={t('หมายเหตุ')}>
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
          {saveFailed && <Alert tone="error">{t('บันทึกไม่สำเร็จ ข้อมูลยังไม่ถูกบันทึก ลองอีกครั้ง')}</Alert>}
          {savedNote && (
            <p role="status" className="text-sm font-semibold text-gain">
              {savedNote}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={saving}>
              <Check aria-hidden />
              {t('บันทึก')}
            </Button>
            {!existing && (
              <Button type="button" variant="outline" disabled={saving} onClick={() => void save(true)}>
                {t('บันทึกแล้วเพิ่มอีก')}
              </Button>
            )}
            <Link to="/transactions" className={buttonVariants({ variant: 'ghost' })}>
              {t('ยกเลิก')}
            </Link>
            {existing && (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Link to={`/transactions/new?from=${existing.id}`} className={buttonVariants({ variant: 'outline' })}>
                  <Copy aria-hidden />
                  {t('ทำซ้ำ')}
                </Link>
                <Button type="button" variant="ghost" className="text-destructive" onClick={() => void handleDelete()}>
                  <Trash2 aria-hidden />
                  {t('ลบรายการนี้')}
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
                <h2 className="mb-4 text-base font-semibold">{t('เส้นทางเงินของรายการนี้')}</h2>
                <MiniRoute
                  from={fmtMoney(total.times(D(rate)), base)}
                  via={t('แลกที่ {0}', fmtPrice(rate))}
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

import { Check, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Alert } from '../../components/ui/alert'
import { Button, buttonVariants } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Chip } from '../../components/ui/chip'
import { Field } from '../../components/ui/field'
import { Input, NativeSelect, Textarea } from '../../components/ui/input'
import { db } from '../../db/db'
import { deleteTransaction, newId, saveTransaction, upsertInstrument } from '../../db/repo'
import { CURRENCY_OPTIONS } from '../../domain/currencies'
import { isIsoDate, todayLocal } from '../../domain/dates'
import { D, isDecimalString } from '../../domain/decimal'
import { fxConvertSummary, spreadPct } from '../../domain/fxConvert'
import { computeLedger, positionKey } from '../../domain/ledger'
import { instrumentKey, type Transaction } from '../../domain/types'
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
import { TypePicker } from '../components/txform/TypePicker'
import { WithdrawFields } from '../components/txform/WithdrawFields'
import { fmtDate, fmtMoney, fmtNumber, fmtPrice } from '../format'
import { useAppData, type AppData } from '../hooks'
import { TX_TYPE_LABELS } from '../labels'
import {
  applyReferenceRate,
  changeCurrency,
  changeDate,
  changeMarket,
  changeOpeningKind,
  changeType,
  draftFromTransaction,
  draftToTransaction,
  emptyDraft,
  isOpeningAsset,
  pickSymbol,
  showsInstrument,
  syncReceived,
  totalForDisplay,
  type Draft,
} from '../transactionDraft'
import { useIsDesktop } from '../useIsDesktop'

export function TransactionFormPage() {
  const { id } = useParams()
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
  return <TransactionForm key={id ?? 'new'} data={data} existing={existing} />
}

function positiveDecimal(value: string | undefined): boolean {
  return value !== undefined && isDecimalString(value) && D(value).greaterThan(0)
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
    quantity: '',
    price: '',
    amount: '',
    fees: '',
    tax: '',
    splitRatio: '',
    toAmount: '',
    toAmountSource: 'auto',
    note: '',
  }
}

function marketRateKey(draft: Draft): string {
  return `${draft.toCurrency}|${draft.currency}|${draft.date}`
}

function TransactionForm({ data, existing }: { data: AppData; existing?: Transaction }) {
  const navigate = useNavigate()
  const provider = useFxProvider()
  const isDesktop = useIsDesktop()
  const base = data.settings.baseCurrency
  const [draft, setDraftState] = useState<Draft>(() =>
    existing ? draftFromTransaction(existing, data.instruments) : emptyDraft(data.accounts[0].id, todayLocal()),
  )
  // Every change passes through here so the received amount of an exchange is recomputed in one place.
  const setDraft = useCallback((change: (d: Draft) => Draft) => setDraftState((d) => syncReceived(change(d))), [])
  const [errors, setErrors] = useState<string[]>([])
  const [fxMessage, setFxMessage] = useState('')
  const [noRateFor, setNoRateFor] = useState('')
  const [savedNote, setSavedNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const savingRef = useRef(false)
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  const needsFx = draft.currency !== base && draft.type !== 'split'
  const openingAsset = isOpeningAsset(draft)
  const isTrade = draft.type === 'buy' || draft.type === 'sell'
  const usesAmountField = !isTrade && !openingAsset && draft.type !== 'split'

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
  const total = preview.errors.length === 0 ? totalForDisplay(preview.tx) : null
  const rate = needsFx && positiveDecimal(preview.tx.fxRate) ? preview.tx.fxRate : null
  const rateSpread =
    draft.fxSource !== 'auto' && positiveDecimal(preview.tx.fxRate) ? spreadPct(preview.tx.fxRate, draft.referenceFxRate) : null
  const convert =
    draft.type === 'fx_convert' && positiveDecimal(preview.tx.amount) && positiveDecimal(preview.tx.toAmount)
      ? fxConvertSummary(preview.tx)
      : null
  const afterSave = preview.errors.length === 0 ? previewAfterSave(others, preview.tx, base, symbol, existing) : null
  const knownInstrument = symbol ? data.instruments.find((i) => i.id === instrumentKey(draft.market, symbol)) : undefined
  const held =
    showsInstrument(draft) && symbol
      ? heldLedger.positions.find((p) => p.key === positionKey(draft.accountId, instrumentKey(draft.market, symbol)))
      : undefined
  const symbolHint = [knownInstrument?.name, held && `ถืออยู่ ${fmtNumber(held.quantity, 8)} หน่วย`].filter(Boolean).join(' · ')

  async function save(addAnother: boolean) {
    if (savingRef.current) return
    setSaveFailed(false)
    const at = new Date()
    const { tx, errors: found } = draftToTransaction(draft, {
      id: existing?.id ?? newId(),
      createdAt: existing?.createdAt ?? at.toISOString(),
      baseCurrency: base,
      today: todayLocal(at),
    })
    const ledgerErrors =
      found.length > 0
        ? []
        : computeLedger([...others, tx])
            .issues.filter((issue) => issue.txId === tx.id)
            .map((issue) => issue.message)
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
      if (tx.instrumentId && !data.instruments.some((i) => i.id === tx.instrumentId)) {
        await upsertInstrument(db, {
          id: tx.instrumentId,
          market: draft.market,
          symbol,
          name: draft.instrumentName.trim() || symbol,
          assetType: draft.assetType,
          currency: draft.currency,
        })
      }
      await saveTransaction(db, tx, at)
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
    setErrors([])
    setSavedNote(`บันทึกแล้ว · ${TX_TYPE_LABELS[tx.type]} ${symbol}`.trim())
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
      <div className="grid items-start gap-3.5 md:grid-cols-[minmax(0,1fr)_340px] md:gap-[22px]">
        <Card className="grid gap-[18px]">
          <TypePicker type={draft.type} onChange={(type) => setDraft((d) => changeType(d, type, base))} />

          <div className="grid gap-3.5 sm:grid-cols-3">
            <Field id="tx-account" label="บัญชี">
              <NativeSelect id="tx-account" value={draft.accountId} onChange={(e) => update({ accountId: e.target.value })}>
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

          {showsInstrument(draft) && (
            <InstrumentFields
              idPrefix="tx"
              symbolLabel={draft.type === 'interest' ? 'สัญลักษณ์ (ถ้าเป็นคูปองหุ้นกู้)' : 'สัญลักษณ์'}
              market={draft.market}
              symbol={draft.symbol}
              name={draft.instrumentName}
              assetType={draft.assetType}
              instruments={data.instruments}
              hint={symbolHint || undefined}
              onMarket={(market) => setDraft((d) => changeMarket(d, market, data.instruments))}
              onSymbol={(value) => setDraft((d) => pickSymbol(d, value, data.instruments))}
              onName={(instrumentName) => update({ instrumentName })}
              onAssetType={(assetType) => update({ assetType })}
            />
          )}

          <div className={cn('grid gap-3.5', isTrade || openingAsset ? 'grid-cols-3' : 'sm:grid-cols-2')}>
            {draft.type !== 'split' && (
              <Field id="tx-currency" label={draft.type === 'fx_convert' ? 'สกุลเงินต้นทาง' : 'สกุลเงิน'}>
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
            {usesAmountField && (
              <Field id="tx-amount" label={amountLabel(draft)}>
                <Input id="tx-amount" inputMode="decimal" value={draft.amount} onChange={(e) => update({ amount: e.target.value })} />
              </Field>
            )}
            {draft.type === 'fx_convert' && (
              <ConvertFields draft={draft} rateMissing={noRateFor === marketRateKey(draft)} update={update} />
            )}
          </div>

          {draft.type !== 'split' && draft.type !== 'opening' && <FeeTaxFields draft={draft} update={update} />}

          {draft.type === 'withdraw' && <WithdrawFields draft={draft} update={update} />}

          {needsFx && <FxRateBox draft={draft} base={base} fxMessage={fxMessage} rateSpread={rateSpread} update={update} />}

          {convert && <ConvertSummary draft={draft} summary={convert} />}

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
              <Button type="button" variant="ghost" className="ml-auto text-destructive" onClick={() => void handleDelete()}>
                <Trash2 aria-hidden />
                ลบรายการนี้
              </Button>
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
                  to={`${symbol} ${fmtNumber(preview.tx.quantity, 8)} หน่วย`}
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

import { Check, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Alert } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button, buttonVariants } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Chip, chipSelectClass } from '../../components/ui/chip'
import { Field } from '../../components/ui/field'
import { Input, NativeSelect, Textarea } from '../../components/ui/input'
import { db } from '../../db/db'
import { deleteTransaction, newId, saveTransaction, upsertInstrument } from '../../db/repo'
import { CURRENCY_OPTIONS } from '../../domain/currencies'
import { isIsoDate, todayLocal } from '../../domain/dates'
import { D, isDecimalString, type Decimal } from '../../domain/decimal'
import { fxConvertSummary, spreadPct } from '../../domain/fxConvert'
import { computeLedger, positionKey } from '../../domain/ledger'
import { ASSET_TYPES, MARKETS, instrumentKey, type AssetType, type Market, type Transaction, type TxType } from '../../domain/types'
import { useFxProvider } from '../../fx/context'
import { getFxQuote } from '../../fx/fxService'
import { cn } from '../../lib/cn'
import { previewAfterSave, type AfterSavePreview } from '../afterSave'
import { MiniRoute } from '../components/MoneyRoute'
import { PageHeader } from '../components/PageHeader'
import { fmtMoney, fmtNumber } from '../format'
import { useAppData, type AppData } from '../hooks'
import { ASSET_TYPE_LABELS, FX_SOURCE_LABELS, MARKET_LABELS, MORE_TX_TYPES, PRIMARY_TX_TYPES, TX_TYPE_LABELS } from '../labels'
import {
  applyReferenceRate,
  changeCurrency,
  changeMarket,
  changeOpeningKind,
  changeType,
  draftFromTransaction,
  draftToTransaction,
  emptyDraft,
  isOpeningAsset,
  pickSymbol,
  showsInstrument,
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

function taxYearOptions(selected: string): number[] {
  const current = new Date().getFullYear()
  const years = new Set([current, current - 1, current - 2])
  const chosen = Number.parseInt(selected, 10)
  if (Number.isInteger(chosen)) years.add(chosen)
  return [...years].sort((a, b) => b - a)
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
    note: '',
  }
}

function TotalPanel({ total, currency, base, rate }: { total: Decimal; currency: string; base: string; rate: string | null }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-2xl bg-board px-[18px] py-4 text-white">
      <div>
        <p className="text-[12.5px] text-board-muted">รวม</p>
        <p className="font-display text-[28px] font-semibold leading-tight">{fmtMoney(total, currency)}</p>
      </div>
      {rate && (
        <p className="text-[12.5px] text-board-muted">
          ≈ {fmtMoney(total.times(D(rate)), base)} ที่เรท {fmtNumber(rate, 4)}
        </p>
      )}
    </div>
  )
}

function AfterSavePanel({ preview }: { preview: AfterSavePreview }) {
  return (
    <Card className="grid gap-2.5">
      <h2 className="text-base font-semibold">หลังบันทึก</h2>
      <dl className="grid text-sm">
        {preview.rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-3 border-t border-muted py-2.5 first:border-t-0">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className={cn('text-right', row.fx && 'text-fx')}>
              {row.before} → <b className="font-semibold">{row.after}</b>
            </dd>
          </div>
        ))}
      </dl>
      {preview.warning && <Alert role="note">{preview.warning}</Alert>}
    </Card>
  )
}

function TransactionForm({ data, existing }: { data: AppData; existing?: Transaction }) {
  const navigate = useNavigate()
  const provider = useFxProvider()
  const isDesktop = useIsDesktop()
  const base = data.settings.baseCurrency
  const [draft, setDraft] = useState<Draft>(() =>
    existing ? draftFromTransaction(existing, data.instruments) : emptyDraft(data.accounts[0].id, todayLocal()),
  )
  const [errors, setErrors] = useState<string[]>([])
  const [fxMessage, setFxMessage] = useState('')
  const [savedNote, setSavedNote] = useState('')
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
        setFxMessage(`เรทกลาง ECB ${quote.rateDate}`)
        setDraft((d) => applyReferenceRate(d, quote))
      })
      .catch((error: Error) => {
        if (!cancelled) setFxMessage(error.message)
      })
    return () => {
      cancelled = true
    }
  }, [needsFx, draft.currency, draft.date, base, provider])

  useEffect(() => {
    const { type, toCurrency, currency, date } = draft
    if (type !== 'fx_convert' || !toCurrency || toCurrency === currency || !isIsoDate(date)) return
    let cancelled = false
    getFxQuote(db, provider, toCurrency, currency, date)
      .then((quote) => {
        if (!cancelled) setDraft((d) => ({ ...d, marketRate: quote.rate }))
      })
      .catch(() => {
        if (!cancelled) setDraft((d) => ({ ...d, marketRate: '' }))
      })
    return () => {
      cancelled = true
    }
  }, [draft.type, draft.toCurrency, draft.currency, draft.date, provider])

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
  const afterSave = preview.errors.length === 0 ? previewAfterSave(others, preview.tx, base, symbol) : null
  const knownSymbols = data.instruments.filter((i) => i.market === draft.market)
  const knownInstrument = symbol ? data.instruments.find((i) => i.id === instrumentKey(draft.market, symbol)) : undefined
  const held =
    showsInstrument(draft) && symbol
      ? heldLedger.positions.find((p) => p.key === positionKey(draft.accountId, instrumentKey(draft.market, symbol)))
      : undefined
  const symbolHint = [knownInstrument?.name, held && `ถืออยู่ ${fmtNumber(held.quantity, 8)} หน่วย`].filter(Boolean).join(' · ')

  async function save(addAnother: boolean) {
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
    if (tx.instrumentId) {
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
    if (!addAnother) {
      navigate('/transactions')
      return
    }
    setDraft(clearEntry)
    setErrors([])
    setSavedNote(`บันทึกแล้ว · ${TX_TYPE_LABELS[tx.type]} ${symbol}`.trim())
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void save(false)
  }

  async function handleDelete() {
    if (!existing || !window.confirm(`ลบรายการ${TX_TYPE_LABELS[existing.type]} วันที่ ${existing.date}?`)) return
    await deleteTransaction(db, existing.id)
    navigate('/transactions')
  }

  const totalPanel = total && <TotalPanel total={total} currency={draft.currency} base={base} rate={rate} />

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-3.5 md:gap-[22px]">
      <PageHeader title={existing ? 'แก้ไขรายการ' : 'บันทึกรายการ'} />
      <div className="grid items-start gap-3.5 md:grid-cols-[minmax(0,1fr)_340px] md:gap-[22px]">
        <Card className="grid gap-[18px]">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="ประเภทรายการ">
            {PRIMARY_TX_TYPES.map((type) => (
              <Chip key={type} active={draft.type === type} onClick={() => setDraft((d) => changeType(d, type, base))}>
                {TX_TYPE_LABELS[type]}
              </Chip>
            ))}
            <NativeSelect
              aria-label="ประเภทอื่นๆ"
              className={cn(chipSelectClass, MORE_TX_TYPES.includes(draft.type) && 'border-foreground bg-foreground text-white')}
              value={MORE_TX_TYPES.includes(draft.type) ? draft.type : ''}
              onChange={(e) => {
                const type = e.target.value as TxType
                if (type) setDraft((d) => changeType(d, type, base))
              }}
            >
              <option value="">เพิ่มเติม…</option>
              {MORE_TX_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TX_TYPE_LABELS[type]}
                </option>
              ))}
            </NativeSelect>
          </div>

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
              <Input id="tx-date" type="date" value={draft.date} max={todayLocal()} onChange={(e) => update({ date: e.target.value })} />
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
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field id="tx-market" label="ตลาด">
                <NativeSelect
                  id="tx-market"
                  value={draft.market}
                  onChange={(e) => setDraft((d) => changeMarket(d, e.target.value as Market, data.instruments))}
                >
                  {MARKETS.map((m) => (
                    <option key={m} value={m}>
                      {MARKET_LABELS[m]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                id="tx-symbol"
                label={draft.type === 'interest' ? 'สัญลักษณ์ (ถ้าเป็นคูปองหุ้นกู้)' : 'สัญลักษณ์'}
                hint={symbolHint || undefined}
              >
                <Input
                  id="tx-symbol"
                  list="known-symbols"
                  autoCapitalize="characters"
                  placeholder="AAPL, PTT, BTC"
                  value={draft.symbol}
                  onChange={(e) => setDraft((d) => pickSymbol(d, e.target.value, data.instruments))}
                />
                <datalist id="known-symbols">
                  {knownSymbols.map((i) => (
                    <option key={i.id} value={i.symbol}>
                      {i.name}
                    </option>
                  ))}
                </datalist>
              </Field>
              {!knownInstrument && (
                <>
                  <Field id="tx-name" label="ชื่อ (ไม่บังคับ)">
                    <Input id="tx-name" value={draft.instrumentName} onChange={(e) => update({ instrumentName: e.target.value })} />
                  </Field>
                  <Field id="tx-asset-type" label="ประเภทสินทรัพย์">
                    <NativeSelect
                      id="tx-asset-type"
                      value={draft.assetType}
                      onChange={(e) => update({ assetType: e.target.value as AssetType })}
                    >
                      {ASSET_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {ASSET_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                </>
              )}
            </div>
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
              <>
                <Field id="tx-to-currency" label="สกุลเงินปลายทาง">
                  <NativeSelect
                    id="tx-to-currency"
                    value={draft.toCurrency}
                    onChange={(e) => update({ toCurrency: e.target.value, marketRate: '' })}
                  >
                    {CURRENCY_OPTIONS.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field id="tx-to-amount" label="จำนวนที่ได้รับ">
                  <Input id="tx-to-amount" inputMode="decimal" value={draft.toAmount} onChange={(e) => update({ toAmount: e.target.value })} />
                </Field>
              </>
            )}
          </div>

          {draft.type !== 'split' && draft.type !== 'opening' && (
            <div className="grid grid-cols-2 gap-3.5">
              <Field id="tx-fees" label="ค่าธรรมเนียม">
                <Input id="tx-fees" inputMode="decimal" placeholder="0" value={draft.fees} onChange={(e) => update({ fees: e.target.value })} />
              </Field>
              {draft.type !== 'fx_convert' && draft.type !== 'deposit' && (
                <Field id="tx-tax" label={draft.type === 'dividend' || draft.type === 'interest' ? 'ภาษีหัก ณ ที่จ่าย' : 'ภาษี / VAT'}>
                  <Input id="tx-tax" inputMode="decimal" placeholder="0" value={draft.tax} onChange={(e) => update({ tax: e.target.value })} />
                </Field>
              )}
            </div>
          )}

          {draft.type === 'withdraw' && (
            <div className="grid gap-3 rounded-2xl border p-4">
              <label className="flex min-h-11 items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={draft.remitToThailand}
                  onChange={(e) => update({ remitToThailand: e.target.checked })}
                />
                โอนกลับเข้าไทย (ใช้คิดภาษีเงินได้จากต่างประเทศ)
              </label>
              {draft.remitToThailand && (
                <Field id="tx-tax-year" label="ปีภาษี">
                  <NativeSelect id="tx-tax-year" className="max-w-56" value={draft.taxYear} onChange={(e) => update({ taxYear: e.target.value })}>
                    {taxYearOptions(draft.taxYear).map((year) => (
                      <option key={year} value={year}>{`พ.ศ. ${year + 543} (${year})`}</option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            </div>
          )}

          {needsFx && (
            <div className="grid gap-2 rounded-2xl bg-fx-soft px-[18px] py-4">
              <Field
                id="tx-fx"
                label={`${openingAsset ? 'เรทเฉลี่ยตอนซื้อ' : 'เรทแลกเปลี่ยน'} (1 ${draft.currency} = ? ${base})`}
              >
                <Input
                  id="tx-fx"
                  inputMode="decimal"
                  className="border-fx-line"
                  value={draft.fxRate}
                  onChange={(e) => update({ fxRate: e.target.value, fxSource: 'manual' })}
                />
              </Field>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-fx">
                {draft.fxRate && draft.fxSource !== 'same' && <Badge variant={draft.fxSource}>{FX_SOURCE_LABELS[draft.fxSource]}</Badge>}
                <p>
                  {[
                    fxMessage,
                    rateSpread && !rateSpread.isZero()
                      ? `${rateSpread.greaterThan(0) ? 'สูงกว่า' : 'ต่ำกว่า'}เรทกลาง ${fmtNumber(rateSpread.abs())}%`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              {draft.referenceFxRate && draft.fxRate !== draft.referenceFxRate && (
                <button
                  type="button"
                  className="justify-self-start text-[13px] font-semibold text-fx underline underline-offset-[3px]"
                  onClick={() => update({ fxRate: draft.referenceFxRate, fxSource: openingAsset ? 'estimated' : 'auto' })}
                >
                  {openingAsset
                    ? `ใช้เรทกลาง ${draft.referenceFxRate} เป็นค่าประมาณ`
                    : `กลับไปใช้เรทกลาง ${draft.referenceFxRate}`}
                </button>
              )}
            </div>
          )}

          {convert && (
            <p className="rounded-2xl bg-fx-soft px-[18px] py-3 text-[13px] text-fx">
              เรทที่ได้ 1 {draft.toCurrency} = {fmtNumber(convert.effectiveRate, 4)} {draft.currency}
              {convert.marketRate && ` · เรทตลาด ${fmtNumber(convert.marketRate, 4)}`}
              {convert.spreadPct &&
                ` · ${convert.spreadPct.greaterThan(0) ? 'แพงกว่า' : 'ถูกกว่า'}ตลาด ${fmtNumber(convert.spreadPct.abs())}%`}
            </p>
          )}

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
          {savedNote && (
            <p role="status" className="text-sm font-semibold text-gain">
              {savedNote}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit">
              <Check aria-hidden />
              บันทึก
            </Button>
            {!existing && (
              <Button type="button" variant="outline" onClick={() => void save(true)}>
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
                  via={`แลกที่ ${fmtNumber(rate, 4)}`}
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

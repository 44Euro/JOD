import type { ReactNode } from 'react'
import { Field } from '../../../components/ui/field'
import { Input, NativeSelect } from '../../../components/ui/input'
import { CURRENCY_OPTIONS, USD_PEGGED } from '../../../domain/currencies'
import type { FxConvertSummary } from '../../../domain/fxConvert'
import { fmtAmount, fmtDate, fmtPrice } from '../../format'
import { spreadText } from '../../fxText'
import { receivedAmount, type Draft } from '../../transactionDraft'
import { t } from '../../../i18n'

function receivedHint(draft: Draft, computed: string | null, rateMissing: boolean, restoreComputed: () => void): ReactNode {
  if (!draft.marketRate) return rateMissing ? t('ไม่มีเรทกลางของวันนั้น กรอกจำนวนที่ได้รับเอง') : undefined
  if (draft.toAmountSource === 'auto') {
    const borrowed = [draft.currency, draft.toCurrency].some((currency) => USD_PEGGED.includes(currency))
    return t('คำนวณจากเรทกลาง ECB {0}{1} · 1 {2} = {3} {4} · แก้เป็นยอดจริงจากโบรกได้', fmtDate(draft.marketRateDate), borrowed ? t(' · ใช้เรท USD') : '', draft.toCurrency, fmtPrice(draft.marketRate), draft.currency)
  }
  return (
    computed && (
      <button
        type="button"
        className="inline-flex min-h-11 items-center text-[13px] font-semibold text-fx underline underline-offset-[3px] md:min-h-0"
        onClick={restoreComputed}
      >
        
        {t('ใช้ยอดคำนวณ ')}{fmtAmount(computed)}
      </button>
    )
  )
}

export function ConvertFields({
  draft,
  rateMissing,
  update,
}: {
  draft: Draft
  rateMissing: boolean
  update(patch: Partial<Draft>): void
}) {
  return (
    <>
      <Field id="tx-to-currency" label={t('สกุลเงินปลายทาง')}>
        <NativeSelect
          id="tx-to-currency"
          value={draft.toCurrency}
          onChange={(e) => update({ toCurrency: e.target.value, marketRate: '', marketRateDate: '' })}
        >
          {CURRENCY_OPTIONS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </NativeSelect>
      </Field>
      <Field
        id="tx-to-amount"
        label={t('จำนวนที่ได้รับ')}
        hint={receivedHint(draft, receivedAmount(draft), rateMissing, () => update({ toAmountSource: 'auto' }))}
      >
        <Input
          id="tx-to-amount"
          inputMode="decimal"
          value={draft.toAmount}
          onChange={(e) => update({ toAmount: e.target.value, toAmountSource: 'manual' })}
        />
      </Field>
    </>
  )
}

export function ConvertSummary({ draft, summary }: { draft: Draft; summary: FxConvertSummary }) {
  return (
    <p className="rounded-2xl bg-fx-soft px-[18px] py-3 text-[13px] text-fx">
      
      {t('เรทที่ได้ 1 ')}{draft.toCurrency} = {fmtPrice(summary.effectiveRate)} {draft.currency}
      {summary.marketRate && t(' · เรทตลาด {0}', fmtPrice(summary.marketRate))}
      {summary.spreadPct && ` · ${spreadText(summary.spreadPct)}`}
    </p>
  )
}

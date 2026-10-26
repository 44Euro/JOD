import { Badge } from '../../../components/ui/badge'
import { Field } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { USD_PEGGED } from '../../../domain/currencies'
import type { Decimal } from '../../../domain/decimal'
import { fmtPct } from '../../format'
import { FX_SOURCE_LABELS } from '../../labels'
import { isOpeningAsset, type Draft } from '../../transactionDraft'
import { t } from '../../../i18n'

export function FxRateBox({
  draft,
  base,
  fxMessage,
  rateSpread,
  update,
}: {
  draft: Draft
  base: string
  fxMessage: string
  rateSpread: Decimal | null
  update(patch: Partial<Draft>): void
}) {
  const openingAsset = isOpeningAsset(draft)
  const estimates = openingAsset || USD_PEGGED.includes(draft.currency)
  const baseWord = base === 'THB' ? t('บาท') : ` ${base} `
  return (
    <div className="grid gap-2 rounded-2xl bg-fx-soft px-[18px] py-4">
      <Field
        id="tx-fx"
        label={`${openingAsset ? t('เรทเฉลี่ยตอนซื้อ') : t('เรทแลกเปลี่ยน')} (1 ${draft.currency} = ? ${base})`}
        hint={draft.type === 'transfer' ? t('ใช้คิดค่าธรรมเนียมการโอนเป็น{0}เท่านั้น', baseWord) : undefined}
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
            rateSpread && !rateSpread.isZero() ? t('{0}เรทกลาง {1}', rateSpread.greaterThan(0) ? t('สูงกว่า') : t('ต่ำกว่า'), fmtPct(rateSpread.abs())) : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      {draft.referenceFxRate && draft.fxRate !== draft.referenceFxRate && (
        <button
          type="button"
          className="-my-3 inline-flex min-h-11 items-center justify-self-start text-[13px] leading-5 font-semibold text-fx underline underline-offset-[3px] md:my-0 md:min-h-0"
          onClick={() => update({ fxRate: draft.referenceFxRate, fxSource: estimates ? 'estimated' : 'auto' })}
        >
          {openingAsset ? t('ใช้เรทกลาง {0} เป็นค่าประมาณ', draft.referenceFxRate) : t('กลับไปใช้เรทกลาง {0}', draft.referenceFxRate)}
        </button>
      )}
    </div>
  )
}

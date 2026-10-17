import { Badge } from '../../../components/ui/badge'
import { Field } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import type { Decimal } from '../../../domain/decimal'
import { fmtNumber } from '../../format'
import { FX_SOURCE_LABELS } from '../../labels'
import { isOpeningAsset, type Draft } from '../../transactionDraft'

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
  return (
    <div className="grid gap-2 rounded-2xl bg-fx-soft px-[18px] py-4">
      <Field id="tx-fx" label={`${openingAsset ? 'เรทเฉลี่ยตอนซื้อ' : 'เรทแลกเปลี่ยน'} (1 ${draft.currency} = ? ${base})`}>
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
            rateSpread && !rateSpread.isZero() ? `${rateSpread.greaterThan(0) ? 'สูงกว่า' : 'ต่ำกว่า'}เรทกลาง ${fmtNumber(rateSpread.abs())}%` : '',
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
          {openingAsset ? `ใช้เรทกลาง ${draft.referenceFxRate} เป็นค่าประมาณ` : `กลับไปใช้เรทกลาง ${draft.referenceFxRate}`}
        </button>
      )}
    </div>
  )
}

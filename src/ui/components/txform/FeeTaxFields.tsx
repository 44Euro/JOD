import { Field } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import type { Draft } from '../../transactionDraft'

export function FeeTaxFields({ draft, update }: { draft: Draft; update(patch: Partial<Draft>): void }) {
  return (
    <div className="grid grid-cols-2 gap-3.5">
      <Field id="tx-fees" label={draft.type === 'fx_convert' ? 'ค่าธรรมเนียม (หักจากยอดที่แลก)' : 'ค่าธรรมเนียม'}>
        <Input id="tx-fees" inputMode="decimal" placeholder="0" value={draft.fees} onChange={(e) => update({ fees: e.target.value })} />
      </Field>
      {draft.type !== 'fx_convert' && draft.type !== 'deposit' && (
        <Field id="tx-tax" label={draft.type === 'dividend' || draft.type === 'interest' ? 'ภาษีหัก ณ ที่จ่าย' : 'ภาษี / VAT'}>
          <Input id="tx-tax" inputMode="decimal" placeholder="0" value={draft.tax} onChange={(e) => update({ tax: e.target.value })} />
        </Field>
      )}
    </div>
  )
}

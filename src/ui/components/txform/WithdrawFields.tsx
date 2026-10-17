import { Field } from '../../../components/ui/field'
import { NativeSelect } from '../../../components/ui/input'
import type { Draft } from '../../transactionDraft'

function taxYearOptions(selected: string): number[] {
  const current = new Date().getFullYear()
  const years = new Set([current, current - 1, current - 2])
  const chosen = Number.parseInt(selected, 10)
  if (Number.isInteger(chosen)) years.add(chosen)
  return [...years].sort((a, b) => b - a)
}

export function WithdrawFields({ draft, update }: { draft: Draft; update(patch: Partial<Draft>): void }) {
  return (
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
  )
}

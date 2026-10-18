import { Field } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { D } from '../../../domain/decimal'
import { cashDeltaQuote } from '../../../domain/ledger'
import type { Transaction } from '../../../domain/types'
import { fmtMoney, fmtNumber, fmtPrice } from '../../format'
import type { Draft } from '../../transactionDraft'

function ReinvestSummary({ dividend, buy }: { dividend: Transaction; buy: Transaction }) {
  const fees = D(buy.fees)
  const left = cashDeltaQuote(dividend).plus(cashDeltaQuote(buy))
  return (
    <p className="rounded-2xl bg-muted px-[18px] py-3 text-[13px]">
      ซื้อ {fmtNumber(buy.quantity, 8)} × {fmtPrice(buy.price)} = {fmtMoney(D(buy.quantity).times(D(buy.price)), buy.currency)}
      {fees.greaterThan(0) && ` + ค่าธรรมเนียม ${fmtMoney(fees, buy.currency)}`}
      {left.isNegative()
        ? ` · ใช้เงินสดเพิ่ม ${fmtMoney(left.abs(), buy.currency)}`
        : ` · เหลือเงินสด ${fmtMoney(left, buy.currency)}`}
    </p>
  )
}

export function ReinvestFields({
  draft,
  plan,
  update,
}: {
  draft: Draft
  plan: { dividend: Transaction; buy: Transaction } | null
  update(patch: Partial<Draft>): void
}) {
  return (
    <div className="grid gap-3 rounded-2xl border p-4">
      <label className="flex min-h-11 items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          className="size-5 accent-primary"
          checked={draft.reinvest}
          onChange={(e) => update({ reinvest: e.target.checked })}
        />
        นำปันผลไปซื้อหุ้นนี้ต่อ (บันทึก 2 รายการ)
      </label>
      {draft.reinvest && (
        <>
          <div className="grid gap-3.5 sm:grid-cols-3">
            <Field id="tx-reinvest-quantity" label="จำนวนหน่วยที่ซื้อ">
              <Input
                id="tx-reinvest-quantity"
                inputMode="decimal"
                value={draft.reinvestQuantity}
                onChange={(e) => update({ reinvestQuantity: e.target.value })}
              />
            </Field>
            <Field id="tx-reinvest-price" label="ราคาต่อหน่วย">
              <Input
                id="tx-reinvest-price"
                inputMode="decimal"
                value={draft.reinvestPrice}
                onChange={(e) => update({ reinvestPrice: e.target.value })}
              />
            </Field>
            <Field id="tx-reinvest-fees" label="ค่าธรรมเนียมซื้อ">
              <Input
                id="tx-reinvest-fees"
                inputMode="decimal"
                placeholder="0"
                value={draft.reinvestFees}
                onChange={(e) => update({ reinvestFees: e.target.value })}
              />
            </Field>
          </div>
          {plan && <ReinvestSummary {...plan} />}
        </>
      )}
    </div>
  )
}

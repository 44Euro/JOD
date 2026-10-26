import { Link } from 'react-router'
import { Alert } from '../../../components/ui/alert'
import { Chip } from '../../../components/ui/chip'
import { Field } from '../../../components/ui/field'
import { Input, NativeSelect } from '../../../components/ui/input'
import { CURRENCY_OPTIONS } from '../../../domain/currencies'
import type { Account } from '../../../domain/types'
import type { Draft } from '../../transactionDraft'
import { t } from '../../../i18n'

export function TransferFields({
  draft,
  accounts,
  update,
}: {
  draft: Draft
  accounts: readonly Account[]
  update(patch: Partial<Draft>): void
}) {
  const targets = accounts.filter((a) => a.id !== draft.accountId)
  return (
    <>
      {targets.length === 0 ? (
        <Alert role="note">
          {t('ต้องมีอย่างน้อย 2 บัญชีจึงจะโอนได้ · ')}<Link to="/settings">{t('เพิ่มบัญชีในหน้าตั้งค่า')}</Link>
        </Alert>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-3">
          <Field id="tx-to-account" label={t('บัญชีปลายทาง')}>
            <NativeSelect id="tx-to-account" value={draft.toAccountId} onChange={(e) => update({ toAccountId: e.target.value })}>
              {targets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      )}
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('โอนอะไร')}>
        <Chip active={draft.transferKind === 'asset'} onClick={() => update({ transferKind: 'asset' })}>
          {t('สินทรัพย์')}
        </Chip>
        <Chip active={draft.transferKind === 'cash'} onClick={() => update({ transferKind: 'cash' })}>
          {t('เงินสด')}
        </Chip>
      </div>
    </>
  )
}

export function TransferAmountField({ draft, update }: { draft: Draft; update(patch: Partial<Draft>): void }) {
  if (draft.transferKind === 'cash') {
    return (
      <Field id="tx-amount" label={t('จำนวนเงินที่โอน')}>
        <Input id="tx-amount" inputMode="decimal" value={draft.amount} onChange={(e) => update({ amount: e.target.value })} />
      </Field>
    )
  }
  return (
    <Field id="tx-quantity" label={t('จำนวนหน่วยที่โอน')}>
      <Input id="tx-quantity" inputMode="decimal" value={draft.quantity} onChange={(e) => update({ quantity: e.target.value })} />
    </Field>
  )
}

// Shown when a holding moves: the destination can count it in another currency, as a coin moved from a baht exchange
// to one that trades in USDT. The baht cost moves whole; this rate only re-counts it in the new currency.
export function MoveCurrencyFields({
  draft,
  heldCurrency,
  base,
  update,
}: {
  draft: Draft
  heldCurrency: string
  base: string
  update(patch: Partial<Draft>): void
}) {
  const target = draft.moveCurrency || heldCurrency
  const options = [heldCurrency, ...CURRENCY_OPTIONS.filter((c) => c !== heldCurrency)]
  function pick(currency: string) {
    if (currency === heldCurrency) update({ moveCurrency: '', moveRate: '' })
    else update({ moveCurrency: currency, moveRate: currency === base ? '1' : '' })
  }
  return (
    <div className="grid gap-3.5 sm:grid-cols-2">
      <Field
        id="tx-move-currency"
        label={t('สกุลที่ถือในบัญชีปลายทาง')}
        hint={target === heldCurrency ? t('ถือเป็น {0} เหมือนเดิม', heldCurrency) : t('ต้นทุนเป็น{0}ย้ายไปเท่าเดิม แล้วนับเป็น {1}', base === 'THB' ? t('บาท') : base, target)}
      >
        <NativeSelect id="tx-move-currency" value={target} onChange={(e) => pick(e.target.value)}>
          {options.map((c) => (
            <option key={c} value={c}>
              {c === heldCurrency ? t('{0} (เดิม)', c) : c}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {target !== heldCurrency && target !== base && (
        <Field id="tx-move-rate" label={t('เรท 1 {0} = ? {1}', target, base)}>
          <Input id="tx-move-rate" inputMode="decimal" value={draft.moveRate} onChange={(e) => update({ moveRate: e.target.value })} />
        </Field>
      )}
    </div>
  )
}

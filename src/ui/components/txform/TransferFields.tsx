import { Link } from 'react-router'
import { Alert } from '../../../components/ui/alert'
import { Chip } from '../../../components/ui/chip'
import { Field } from '../../../components/ui/field'
import { Input, NativeSelect } from '../../../components/ui/input'
import type { Account } from '../../../domain/types'
import type { Draft } from '../../transactionDraft'

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
          ต้องมีอย่างน้อย 2 บัญชีจึงจะโอนได้ · <Link to="/settings">เพิ่มบัญชีในหน้าตั้งค่า</Link>
        </Alert>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-3">
          <Field id="tx-to-account" label="บัญชีปลายทาง">
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
      <div className="flex flex-wrap gap-2" role="group" aria-label="โอนอะไร">
        <Chip active={draft.transferKind === 'asset'} onClick={() => update({ transferKind: 'asset' })}>
          สินทรัพย์
        </Chip>
        <Chip active={draft.transferKind === 'cash'} onClick={() => update({ transferKind: 'cash' })}>
          เงินสด
        </Chip>
      </div>
    </>
  )
}

export function TransferAmountField({ draft, update }: { draft: Draft; update(patch: Partial<Draft>): void }) {
  if (draft.transferKind === 'cash') {
    return (
      <Field id="tx-amount" label="จำนวนเงินที่โอน">
        <Input id="tx-amount" inputMode="decimal" value={draft.amount} onChange={(e) => update({ amount: e.target.value })} />
      </Field>
    )
  }
  return (
    <Field id="tx-quantity" label="จำนวนหน่วยที่โอน">
      <Input id="tx-quantity" inputMode="decimal" value={draft.quantity} onChange={(e) => update({ quantity: e.target.value })} />
    </Field>
  )
}

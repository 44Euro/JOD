import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Field } from '../../components/ui/field'
import { Input, NativeSelect } from '../../components/ui/input'
import { db } from '../../db/db'
import { updateAccount } from '../../db/repo'
import { CURRENCY_OPTIONS } from '../../domain/currencies'
import { parseDecimalInput } from '../../domain/decimal'
import type { Account } from '../../domain/types'

// Unreadable input is kept as typed so validation reports it once.
const number = (raw: string) => parseDecimalInput(raw) ?? raw.trim()

export function AccountEditor({ account, onDone }: { account: Account; onDone(): void }) {
  const stored = account.feeTemplate
  const [name, setName] = useState(account.name)
  const [broker, setBroker] = useState(account.broker)
  const [hasFormula, setHasFormula] = useState(stored !== undefined)
  const [currency, setCurrency] = useState(stored?.currency ?? 'THB')
  const [commissionPct, setCommissionPct] = useState(stored?.commissionPct ?? '')
  const [minimum, setMinimum] = useState(stored?.minimum ?? '')
  const [vatPct, setVatPct] = useState(stored?.vatPct ?? '')
  const [perOrder, setPerOrder] = useState(stored?.perOrder ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const nameInput = useRef<HTMLInputElement>(null)
  const currencies = CURRENCY_OPTIONS.includes(currency) ? CURRENCY_OPTIONS : [currency, ...CURRENCY_OPTIONS]

  useEffect(() => {
    nameInput.current?.focus()
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      await updateAccount(db, account.id, {
        name,
        broker,
        note: account.note,
        feeTemplate: hasFormula
          ? {
              currency,
              commissionPct: number(commissionPct),
              minimum: number(minimum),
              vatPct: number(vatPct),
              perOrder: number(perOrder),
            }
          : undefined,
      })
      onDone()
    } catch (failure) {
      setError((failure as Error).message)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label={`แก้ไข ${account.name}`} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="edit-account-name" label="ชื่อบัญชี">
          <Input id="edit-account-name" ref={nameInput} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="edit-account-broker" label="โบรกเกอร์">
          <Input id="edit-account-broker" value={broker} onChange={(e) => setBroker(e.target.value)} />
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-2.5 text-sm">
        <input type="checkbox" className="size-5 accent-primary" checked={hasFormula} onChange={(e) => setHasFormula(e.target.checked)} />
        บัญชีนี้มีค่าคอมซื้อขาย
      </label>
      {hasFormula && (
        <div className="grid gap-3 rounded-2xl border p-4 sm:grid-cols-2">
          <Field id="edit-fee-currency" label="สกุลของสูตร">
            <NativeSelect id="edit-fee-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="edit-fee-commission" label="ค่าคอม (%)">
            <Input id="edit-fee-commission" inputMode="decimal" placeholder="0" value={commissionPct} onChange={(e) => setCommissionPct(e.target.value)} />
          </Field>
          <Field id="edit-fee-minimum" label="ขั้นต่ำต่อคำสั่ง">
            <Input id="edit-fee-minimum" inputMode="decimal" placeholder="0" value={minimum} onChange={(e) => setMinimum(e.target.value)} />
          </Field>
          <Field id="edit-fee-vat" label="VAT (%)">
            <Input id="edit-fee-vat" inputMode="decimal" placeholder="0" value={vatPct} onChange={(e) => setVatPct(e.target.value)} />
          </Field>
          <Field id="edit-fee-per-order" label="ค่าธรรมเนียมต่อคำสั่ง">
            <Input id="edit-fee-per-order" inputMode="decimal" placeholder="0" value={perOrder} onChange={(e) => setPerOrder(e.target.value)} />
          </Field>
        </div>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving}>
          บันทึก
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          ยกเลิก
        </Button>
      </div>
    </form>
  )
}

import { Lock, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { Input, NativeSelect } from '../../components/ui/input'
import { db } from '../../db/db'
import { addAccount, deleteAccount, saveSettings } from '../../db/repo'
import { AUTO_FX_CURRENCIES } from '../../domain/currencies'
import { PageHeader } from '../components/PageHeader'
import { useAppData } from '../hooks'

export function SettingsPage() {
  const data = useAppData()
  const [name, setName] = useState('')
  const [broker, setBroker] = useState('')
  const [message, setMessage] = useState('')

  if (!data) return <p className="text-muted-foreground">กำลังโหลด…</p>
  const hasTransactions = data.transactions.length > 0

  async function handleAddAccount(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    await addAccount(db, { name: name.trim(), broker: broker.trim(), note: '' })
    setName('')
    setBroker('')
  }

  async function handleDeleteAccount(id: string) {
    try {
      await deleteAccount(db, id)
      setMessage('')
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  return (
    <>
      <PageHeader title="ตั้งค่า" />
      <div className="grid items-start gap-3.5 md:grid-cols-2 md:gap-[22px]">
        <div className="grid content-start gap-3.5 md:gap-4">
          <Card className="grid gap-3">
            <h2 className="text-lg font-semibold">สกุลเงินหลักของพอร์ต</h2>
            <Field
              id="base-currency"
              label="สกุลเงินหลัก"
              hint={
                hasTransactions ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Lock className="size-3.5 shrink-0" aria-hidden />
                    เปลี่ยนไม่ได้หลังมีรายการแล้ว เพราะเรทที่บันทึกไว้ทุกรายการอิงกับสกุลเงินนี้
                  </span>
                ) : (
                  'เลือกครั้งเดียวก่อนเริ่มบันทึก ตัวเลขทั้งแอปจะแสดงเป็นสกุลนี้'
                )
              }
            >
              <NativeSelect
                id="base-currency"
                className="max-w-[220px]"
                value={data.settings.baseCurrency}
                disabled={hasTransactions}
                onChange={(e) => void saveSettings(db, { ...data.settings, baseCurrency: e.target.value })}
              >
                {AUTO_FX_CURRENCIES.map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </NativeSelect>
            </Field>
          </Card>

          <Card className="grid gap-3">
            <h2 className="text-lg font-semibold">บัญชีและโบรกเกอร์</h2>
            {message && <Alert tone="error">{message}</Alert>}
            {data.accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">ยังไม่มีบัญชี เพิ่มบัญชีแรกด้านล่าง</p>
            ) : (
              <ul>
                {data.accounts.map((account) => (
                  <li key={account.id} className="flex items-center justify-between gap-2 border-t border-muted py-3 first:border-t-0">
                    <span className="min-w-0">
                      <b className="block font-display text-base font-semibold">{account.name}</b>
                      {account.broker && <span className="text-[12.5px] text-muted-foreground">{account.broker}</span>}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`ลบ ${account.name}`}
                      onClick={() => void handleDeleteAccount(account.id)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={handleAddAccount} className="grid gap-3 border-t pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field id="account-name" label="ชื่อบัญชี">
                <Input id="account-name" value={name} placeholder="Dime US" onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field id="account-broker" label="โบรกเกอร์">
                <Input id="account-broker" value={broker} placeholder="Dime" onChange={(e) => setBroker(e.target.value)} />
              </Field>
              <Button type="submit" className="h-[46px]">
                เพิ่มบัญชี
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </>
  )
}

import { Lock, Pencil, Trash2 } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { Input, NativeSelect } from '../../components/ui/input'
import { Switch } from '../../components/ui/switch'
import { db } from '../../db/db'
import { addAccount, deleteAccount, saveSettings } from '../../db/repo'
import { AUTO_FX_CURRENCIES } from '../../domain/currencies'
import { THEME_CHOICES, type FeeTemplate } from '../../domain/types'
import { Segmented } from '../../components/ui/segmented'
import { THEME_LABELS } from '../theme'
import { AccountEditor } from '../components/AccountEditor'
import { AiKeyCard } from '../components/AiKeyCard'
import { ErrorReportCard } from '../components/ErrorReportCard'
import { LockCard } from '../components/LockCard'
import { PriceSourcesCard } from '../components/PriceSourcesCard'
import { SyncCard } from '../components/SyncCard'
import { DataSection } from '../components/DataSection'
import { PageHeader } from '../components/PageHeader'
import { feeTemplateParts } from '../feeTemplateText'
import { useAppData } from '../hooks'
import { chooseLanguage, language, t } from '../../i18n'

function FeeTemplateLine({ template }: { template: FeeTemplate }) {
  const { body, minimum } = feeTemplateParts(template)
  return (
    <span className="text-[12.5px] text-muted-foreground">
      {body}
      {minimum && (
        <>
          {' '}
          <span className="whitespace-nowrap">{minimum}</span>
        </>
      )}
    </span>
  )
}

export function SettingsPage() {
  const data = useAppData()
  const [name, setName] = useState('')
  const [broker, setBroker] = useState('')
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const refocusId = useRef<string | null>(null)

  if (!data) return <p className="text-muted-foreground">{t('กำลังโหลด…')}</p>
  const hasTransactions = data.transactions.length > 0

  async function handleAddAccount(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    await addAccount(db, { name: name.trim(), broker: broker.trim(), note: '' })
    setName('')
    setBroker('')
  }

  function closeEditor(id: string) {
    refocusId.current = id
    setEditingId(null)
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
      <PageHeader title={t('ตั้งค่า')} />
      <div className="grid items-start gap-3.5 md:gap-[22px] lg:grid-cols-2">
        <div className="grid content-start gap-3.5 md:gap-4">
          <Card className="grid gap-3">
            <h2 className="text-lg font-semibold">{t('สกุลเงินหลักของพอร์ต')}</h2>
            <Field
              id="base-currency"
              label={t('สกุลเงินหลัก')}
              hint={
                hasTransactions ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Lock className="size-3.5 shrink-0" aria-hidden />
                    
                    {t('เปลี่ยนไม่ได้หลังมีรายการแล้ว เพราะเรทที่บันทึกไว้ทุกรายการอิงกับสกุลเงินนี้')}
                  </span>
                ) : (
                  t('เลือกครั้งเดียวก่อนเริ่มบันทึก ตัวเลขทั้งแอปจะแสดงเป็นสกุลนี้')
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
            <h2 className="text-lg font-semibold">{t('บัญชีและโบรกเกอร์')}</h2>
            {message && <Alert tone="error">{message}</Alert>}
            {data.accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('ยังไม่มีบัญชี เพิ่มบัญชีแรกด้านล่าง')}</p>
            ) : (
              <ul>
                {data.accounts.map((account) => (
                  <li key={account.id} className="border-t border-muted py-3 first:border-t-0">
                    {editingId === account.id ? (
                      <AccountEditor account={account} onDone={() => closeEditor(account.id)} />
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0">
                          <b className="block font-display text-base font-semibold">{account.name}</b>
                          {account.feeTemplate ? (
                            <FeeTemplateLine template={account.feeTemplate} />
                          ) : (
                            account.broker && <span className="text-[12.5px] text-muted-foreground">{account.broker}</span>
                          )}
                        </span>
                        <span className="flex shrink-0">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('แก้ไข {0}', account.name)}
                            ref={(button) => {
                              if (button && refocusId.current === account.id) {
                                refocusId.current = null
                                button.focus()
                              }
                            }}
                            onClick={() => setEditingId(account.id)}
                          >
                            <Pencil aria-hidden />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('ลบ {0}', account.name)}
                            onClick={() => void handleDeleteAccount(account.id)}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={handleAddAccount} className="grid gap-3 border-t pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field id="account-name" label={t('ชื่อบัญชี')}>
                <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field id="account-broker" label={t('โบรกเกอร์')}>
                <Input id="account-broker" value={broker} onChange={(e) => setBroker(e.target.value)} />
              </Field>
              <Button type="submit" className="h-[46px]">
                
                {t('เพิ่มบัญชี')}
              </Button>
            </form>
          </Card>
        </div>
        <div className="grid content-start gap-3.5 md:gap-4">
          <DataSection data={data} />

          <SyncCard />

          <AiKeyCard />

          <PriceSourcesCard settings={data.settings} />

          <Card className="grid gap-3">
            <h2 className="text-lg font-semibold">{t('ภาษา · Language')}</h2>
            <Segmented
              label={t('ภาษา · Language')}
              options={[
                { value: 'th' as const, label: t('ไทย') },
                { value: 'en' as const, label: 'English' },
              ]}
              value={language()}
              onChange={chooseLanguage}
            />
          </Card>

          <Card className="grid gap-3">
            <h2 className="text-lg font-semibold">{t('ธีม')}</h2>
            <Segmented
              label={t('ธีม')}
              options={THEME_CHOICES.map((value) => ({ value, label: THEME_LABELS[value] }))}
              value={data.settings.theme ?? 'system'}
              onChange={(theme) => void saveSettings(db, { ...data.settings, theme })}
            />
          </Card>

          <LockCard />

          <ErrorReportCard />

          <Card className="grid gap-3">
            <h2 className="text-lg font-semibold">{t('ความเป็นส่วนตัว')}</h2>
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span id="hide-numbers-label" className="block">
                  
                  {t('ซ่อนตัวเลขทุกครั้งที่เปิดแอป')}
                </span>
                <span id="hide-numbers-hint" className="block text-[12.5px] text-muted-foreground">
                  
                  {t('แสดงเป็น ••• จนกว่าจะแตะรูปตา')}
                </span>
              </span>
              <Switch
                checked={data.settings.hideNumbersOnLaunch === true}
                aria-labelledby="hide-numbers-label"
                aria-describedby="hide-numbers-hint"
                onCheckedChange={(hide) => void saveSettings(db, { ...data.settings, hideNumbersOnLaunch: hide })}
              />
            </div>
            <Link to="/privacy" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-ink underline underline-offset-[3px]">
              
              {t('อ่านนโยบายความเป็นส่วนตัว')}
            </Link>
          </Card>
        </div>
      </div>
    </>
  )
}

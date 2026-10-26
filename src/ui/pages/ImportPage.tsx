import { Crop, FileText, ImagePlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { providerReady, useProviderSettings, useReaderMode } from '../../ai/apiKey'
import type { Extraction } from '../../ai/extraction'
import { estimateCost, FileError, prepareFile, type PreparedFile } from '../../ai/files'
import { describeAiError, isAbort, useReaderFactory } from '../../ai/reader'
import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { buttonVariants } from '../../components/ui/button-variants'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { NativeSelect } from '../../components/ui/input'
import { Segmented } from '../../components/ui/segmented'
import { db } from '../../db/db'
import { todayLocal } from '../../domain/dates'
import { peekCachedQuote } from '../../fx/fxService'
import { cn } from '../../lib/cn'
import { ComparePanel, PriceReviewPanel } from '../components/import/CheckPanels'
import { ImageEditor } from '../components/import/ImageEditor'
import { ImportHistory } from '../components/import/ImportHistory'
import { ImportReviewPanel } from '../components/import/ImportReviewPanel'
import { PageHeader } from '../components/PageHeader'
import { Stations } from '../components/Stations'
import { useAppData } from '../hooks'
import { toReviewRows, type ReviewRow } from '../importReview'
import { READER_MODE_LABELS } from '../labels'
import { NEW_TRANSACTION } from '../nav'
import { t } from '../../i18n'

const STEPS = [t('เลือกบัญชี'), t('ใส่รูป'), t('อ่าน'), t('ตรวจสอบ'), t('บันทึก')] as const

const PURPOSES = ['import', 'prices', 'compare'] as const
type Purpose = (typeof PURPOSES)[number]
const PURPOSE_LABELS: Record<Purpose, string> = { import: t('นำเข้ารายการ'), prices: t('อัปเดตราคาจากรูป'), compare: t('เทียบยอดกับโบรก') }

type Phase =
  | { name: 'pick' }
  | { name: 'reading' }
  | { name: 'review'; extraction: Extraction; rows: ReviewRow[] }
  | { name: 'done'; message: string }

function isPurpose(value: string | null): value is Purpose {
  return PURPOSES.includes(value as Purpose)
}

function FileChip({ file, edited, onEdit, onRemove }: { file: PreparedFile; edited: boolean; onEdit?: () => void; onRemove: () => void }) {
  return (
    <li className="flex items-center gap-1.5 rounded-xl border bg-card p-2 pr-1">
      {file.kind === 'image' ? (
        <img src={file.previewUrl} alt="" className="size-12 shrink-0 rounded-lg object-cover object-top" />
      ) : (
        <FileText className="size-6 shrink-0 text-ink-2" aria-hidden />
      )}
      <span className="ml-1 min-w-0 flex-1">
        <span className="block truncate text-sm">{file.name}</span>
        {edited && <span className="block text-[12px] text-muted-foreground">{t('ครอปหรือปิดข้อมูลแล้ว')}</span>}
      </span>
      {onEdit && (
        <Button type="button" variant="ghost" size="icon" aria-label={t('ครอปหรือปิดข้อมูลใน {0}', file.name)} onClick={onEdit}>
          <Crop aria-hidden />
        </Button>
      )}
      <Button type="button" variant="ghost" size="icon" aria-label={t('เอา {0} ออก', file.name)} onClick={onRemove}>
        <X aria-hidden />
      </Button>
    </li>
  )
}

export function ImportPage() {
  const data = useAppData()
  const [params] = useSearchParams()
  const mode = useReaderMode()
  const settings = useProviderSettings(mode)
  const readerFor = useReaderFactory()
  const [purpose, setPurpose] = useState<Purpose>(() => {
    const asked = params.get('purpose')
    return isPurpose(asked) ? asked : 'import'
  })
  const [accountId, setAccountId] = useState('')
  const [files, setFiles] = useState<PreparedFile[]>([])
  const [fileErrors, setFileErrors] = useState<string[]>([])
  const [editing, setEditing] = useState<number | null>(null)
  const [edited, setEdited] = useState<ReadonlySet<PreparedFile>>(new Set())
  const [phase, setPhase] = useState<Phase>({ name: 'pick' })
  const [readError, setReadError] = useState('')
  const [cachedUsd, setCachedUsd] = useState<number | null>(null)
  const abort = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const base = data?.settings.baseCurrency ?? 'THB'

  // The estimate needs dollars in the base currency; without a cached rate a baht estimate falls back to 34.
  useEffect(() => {
    if (base === 'USD') return
    let live = true
    void peekCachedQuote(db, 'USD', base).then((q) => live && setCachedUsd(q ? Number(q.rate) : base === 'THB' ? 34 : null))
    return () => {
      live = false
    }
  }, [base])
  const usdRate = base === 'USD' ? 1 : cachedUsd

  const previews = useRef<string[]>([])
  useEffect(() => {
    previews.current = files.flatMap((f) => (f.kind === 'image' ? [f.previewUrl] : []))
  }, [files])
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), [])
  useEffect(() => () => abort.current?.abort(), [])

  if (!data) return null
  const account = data.accounts.find((a) => a.id === accountId) ?? data.accounts[0]
  const needsKey = !providerReady(mode, settings)

  async function addFiles(list: FileList | null) {
    if (!list) return
    const errors: string[] = []
    const added: PreparedFile[] = []
    for (const file of Array.from(list)) {
      try {
        added.push(await prepareFile(file))
      } catch (error) {
        errors.push(error instanceof FileError ? error.message : t('เปิด {0} ไม่ได้', file.name))
      }
    }
    setFiles((current) => [...current, ...added])
    setFileErrors(errors)
    setReadError('')
  }

  async function replaceFile(index: number, file: File) {
    const prepared = await prepareFile(file)
    setFiles((current) => {
      const old = current[index]
      if (old?.kind === 'image') URL.revokeObjectURL(old.previewUrl)
      return current.map((f, i) => (i === index ? prepared : f))
    })
    setEdited((current) => new Set(current).add(prepared))
    setEditing(null)
  }

  function removeFile(index: number) {
    setEditing(null)
    setFiles((current) => {
      const file = current[index]
      if (file?.kind === 'image') URL.revokeObjectURL(file.previewUrl)
      return current.filter((_, i) => i !== index)
    })
  }

  async function read() {
    if (!account) return
    const controller = new AbortController()
    abort.current = controller
    setReadError('')
    setPhase({ name: 'reading' })
    try {
      const extraction = await readerFor(mode, settings).read(files, todayLocal(), controller.signal)
      const rows = toReviewRows(extraction, {
        accountId: account.id,
        baseCurrency: base,
        transactions: data!.transactions,
        instruments: data!.instruments,
      })
      setPhase({ name: 'review', extraction, rows })
    } catch (error) {
      setPhase({ name: 'pick' })
      if (!isAbort(error)) setReadError(describeAiError(error))
    } finally {
      abort.current = null
    }
  }

  function finish(message: string) {
    files.forEach((f) => f.kind === 'image' && URL.revokeObjectURL(f.previewUrl))
    setFiles([])
    setPhase({ name: 'done', message })
  }

  if (data.accounts.length === 0) {
    return (
      <>
        <PageHeader title={t('นำเข้าข้อมูล')} />
        <Alert>
          {t('เพิ่มบัญชีก่อน แล้วค่อยนำเข้ารายการของบัญชีนั้น · ')}<Link to="/settings">{t('ไปที่ตั้งค่า')}</Link>
        </Alert>
      </>
    )
  }

  const step = phase.name === 'done' ? 4 : phase.name === 'review' ? 3 : phase.name === 'reading' || files.length > 0 ? 2 : 1
  const cost = mode === 'claude' && usdRate ? estimateCost(files, usdRate) : null
  const ctx = { accountId: account.id, baseCurrency: base, transactions: data.transactions, instruments: data.instruments }

  return (
    <>
      <PageHeader title={t('นำเข้าข้อมูล')} />
      <Stations steps={STEPS} step={step} />

      {(phase.name === 'pick' || phase.name === 'reading') && (
        <Card className="grid gap-4">
          <div className="grid gap-3">
            <Field id="import-account" label={t('บัญชี')} className="sm:max-w-sm">
              <NativeSelect
                id="import-account"
                value={account.id}
                disabled={phase.name === 'reading'}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="grid content-start gap-1.5">
              <span className="text-[13.5px] font-semibold text-ink-2">{t('ทำอะไร')}</span>
              <Segmented
                label={t('ทำอะไร')}
                options={PURPOSES.map((value) => ({ value, label: PURPOSE_LABELS[value] }))}
                value={purpose}
                onChange={setPurpose}
              />
            </div>
          </div>

          <div className="grid gap-2.5">
            <input
              ref={input}
              type="file"
              multiple
              accept="image/*,application/pdf,.pdf,.csv,.tsv,.txt,text/csv"
              className="sr-only"
              aria-label={t('เลือกรูปหรือไฟล์')}
              onChange={(e) => {
                void addFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              disabled={phase.name === 'reading'}
              onClick={() => input.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                void addFiles(e.dataTransfer.files)
              }}
              className="grid min-h-28 place-items-center gap-1.5 rounded-2xl border-2 border-dashed bg-background px-4 py-5 text-center hover:bg-muted disabled:opacity-50"
            >
              <ImagePlus className="size-6 text-ink-2" aria-hidden />
              <span className="font-semibold">{t('ใส่รูปแคป, PDF หรือ CSV')}</span>
              <span className="text-[12.5px] text-muted-foreground">{t('ใส่ได้หลายไฟล์ · ใส่รูปแล้วครอปหรือปิดเลขบัญชีได้ · Excel ให้บันทึกเป็น CSV ก่อน')}</span>
            </button>
            {files.length > 0 && (
              <ul className="grid gap-2 sm:grid-cols-2" aria-label={t('ไฟล์ที่จะอ่าน')}>
                {files.map((file, index) => (
                  <FileChip
                    key={`${file.name}-${index}`}
                    file={file}
                    edited={edited.has(file)}
                    onEdit={file.kind === 'image' && phase.name === 'pick' ? () => setEditing(index) : undefined}
                    onRemove={() => removeFile(index)}
                  />
                ))}
              </ul>
            )}
            {editing !== null && files[editing]?.kind === 'image' && (
              <ImageEditor
                key={editing}
                previewUrl={(files[editing] as Extract<PreparedFile, { kind: 'image' }>).previewUrl}
                name={files[editing].name}
                onApply={(file) => replaceFile(editing, file)}
                onCancel={() => setEditing(null)}
              />
            )}
            {fileErrors.length > 0 && (
              <Alert tone="error">
                {fileErrors.map((e) => (
                  <p key={e}>{e}</p>
                ))}
              </Alert>
            )}
          </div>

          <p className="text-[13px] text-muted-foreground">
            {t('อ่านด้วย: ')}<b className="text-ink-2">{READER_MODE_LABELS[mode]}</b>
            {' · '}
            {mode === 'local'
              ? t('ไม่มีค่าใช้จ่าย ไฟล์ไม่ออกจากเครื่อง')
              : t('ไฟล์จะถูกส่งไปให้ {0} อ่าน{1}', READER_MODE_LABELS[mode], cost ? t(' · {0} ไฟล์ ≈ {1} {2}', files.length, cost, base === 'THB' ? 'บาท' : base) : '')}
            {' · '}
            <Link to="/settings" className="font-semibold text-primary-ink underline underline-offset-[3px]">
              {t('เปลี่ยน')}
            </Link>
          </p>
          {needsKey && (
            <Alert>
              {t('ตั้งค่า {0} ในหน้าตั้งค่าก่อน หรือเปลี่ยนเป็นอ่านในเครื่อง · ', READER_MODE_LABELS[mode])}<Link to="/settings">{t('ไปที่ตั้งค่า')}</Link>
            </Alert>
          )}
          {readError && (
            <Alert tone="error">
              {readError} · <Link to={NEW_TRANSACTION}>{t('กรอกรายการเอง')}</Link>
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {phase.name === 'reading' ? (
              <>
                <Button type="button" disabled>
                  {t('กำลังอ่าน ')}{files.length} {t(' ไฟล์…')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => abort.current?.abort()}>
                  {t('หยุดอ่าน')}
                </Button>
              </>
            ) : (
              <Button type="button" disabled={files.length === 0 || needsKey} onClick={() => void read()}>
                {mode === 'local' ? t('อ่านไฟล์') : t('ให้ AI อ่าน')}
              </Button>
            )}
          </div>
        </Card>
      )}

      {phase.name === 'review' && (
        <div className="grid items-start gap-3.5 md:gap-[22px] xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Card className="order-last grid content-start gap-3 xl:order-first">
            <h2 className="text-base font-semibold">{t('ไฟล์จาก ')}{account.name}</h2>
            <ul className="grid gap-3">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`} className="grid gap-1.5">
                  {file.kind === 'image' ? (
                    <img src={file.previewUrl} alt={t('รูปที่ {0}', index + 1)} className="max-h-[70vh] w-full rounded-xl border object-contain object-top" />
                  ) : (
                    <span className="flex items-center gap-2 text-sm">
                      <FileText className="size-5 text-ink-2" aria-hidden />
                      {file.name}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-[12.5px] text-muted-foreground">{t('ช่องสีเหลืองคือจุดที่ต้องตรวจกับไฟล์')}</p>
          </Card>
          <Card>
            <h2 className="mb-3 text-lg font-semibold">{PURPOSE_LABELS[purpose]}</h2>
            {purpose === 'import' && (
              <ImportReviewPanel
                extraction={phase.extraction}
                ctx={ctx}
                fileCount={files.length}
                initialRows={phase.rows}
                onSaved={(count) => finish(t('บันทึก {0} รายการแล้ว · ยกเลิกทั้งชุดได้ที่ประวัติการนำเข้าด้านล่าง', count))}
                onCancel={() => setPhase({ name: 'pick' })}
              />
            )}
            {purpose === 'prices' && (
              <PriceReviewPanel
                rows={phase.rows}
                instruments={data.instruments}
                onDone={(count) => finish(t('อัปเดตราคา {0} ตัวแล้ว', count))}
                onCancel={() => setPhase({ name: 'pick' })}
              />
            )}
            {purpose === 'compare' && (
              <ComparePanel
                rows={phase.rows}
                transactions={data.transactions}
                instruments={data.instruments}
                accountId={account.id}
                onDone={() => setPhase({ name: 'pick' })}
              />
            )}
          </Card>
        </div>
      )}

      {phase.name === 'done' && (
        <Card className="grid gap-3">
          <Alert tone="ok">{phase.message}</Alert>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setPhase({ name: 'pick' })}>
              {t('นำเข้าเพิ่ม')}
            </Button>
            <Link to="/portfolio" className={cn(buttonVariants({ variant: 'outline' }))}>
              {t('ไปที่พอร์ต')}
            </Link>
          </div>
        </Card>
      )}

      <ImportHistory accounts={data.accounts} />
    </>
  )
}

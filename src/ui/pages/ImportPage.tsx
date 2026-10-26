import { FileText, ImagePlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useApiKey, useReaderMode } from '../../ai/apiKey'
import type { Extraction } from '../../ai/extraction'
import { estimateCost, FileError, prepareFile, type PreparedFile } from '../../ai/files'
import { describeAiError, isAbort, useReaderFactory } from '../../ai/reader'
import { Alert } from '../../components/ui/alert'
import { Button, buttonVariants } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { NativeSelect } from '../../components/ui/input'
import { Segmented } from '../../components/ui/segmented'
import { db } from '../../db/db'
import { todayLocal } from '../../domain/dates'
import { peekCachedQuote } from '../../fx/fxService'
import { cn } from '../../lib/cn'
import { ComparePanel, PriceReviewPanel } from '../components/import/CheckPanels'
import { ImportHistory } from '../components/import/ImportHistory'
import { ImportReviewPanel } from '../components/import/ImportReviewPanel'
import { PageHeader } from '../components/PageHeader'
import { Stations } from '../components/Stations'
import { useAppData } from '../hooks'
import { toReviewRows, type ReviewRow } from '../importReview'
import { READER_MODE_LABELS } from '../labels'
import { NEW_TRANSACTION } from '../nav'

const STEPS = ['เลือกบัญชี', 'ใส่รูป', 'อ่าน', 'ตรวจสอบ', 'บันทึก'] as const

const PURPOSES = ['import', 'prices', 'compare'] as const
type Purpose = (typeof PURPOSES)[number]
const PURPOSE_LABELS: Record<Purpose, string> = { import: 'นำเข้ารายการ', prices: 'อัปเดตราคาจากรูป', compare: 'เทียบยอดกับโบรก' }

type Phase =
  | { name: 'pick' }
  | { name: 'reading' }
  | { name: 'review'; extraction: Extraction; rows: ReviewRow[] }
  | { name: 'done'; message: string }

function isPurpose(value: string | null): value is Purpose {
  return PURPOSES.includes(value as Purpose)
}

function FileChip({ file, onRemove }: { file: PreparedFile; onRemove: () => void }) {
  return (
    <li className="flex items-center gap-2.5 rounded-xl border bg-card p-2 pr-1">
      {file.kind === 'image' ? (
        <img src={file.previewUrl} alt="" className="size-12 shrink-0 rounded-lg object-cover object-top" />
      ) : (
        <FileText className="size-6 shrink-0 text-ink-2" aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
      <Button type="button" variant="ghost" size="icon" aria-label={`เอา ${file.name} ออก`} onClick={onRemove}>
        <X aria-hidden />
      </Button>
    </li>
  )
}

export function ImportPage() {
  const data = useAppData()
  const [params] = useSearchParams()
  const mode = useReaderMode()
  const apiKey = useApiKey()
  const readerFor = useReaderFactory()
  const [purpose, setPurpose] = useState<Purpose>(() => {
    const asked = params.get('purpose')
    return isPurpose(asked) ? asked : 'import'
  })
  const [accountId, setAccountId] = useState('')
  const [files, setFiles] = useState<PreparedFile[]>([])
  const [fileErrors, setFileErrors] = useState<string[]>([])
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
  const needsKey = mode === 'claude' && !apiKey

  async function addFiles(list: FileList | null) {
    if (!list) return
    const errors: string[] = []
    const added: PreparedFile[] = []
    for (const file of Array.from(list)) {
      try {
        added.push(await prepareFile(file))
      } catch (error) {
        errors.push(error instanceof FileError ? error.message : `เปิด ${file.name} ไม่ได้`)
      }
    }
    setFiles((current) => [...current, ...added])
    setFileErrors(errors)
    setReadError('')
  }

  function removeFile(index: number) {
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
      const extraction = await readerFor(mode, apiKey).read(files, todayLocal(), controller.signal)
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
        <PageHeader title="นำเข้าข้อมูล" />
        <Alert>
          เพิ่มบัญชีก่อน แล้วค่อยนำเข้ารายการของบัญชีนั้น · <Link to="/settings">ไปที่ตั้งค่า</Link>
        </Alert>
      </>
    )
  }

  const step = phase.name === 'done' ? 4 : phase.name === 'review' ? 3 : phase.name === 'reading' || files.length > 0 ? 2 : 1
  const cost = mode === 'claude' && usdRate ? estimateCost(files, usdRate) : null
  const ctx = { accountId: account.id, baseCurrency: base, transactions: data.transactions, instruments: data.instruments }

  return (
    <>
      <PageHeader title="นำเข้าข้อมูล" />
      <Stations steps={STEPS} step={step} />

      {(phase.name === 'pick' || phase.name === 'reading') && (
        <Card className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="import-account" label="บัญชี">
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
              <span className="text-[13.5px] font-semibold text-ink-2">ทำอะไร</span>
              <Segmented
                label="ทำอะไร"
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
              aria-label="เลือกรูปหรือไฟล์"
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
              <span className="font-semibold">ใส่รูปแคป, PDF หรือ CSV</span>
              <span className="text-[12.5px] text-muted-foreground">ใส่ได้หลายไฟล์ · ครอปหรือปิดเลขบัญชีก่อนใส่ได้ · Excel ให้บันทึกเป็น CSV ก่อน</span>
            </button>
            {files.length > 0 && (
              <ul className="grid gap-2 sm:grid-cols-2" aria-label="ไฟล์ที่จะอ่าน">
                {files.map((file, index) => (
                  <FileChip key={`${file.name}-${index}`} file={file} onRemove={() => removeFile(index)} />
                ))}
              </ul>
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
            อ่านด้วย: <b className="text-ink-2">{READER_MODE_LABELS[mode]}</b>
            {' · '}
            {mode === 'local'
              ? 'ไม่มีค่าใช้จ่าย ไฟล์ไม่ออกจากเครื่อง'
              : `ไฟล์จะถูกส่งไปให้ AI ของ Anthropic อ่าน${cost ? ` · ${files.length} ไฟล์ ≈ ${cost} ${base === 'THB' ? 'บาท' : base}` : ''}`}
            {' · '}
            <Link to="/settings" className="font-semibold text-primary-ink underline underline-offset-[3px]">
              เปลี่ยน
            </Link>
          </p>
          {needsKey && (
            <Alert>
              ใส่ API key ของ Anthropic ในหน้าตั้งค่าก่อน หรือเปลี่ยนเป็นอ่านในเครื่อง · <Link to="/settings">ไปที่ตั้งค่า</Link>
            </Alert>
          )}
          {readError && (
            <Alert tone="error">
              {readError} · <Link to={NEW_TRANSACTION}>กรอกรายการเอง</Link>
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {phase.name === 'reading' ? (
              <>
                <Button type="button" disabled>
                  กำลังอ่าน {files.length} ไฟล์…
                </Button>
                <Button type="button" variant="ghost" onClick={() => abort.current?.abort()}>
                  หยุดอ่าน
                </Button>
              </>
            ) : (
              <Button type="button" disabled={files.length === 0 || needsKey} onClick={() => void read()}>
                {mode === 'claude' ? 'ให้ AI อ่าน' : 'อ่านไฟล์'}
              </Button>
            )}
          </div>
        </Card>
      )}

      {phase.name === 'review' && (
        <div className="grid items-start gap-3.5 md:gap-[22px] lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Card className="grid content-start gap-3">
            <h2 className="text-base font-semibold">ไฟล์จาก {account.name}</h2>
            <ul className="grid gap-3">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`} className="grid gap-1.5">
                  {file.kind === 'image' ? (
                    <img src={file.previewUrl} alt={`รูปที่ ${index + 1}`} className="w-full rounded-xl border" />
                  ) : (
                    <span className="flex items-center gap-2 text-sm">
                      <FileText className="size-5 text-ink-2" aria-hidden />
                      {file.name}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-[12.5px] text-muted-foreground">ช่องสีเหลืองคือจุดที่ต้องตรวจกับไฟล์</p>
          </Card>
          <Card>
            <h2 className="mb-3 text-lg font-semibold">{PURPOSE_LABELS[purpose]}</h2>
            {purpose === 'import' && (
              <ImportReviewPanel
                extraction={phase.extraction}
                ctx={ctx}
                fileCount={files.length}
                initialRows={phase.rows}
                onSaved={(count) => finish(`บันทึก ${count} รายการแล้ว · ยกเลิกทั้งชุดได้ที่ประวัติการนำเข้าด้านล่าง`)}
                onCancel={() => setPhase({ name: 'pick' })}
              />
            )}
            {purpose === 'prices' && (
              <PriceReviewPanel
                rows={phase.rows}
                instruments={data.instruments}
                onDone={(count) => finish(`อัปเดตราคา ${count} ตัวแล้ว`)}
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
              นำเข้าเพิ่ม
            </Button>
            <Link to="/portfolio" className={cn(buttonVariants({ variant: 'outline' }))}>
              ไปที่พอร์ต
            </Link>
          </div>
        </Card>
      )}

      <ImportHistory accounts={data.accounts} />
    </>
  )
}

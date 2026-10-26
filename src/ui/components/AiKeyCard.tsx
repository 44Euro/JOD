import { useState, type FormEvent } from 'react'
import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { Segmented } from '../../components/ui/segmented'
import { maskApiKey, useApiKey, useReaderMode, writeApiKey, writeReaderMode } from '../../ai/apiKey'
import { describeAiError, useReaderFactory } from '../../ai/reader'
import { READER_MODE_LABELS } from '../labels'
import { t } from '../../i18n'

type Status = { tone: 'ok' | 'error'; text: string } | null

export function AiKeyCard() {
  const key = useApiKey()
  const mode = useReaderMode()
  const readerFor = useReaderFactory()
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<Status>(null)
  const [testing, setTesting] = useState(false)

  function save(event: FormEvent) {
    event.preventDefault()
    const value = draft.trim()
    if (!value) return
    writeApiKey(value)
    setDraft('')
    setStatus(null)
  }

  async function test() {
    setTesting(true)
    setStatus(null)
    try {
      await readerFor('claude', key).test()
      setStatus({ tone: 'ok', text: t('เชื่อมต่อได้ พร้อมให้ AI อ่านรูป') })
    } catch (error) {
      setStatus({ tone: 'error', text: describeAiError(error) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card className="grid gap-3">
      <h2 className="text-lg font-semibold">{t('วิธีอ่านรูปและไฟล์')}</h2>
      <Segmented
        label={t('วิธีอ่านรูปและไฟล์')}
        options={(['local', 'claude'] as const).map((value) => ({ value, label: READER_MODE_LABELS[value] }))}
        value={mode}
        onChange={(next) => {
          writeReaderMode(next)
          setStatus(null)
        }}
      />
      {mode === 'local' ? (
        <p className="text-[12.5px] text-muted-foreground">
          
          {t('ไม่มีค่าใช้จ่าย ไฟล์ไม่ออกจากเครื่อง · CSV อ่านได้ตรงตามไฟล์ ส่วนรูปและ PDF อ่านด้วย OCR ต้องตรวจทุกช่องก่อนบันทึก · ครั้งแรกที่อ่านรูปจะโหลดชุดอ่านภาษาไทยและอังกฤษหนึ่งครั้ง')}
        </p>
      ) : (
        <>
          <p className="text-[12.5px] text-muted-foreground">
            
            {t('แม่นกว่ากับรูปแคปและ statement · ใช้ API key ของ Anthropic ของคุณเอง คิดเงินกับบัญชีของคุณ ประมาณ 1–3 บาทต่อรูป · key เก็บไว้ในเครื่องนี้เท่านั้น ไม่อยู่ในไฟล์สำรอง · ขอ key ได้ที่ console.anthropic.com')}
          </p>
          {key ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block text-[13px] text-muted-foreground">{t('key ที่ใช้อยู่')}</span>
                <span className="font-mono text-sm">{maskApiKey(key)}</span>
              </span>
              <span className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={testing} onClick={() => void test()}>
                  {testing ? t('กำลังทดสอบ…') : t('ทดสอบการเชื่อมต่อ')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    writeApiKey('')
                    setStatus(null)
                  }}
                >
                  
                  {t('ลบ key')}
                </Button>
              </span>
            </div>
          ) : (
            <form onSubmit={save} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field id="ai-key" label="API key">
                <Input
                  id="ai-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="sk-ant-…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </Field>
              <Button type="submit" className="h-[46px]" disabled={!draft.trim()}>
                
                {t('บันทึก key')}
              </Button>
            </form>
          )}
        </>
      )}
      {status && <Alert tone={status.tone}>{status.text}</Alert>}
    </Card>
  )
}

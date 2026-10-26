import { useState, type FormEvent } from 'react'
import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { Input, NativeSelect } from '../../components/ui/input'
import { maskApiKey, readProviderSettings, useProviderSettings, useReaderMode, writeProviderSettings, writeReaderMode } from '../../ai/apiKey'
import { describeAiError, READER_MODES, useReaderFactory, type ReaderMode } from '../../ai/reader'
import { READER_MODE_LABELS } from '../labels'
import { t } from '../../i18n'

type Status = { tone: 'ok' | 'error'; text: string } | null

const NOTES: Record<ReaderMode, string> = {
  local: t('ไม่มีค่าใช้จ่าย ไฟล์ไม่ออกจากเครื่อง · CSV อ่านได้ตรงตามไฟล์ ส่วนรูปและ PDF อ่านด้วย OCR ต้องตรวจทุกช่องก่อนบันทึก · ครั้งแรกที่อ่านรูปจะโหลดชุดอ่านภาษาไทยและอังกฤษหนึ่งครั้ง'),
  claude: t('แม่นกว่ากับรูปแคปและ statement · ใช้ API key ของ Anthropic ของคุณเอง คิดเงินกับบัญชีของคุณ ประมาณ 1–3 บาทต่อรูป · key เก็บไว้ในเครื่องนี้เท่านั้น ไม่อยู่ในไฟล์สำรอง · ขอ key ได้ที่ console.anthropic.com'),
  openai: t('ใช้ API key ของ OpenAI ของคุณเอง คิดเงินตามราคาของ OpenAI · key เก็บไว้ในเครื่องนี้เท่านั้น · ขอ key ได้ที่ platform.openai.com'),
  gemini: t('ใช้ API key ของ Google AI Studio ของคุณเอง คิดเงินตามราคาของ Google · key เก็บไว้ในเครื่องนี้เท่านั้น · ขอ key ได้ที่ aistudio.google.com'),
  compatible: t('บริการใดก็ได้ที่ใช้ API แบบ OpenAI เช่น OpenRouter หรือ Ollama ในเครื่อง · ใส่ที่อยู่ API ชื่อรุ่นที่อ่านรูปได้ และ key ถ้าบริการนั้นต้องใช้'),
}

function ProviderForm({ mode }: { mode: Exclude<ReaderMode, 'local'> }) {
  const settings = useProviderSettings(mode)
  const readerFor = useReaderFactory()
  const [key, setKey] = useState('')
  const [model, setModel] = useState(settings.model)
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl ?? '')
  const [status, setStatus] = useState<Status>(null)
  const [testing, setTesting] = useState(false)

  function save(event: FormEvent) {
    event.preventDefault()
    writeProviderSettings(mode, { apiKey: key.trim() || settings.apiKey, model: model.trim(), baseUrl: baseUrl.trim() || undefined })
    setKey('')
    setStatus({ tone: 'ok', text: t('บันทึกแล้ว') })
  }

  async function test() {
    setTesting(true)
    setStatus(null)
    try {
      await readerFor(mode, readProviderSettings(mode)).test()
      setStatus({ tone: 'ok', text: t('เชื่อมต่อได้ พร้อมให้ AI อ่านรูป') })
    } catch (error) {
      setStatus({ tone: 'error', text: describeAiError(error) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <form onSubmit={save} className="grid gap-3">
      {mode === 'compatible' && (
        <Field id="ai-base-url" label={t('ที่อยู่ API')} hint={t('เช่น https://openrouter.ai/api/v1 หรือ http://localhost:11434/v1')}>
          <Input id="ai-base-url" inputMode="url" autoComplete="off" spellCheck={false} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </Field>
      )}
      {mode !== 'claude' && (
        <Field id="ai-model" label={t('ชื่อรุ่น')} hint={t('ต้องเป็นรุ่นที่อ่านรูปได้ · เปลี่ยนตามที่ผู้ให้บริการกำหนด')}>
          <Input id="ai-model" autoComplete="off" spellCheck={false} value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
      )}
      <Field id="ai-key" label="API key" hint={settings.apiKey ? t('key ที่ใช้อยู่ {0} · ใส่ใหม่เพื่อเปลี่ยน', maskApiKey(settings.apiKey)) : undefined}>
        <Input id="ai-key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit">{mode === 'claude' ? t('บันทึก key') : t('บันทึกการตั้งค่า AI')}</Button>
        <Button type="button" variant="outline" disabled={testing} onClick={() => void test()}>
          {testing ? t('กำลังทดสอบ…') : t('ทดสอบการเชื่อมต่อ')}
        </Button>
        {settings.apiKey && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              writeProviderSettings(mode, { ...settings, apiKey: '' })
              setStatus(null)
            }}
          >
            {t('ลบ key')}
          </Button>
        )}
      </div>
      {status && <Alert tone={status.tone}>{status.text}</Alert>}
    </form>
  )
}

export function AiKeyCard() {
  const mode = useReaderMode()
  return (
    <Card className="grid gap-3">
      <h2 className="text-lg font-semibold">{t('วิธีอ่านรูปและไฟล์')}</h2>
      <Field id="ai-provider" label={t('ใช้อ่านด้วย')}>
        <NativeSelect id="ai-provider" value={mode} onChange={(e) => writeReaderMode(e.target.value as ReaderMode)}>
          {READER_MODES.map((value) => (
            <option key={value} value={value}>
              {READER_MODE_LABELS[value]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <p className="text-[12.5px] text-muted-foreground">{NOTES[mode]}</p>
      {mode !== 'local' && <ProviderForm key={mode} mode={mode} />}
    </Card>
  )
}

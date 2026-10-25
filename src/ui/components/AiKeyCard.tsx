import { useState, type FormEvent } from 'react'
import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { maskApiKey, useApiKey, writeApiKey } from '../../ai/apiKey'
import { describeAiError, useAiReaderFactory } from '../../ai/reader'

type Status = { tone: 'ok' | 'error'; text: string } | null

export function AiKeyCard() {
  const key = useApiKey()
  const readerFor = useAiReaderFactory()
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
      await readerFor(key).test()
      setStatus({ tone: 'ok', text: 'เชื่อมต่อได้ พร้อมให้ AI อ่านรูป' })
    } catch (error) {
      setStatus({ tone: 'error', text: describeAiError(error) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card className="grid gap-3">
      <div>
        <h2 className="text-lg font-semibold">AI อ่านรูปและไฟล์</h2>
        <p className="text-[12.5px] text-muted-foreground">
          ใช้ API key ของ Anthropic ของคุณเอง · เก็บไว้ในเครื่องนี้เท่านั้น ไม่อยู่ในไฟล์สำรอง · ขอ key ได้ที่ console.anthropic.com
        </p>
      </div>
      {key ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0">
            <span className="block text-[13px] text-muted-foreground">key ที่ใช้อยู่</span>
            <span className="font-mono text-sm">{maskApiKey(key)}</span>
          </span>
          <span className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={testing} onClick={() => void test()}>
              {testing ? 'กำลังทดสอบ…' : 'ทดสอบการเชื่อมต่อ'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                writeApiKey('')
                setStatus(null)
              }}
            >
              ลบ key
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
            บันทึก key
          </Button>
        </form>
      )}
      {status && <Alert tone={status.tone}>{status.text}</Alert>}
    </Card>
  )
}

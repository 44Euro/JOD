import { t } from '../i18n'
import { EXTRACTION_SCHEMA, ExtractionError, extractionPrompt, parseExtraction, type Extraction } from './extraction'
import type { PreparedFile } from './files'
import { AiError, type AiReader } from './reader'

// Readers for other AI providers, over their plain HTTP APIs with the user's own key. Each asks for the same JSON as
// the Claude reader, so the review page works the same whichever one read the files.

export interface ProviderSettings {
  apiKey: string
  model: string
  baseUrl?: string
}

const ASK = 'Read every holding or transaction in these files.'

export function failure(status: number, provider: string): AiError {
  if (status === 401 || status === 403) return new AiError(t('API key ของ {0} ไม่ถูกต้องหรือไม่มีสิทธิ์ ตรวจในหน้าตั้งค่า', provider))
  if (status === 404) return new AiError(t('{0} ไม่รู้จักรุ่นที่ตั้งไว้ ตรวจชื่อรุ่นในหน้าตั้งค่า', provider))
  if (status === 429) return new AiError(t('{0} จำกัดจำนวนครั้งหรือเครดิตหมด รอสักครู่แล้วลองใหม่', provider))
  if (status === 400 || status === 413) return new AiError(t('{0} รับไฟล์นี้ไม่ได้ ลองรูปอื่นหรือแบ่งเป็นหลายครั้ง', provider))
  return new AiError(t('บริการ {0} ไม่ว่างตอนนี้ ลองใหม่อีกครั้ง', provider))
}

export async function post(fetchFn: typeof fetch, url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal })
  } catch {
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError')
    throw new AiError(t('ต่ออินเทอร์เน็ตไม่ได้ ตรวจการเชื่อมต่อแล้วลองใหม่'))
  }
}

function toExtraction(text: string): Extraction {
  // Some models wrap the JSON in a code fence even when asked not to.
  const json = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')
  try {
    return parseExtraction(JSON.parse(json))
  } catch (error) {
    if (error instanceof ExtractionError) throw error
    throw new ExtractionError(t('AI ตอบกลับมาในรูปแบบที่อ่านไม่ได้ ลองใหม่อีกครั้ง'))
  }
}

// Without a schema to enforce, the schema goes into the prompt instead.
const schemaInPrompt = (today: string) => `${extractionPrompt(today)}\n\nAnswer with JSON only, matching this JSON Schema:\n${JSON.stringify(EXTRACTION_SCHEMA)}`

function openAiContent(files: readonly PreparedFile[]) {
  return [
    ...files.map((file) => {
      if (file.kind === 'image') return { type: 'image_url', image_url: { url: `data:${file.mediaType};base64,${file.data}` } }
      if (file.kind === 'pdf') return { type: 'file', file: { filename: file.name, file_data: `data:application/pdf;base64,${file.data}` } }
      return { type: 'text', text: `File ${file.name}:\n${file.data}` }
    }),
    { type: 'text', text: ASK },
  ]
}

// OpenAI and every service that copies its chat API (OpenRouter, Groq, Together, Ollama, LM Studio and others).
// A service that refuses the strict schema is asked again with the schema written into the prompt.
export function createOpenAiReader(settings: ProviderSettings, provider = 'OpenAI', fetchFn: typeof fetch = (i, o) => fetch(i, o)): AiReader {
  const base = (settings.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const headers: Record<string, string> = settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}
  async function ask(files: readonly PreparedFile[], today: string, strict: boolean, signal?: AbortSignal) {
    return post(
      fetchFn,
      `${base}/chat/completions`,
      headers,
      {
        model: settings.model,
        messages: [
          { role: 'system', content: strict ? extractionPrompt(today) : schemaInPrompt(today) },
          { role: 'user', content: openAiContent(files) },
        ],
        response_format: strict ? { type: 'json_schema', json_schema: { name: 'extraction', strict: true, schema: EXTRACTION_SCHEMA } } : { type: 'json_object' },
      },
      signal,
    )
  }
  return {
    async read(files, today, signal) {
      let res = await ask(files, today, true, signal)
      if (res.status === 400 && settings.baseUrl) res = await ask(files, today, false, signal)
      if (!res.ok) throw failure(res.status, provider)
      const body = (await res.json()) as { choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[] }
      const choice = body.choices?.[0]
      if (choice?.message?.refusal) throw new AiError(t('AI ไม่อ่านไฟล์นี้ ลองใช้รูปอื่นหรือกรอกรายการเอง'))
      if (choice?.finish_reason === 'length') throw new AiError(t('ข้อมูลยาวเกินกว่าจะอ่านในครั้งเดียว แบ่งเป็นหลายครั้ง'))
      return toExtraction(choice?.message?.content ?? '')
    },
    async test(signal) {
      let res: Response
      try {
        res = await fetchFn(`${base}/models`, { headers, signal })
      } catch {
        throw new AiError(t('ต่ออินเทอร์เน็ตไม่ได้ ตรวจการเชื่อมต่อแล้วลองใหม่'))
      }
      if (!res.ok) throw failure(res.status, provider)
    },
  }
}

function geminiParts(files: readonly PreparedFile[]) {
  return [
    ...files.map((file) => {
      if (file.kind === 'image') return { inline_data: { mime_type: file.mediaType, data: file.data } }
      if (file.kind === 'pdf') return { inline_data: { mime_type: 'application/pdf', data: file.data } }
      return { text: `File ${file.name}:\n${file.data}` }
    }),
    { text: ASK },
  ]
}

// Google Gemini. Models that do not take a JSON Schema for the answer are asked again with it written in the prompt.
export function createGeminiReader(settings: ProviderSettings, fetchFn: typeof fetch = (i, o) => fetch(i, o)): AiReader {
  const base = 'https://generativelanguage.googleapis.com/v1beta'
  const headers = { 'x-goog-api-key': settings.apiKey }
  async function ask(files: readonly PreparedFile[], today: string, strict: boolean, signal?: AbortSignal) {
    return post(
      fetchFn,
      `${base}/models/${encodeURIComponent(settings.model)}:generateContent`,
      headers,
      {
        systemInstruction: { parts: [{ text: strict ? extractionPrompt(today) : schemaInPrompt(today) }] },
        contents: [{ role: 'user', parts: geminiParts(files) }],
        generationConfig: strict ? { responseMimeType: 'application/json', responseJsonSchema: EXTRACTION_SCHEMA } : { responseMimeType: 'application/json' },
      },
      signal,
    )
  }
  return {
    async read(files, today, signal) {
      let res = await ask(files, today, true, signal)
      if (res.status === 400) res = await ask(files, today, false, signal)
      if (!res.ok) throw failure(res.status, 'Gemini')
      const body = (await res.json()) as {
        promptFeedback?: { blockReason?: string }
        candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[]
      }
      const candidate = body.candidates?.[0]
      if (body.promptFeedback?.blockReason || candidate?.finishReason === 'SAFETY') throw new AiError(t('AI ไม่อ่านไฟล์นี้ ลองใช้รูปอื่นหรือกรอกรายการเอง'))
      if (candidate?.finishReason === 'MAX_TOKENS') throw new AiError(t('ข้อมูลยาวเกินกว่าจะอ่านในครั้งเดียว แบ่งเป็นหลายครั้ง'))
      return toExtraction((candidate?.content?.parts ?? []).map((p) => p.text ?? '').join(''))
    },
    async test(signal) {
      let res: Response
      try {
        res = await fetchFn(`${base}/models/${encodeURIComponent(settings.model)}`, { headers, signal })
      } catch {
        throw new AiError(t('ต่ออินเทอร์เน็ตไม่ได้ ตรวจการเชื่อมต่อแล้วลองใหม่'))
      }
      if (!res.ok) throw failure(res.status, 'Gemini')
    },
  }
}

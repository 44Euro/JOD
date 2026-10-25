import Anthropic from '@anthropic-ai/sdk'
import { createContext, useContext } from 'react'
import { EXTRACTION_SCHEMA, ExtractionError, extractionPrompt, parseExtraction, type Extraction } from './extraction'
import type { PreparedFile } from './files'

export const AI_MODEL = 'claude-opus-5-5'

// The app talks to the AI only through this, so a later server-side reader (needed before others use the app, and for
// the mobile app) can stand in without touching the pages.
export interface AiReader {
  read(files: readonly PreparedFile[], today: string, signal?: AbortSignal): Promise<Extraction>
  test(signal?: AbortSignal): Promise<void>
}

export class AiError extends Error {
  name = 'AiError'
}

export function isAbort(error: unknown): boolean {
  return error instanceof Anthropic.APIUserAbortError || (error instanceof DOMException && error.name === 'AbortError')
}

export function describeAiError(error: unknown): string {
  if (error instanceof AiError || error instanceof ExtractionError) return error.message
  if (error instanceof Anthropic.AuthenticationError) return 'API key ไม่ถูกต้อง ตรวจอีกครั้งในหน้าตั้งค่า'
  if (error instanceof Anthropic.PermissionDeniedError) return 'API key นี้ไม่มีสิทธิ์ใช้โมเดลที่แอปเรียก'
  if (error instanceof Anthropic.RateLimitError) return 'เรียกใช้ถี่เกินไป รอสักครู่แล้วลองใหม่'
  if (error instanceof Anthropic.APIConnectionError) return 'ต่ออินเทอร์เน็ตไม่ได้ ตรวจการเชื่อมต่อแล้วลองใหม่'
  if (error instanceof Anthropic.BadRequestError) {
    return /credit balance/i.test(error.message)
      ? 'เครดิต API หมด เติมได้ที่ console.anthropic.com'
      : 'AI รับไฟล์นี้ไม่ได้ ไฟล์อาจใหญ่เกินไปหรือเสีย ลองแบ่งเป็นหลายครั้ง'
  }
  if (error instanceof Anthropic.APIError) return 'บริการ AI ไม่ว่างตอนนี้ ลองใหม่อีกครั้ง'
  return 'อ่านไม่สำเร็จ ลองใหม่อีกครั้ง หรือกรอกรายการเอง'
}

function contentFor(file: PreparedFile): Anthropic.ContentBlockParam {
  if (file.kind === 'image') return { type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.data } }
  if (file.kind === 'pdf') return { type: 'document', title: file.name, source: { type: 'base64', media_type: 'application/pdf', data: file.data } }
  return { type: 'document', title: file.name, source: { type: 'text', media_type: 'text/plain', data: file.data } }
}

// The key is the user's own and stays on this device: the browser calls the API directly, which the SDK only allows
// when told to. That is acceptable while one person uses the app with their own key.
export function createClaudeReader(apiKey: string, fetch?: typeof globalThis.fetch): AiReader {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, fetch })
  return {
    async read(files, today, signal) {
      const message = await client.messages
        .stream(
          {
            model: AI_MODEL,
            max_tokens: 32_000,
            system: extractionPrompt(today),
            output_config: { effort: 'medium', format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
            messages: [
              {
                role: 'user',
                content: [...files.map(contentFor), { type: 'text', text: 'Read every holding or transaction in these files.' }],
              },
            ],
          },
          { signal },
        )
        .finalMessage()
      if (message.stop_reason === 'refusal') throw new AiError('AI ไม่อ่านไฟล์นี้ ลองใช้รูปอื่นหรือกรอกรายการเอง')
      if (message.stop_reason === 'max_tokens') throw new AiError('ข้อมูลยาวเกินกว่าจะอ่านในครั้งเดียว แบ่งเป็นหลายครั้ง')
      const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        throw new ExtractionError('AI ตอบกลับมาในรูปแบบที่อ่านไม่ได้ ลองใหม่อีกครั้ง')
      }
      return parseExtraction(json)
    },
    async test(signal) {
      await client.models.retrieve(AI_MODEL, {}, { signal })
    },
  }
}

export const AiReaderContext = createContext<(apiKey: string) => AiReader>((apiKey) => createClaudeReader(apiKey))

export function useAiReaderFactory(): (apiKey: string) => AiReader {
  return useContext(AiReaderContext)
}

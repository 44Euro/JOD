import Anthropic from '@anthropic-ai/sdk'
import { EXTRACTION_SCHEMA, ExtractionError, extractionPrompt, parseExtraction } from './extraction'
import type { PreparedFile } from './files'
import { AI_MODEL, AiError, type AiReader } from './reader'

function messageFor(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'API key ไม่ถูกต้อง ตรวจอีกครั้งในหน้าตั้งค่า'
  if (error instanceof Anthropic.PermissionDeniedError) return 'API key นี้ไม่มีสิทธิ์ใช้โมเดลที่แอปเรียก'
  if (error instanceof Anthropic.RateLimitError) return 'เรียกใช้ถี่เกินไป รอสักครู่แล้วลองใหม่'
  if (error instanceof Anthropic.APIConnectionError) return 'ต่ออินเทอร์เน็ตไม่ได้ ตรวจการเชื่อมต่อแล้วลองใหม่'
  if (error instanceof Anthropic.BadRequestError) {
    return /credit balance/i.test(error.message)
      ? 'เครดิต API หมด เติมได้ที่ console.anthropic.com'
      : 'AI รับไฟล์นี้ไม่ได้ ไฟล์อาจใหญ่เกินไปหรือเสีย ลองแบ่งเป็นหลายครั้ง'
  }
  return 'บริการ AI ไม่ว่างตอนนี้ ลองใหม่อีกครั้ง'
}

// The SDK's errors become the app's own here, so the pages can explain them without loading the SDK.
async function translated<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    if (error instanceof Anthropic.APIUserAbortError) throw new DOMException('cancelled', 'AbortError')
    if (error instanceof Anthropic.AnthropicError) throw new AiError(messageFor(error))
    throw error
  }
}

function contentFor(file: PreparedFile): Anthropic.ContentBlockParam {
  if (file.kind === 'image') return { type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.data } }
  if (file.kind === 'pdf') return { type: 'document', title: file.name, source: { type: 'base64', media_type: 'application/pdf', data: file.data } }
  return { type: 'document', title: file.name, source: { type: 'text', media_type: 'text/plain', data: file.data } }
}

// The key is the user's own and stays on this device: the browser calls the API directly, which the SDK only allows
// when told to. That is acceptable while each person uses the app with their own key.
export function createClaudeReader(apiKey: string, fetch?: typeof globalThis.fetch): AiReader {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, fetch })
  return {
    async read(files, today, signal) {
      const message = await translated(() =>
        client.messages
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
          .finalMessage(),
      )
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
      await translated(() => client.models.retrieve(AI_MODEL, {}, { signal }))
    },
  }
}

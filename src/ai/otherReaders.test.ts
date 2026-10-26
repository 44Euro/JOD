import { describe, expect, it } from 'vitest'
import type { PreparedFile } from './files'
import { createGeminiReader, createOpenAiReader } from './otherReaders'
import { describeAiError } from './reader'

const answer = { source: 'portfolio', rows: [], statedTotal: null, statedTotalCurrency: null, costIncludesFees: null, problems: ['รูปถูกตัด'] }
const image: PreparedFile = { kind: 'image', name: 'a.png', mediaType: 'image/png', data: 'AAAA', width: 10, height: 10, previewUrl: '' }
const pdf: PreparedFile = { kind: 'pdf', name: 's.pdf', data: 'JVBE', pages: 1 }

function scripted(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = []
  const fetchFn = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(String(init.body)) : {} })
    const next = responses.shift() ?? { status: 500, body: {} }
    return new Response(JSON.stringify(next.body), { status: next.status })
  }) as typeof fetch
  return { fetchFn, calls }
}

describe('OpenAI reader', () => {
  it('sends pictures and PDFs with the strict schema and reads the JSON answer', async () => {
    const { fetchFn, calls } = scripted([{ status: 200, body: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }] } }])
    const result = await createOpenAiReader({ apiKey: 'sk-x', model: 'gpt-4.1' }, 'OpenAI', fetchFn).read([image, pdf], '2026-10-26')
    expect(result.problems).toEqual(['รูปถูกตัด'])
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions')
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer sk-x')
    const body = calls[0].body as { model: string; response_format: { type: string }; messages: { content: { type: string }[] }[] }
    expect([body.model, body.response_format.type]).toEqual(['gpt-4.1', 'json_schema'])
    expect(body.messages[1].content.map((c) => c.type)).toEqual(['image_url', 'file', 'text'])
  })

  it('asks a compatible service again without the strict schema when it refuses one, and strips a code fence', async () => {
    const { fetchFn, calls } = scripted([
      { status: 400, body: { error: 'response_format not supported' } },
      { status: 200, body: { choices: [{ message: { content: '```json\n' + JSON.stringify(answer) + '\n```' } }] } },
    ])
    const result = await createOpenAiReader({ apiKey: '', model: 'llava', baseUrl: 'http://localhost:11434/v1/' }, 'localhost', fetchFn).read([image], '2026-10-26')
    expect(result.problems).toEqual(['รูปถูกตัด'])
    expect(calls[1].url).toBe('http://localhost:11434/v1/chat/completions')
    expect((calls[1].body.response_format as { type: string }).type).toBe('json_object')
    expect(calls[0].init.headers).not.toHaveProperty('authorization')
  })

  it('explains a wrong key and an unknown model in Thai', async () => {
    const wrongKey = await createOpenAiReader({ apiKey: 'bad', model: 'm' }, 'OpenAI', scripted([{ status: 401, body: {} }]).fetchFn)
      .read([image], '2026-10-26')
      .catch((e: unknown) => e)
    expect(describeAiError(wrongKey)).toBe('API key ของ OpenAI ไม่ถูกต้องหรือไม่มีสิทธิ์ ตรวจในหน้าตั้งค่า')
    const noModel = await createOpenAiReader({ apiKey: 'k', model: 'nope' }, 'OpenAI', scripted([{ status: 404, body: {} }]).fetchFn)
      .read([image], '2026-10-26')
      .catch((e: unknown) => e)
    expect(describeAiError(noModel)).toContain('ไม่รู้จักรุ่น')
  })
})

describe('Gemini reader', () => {
  it('sends inline files with the JSON schema and joins the answer parts', async () => {
    const text = JSON.stringify(answer)
    const { fetchFn, calls } = scripted([{ status: 200, body: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: text.slice(0, 20) }, { text: text.slice(20) }] } }] } }])
    const result = await createGeminiReader({ apiKey: 'g-key', model: 'gemini-2.5-flash' }, fetchFn).read([image, pdf], '2026-10-26')
    expect(result.problems).toEqual(['รูปถูกตัด'])
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('g-key')
    const body = calls[0].body as { contents: { parts: Record<string, unknown>[] }[]; generationConfig: Record<string, unknown> }
    expect(body.contents[0].parts.map((p) => Object.keys(p)[0])).toEqual(['inline_data', 'inline_data', 'text'])
    expect(body.generationConfig.responseJsonSchema).toBeDefined()
  })

  it('says so when Gemini blocks the file', async () => {
    const error = await createGeminiReader({ apiKey: 'k', model: 'm' }, scripted([{ status: 200, body: { promptFeedback: { blockReason: 'SAFETY' } } }]).fetchFn)
      .read([image], '2026-10-26')
      .catch((e: unknown) => e)
    expect(describeAiError(error)).toBe('AI ไม่อ่านไฟล์นี้ ลองใช้รูปอื่นหรือกรอกรายการเอง')
  })
})

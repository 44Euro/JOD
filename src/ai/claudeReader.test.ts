import { describe, expect, it } from 'vitest'
import type { PreparedFile } from './files'
import { createClaudeReader } from './claudeReader'
import { AI_MODEL, describeAiError } from './reader'

const answer = { source: 'portfolio', rows: [], statedTotal: null, statedTotalCurrency: null, costIncludesFees: null, problems: ['รูปถูกตัด'] }

function sse(text: string, stopReason = 'end_turn'): string {
  const events: [string, object][] = [
    ['message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: AI_MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } }],
    ['message_stop', { type: 'message_stop' }],
  ]
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')
}

function fakeFetch(body: string, status = 200) {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(body, { status, headers: { 'content-type': status === 200 ? 'text/event-stream' : 'application/json' } })
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

const image: PreparedFile = { kind: 'image', name: 'a.png', mediaType: 'image/png', data: 'AAAA', width: 10, height: 10, previewUrl: '' }
const csv: PreparedFile = { kind: 'text', name: 'orders.csv', data: 'a,b' }

describe('createClaudeReader', () => {
  it('sends every file to the model with the extraction schema and reads the JSON answer', async () => {
    const { fetch, calls } = fakeFetch(sse(JSON.stringify(answer)))
    const result = await createClaudeReader('sk-ant-test', fetch).read([image, csv], '2026-10-25')
    expect(result.problems).toEqual(['รูปถูกตัด'])
    const body = calls[0].body as { model: string; output_config: { effort: string; format: { type: string } }; messages: { content: { type: string; source?: { type: string } }[] }[]; system: string }
    expect(body.model).toBe('claude-sonnet-5-5')
    expect(body.output_config.effort).toBe('low')
    expect(body.output_config.format.type).toBe('json_schema')
    expect(body.messages[0].content.map((c) => [c.type, c.source?.type])).toEqual([['image', 'base64'], ['document', 'text'], ['text', undefined]])
    expect(body.system).toContain('Today is 2026-10-25')
  })

  it('says so when the model refuses or runs out of room, instead of showing an empty review', async () => {
    await expect(createClaudeReader('k', fakeFetch(sse('', 'refusal')).fetch).read([image], '2026-10-25')).rejects.toThrow('AI ไม่อ่านไฟล์นี้')
    await expect(createClaudeReader('k', fakeFetch(sse('{"rows":', 'max_tokens')).fetch).read([image], '2026-10-25')).rejects.toThrow('แบ่งเป็นหลายครั้ง')
  })

  it('turns a wrong key into a Thai message that points at the settings', async () => {
    const error = await createClaudeReader('bad', fakeFetch(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), 401).fetch)
      .read([image], '2026-10-25')
      .catch((e: unknown) => e)
    expect(describeAiError(error)).toBe('API key ไม่ถูกต้อง ตรวจอีกครั้งในหน้าตั้งค่า')
  })
})

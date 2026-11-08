import { describe, expect, it } from 'vitest'
import { ask, type ChatTool } from './chat'
import { createClaudeChat } from './claudeChat'
import type { PreparedFile } from './files'
import { AI_MODEL, describeAiError } from './reader'

const image: PreparedFile = { kind: 'image', name: 'a.png', mediaType: 'image/png', data: 'AAAA', width: 10, height: 10, previewUrl: '' }

const holdings: ChatTool = {
  name: 'holdings',
  description: 'The holdings.',
  schema: { type: 'object', properties: { limit: { type: 'integer' } } },
  run: async (input) => ({ asked: input, rows: [{ symbol: 'AAPL' }] }),
}

type Block = { type: 'text'; text: string } | { type: 'thinking'; thinking: string; signature: string } | { type: 'tool_use'; id: string; name: string; input: string }

function sse(blocks: Block[], stopReason: string): string {
  const events: [string, object][] = [
    ['message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: AI_MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
  ]
  blocks.forEach((block, index) => {
    if (block.type === 'text') {
      events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }])
      for (const piece of block.text.split('|')) events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } }])
    } else if (block.type === 'thinking') {
      events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } }])
      events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } }])
      events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } }])
    } else {
      events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } }])
      events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: block.input } }])
    }
    events.push(['content_block_stop', { type: 'content_block_stop', index }])
  })
  events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } }])
  events.push(['message_stop', { type: 'message_stop' }])
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')
}

function fakeFetch(bodies: { body: string; status?: number }[]) {
  const calls: Record<string, unknown>[] = []
  const fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body ?? '{}')))
    const next = bodies.shift() ?? { body: '{}', status: 500 }
    const status = next.status ?? 200
    return new Response(next.body, { status, headers: { 'content-type': status === 200 ? 'text/event-stream' : 'application/json' } })
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

describe('Claude chat', () => {
  it('streams the answer, runs the tool and sends its whole turn back with the result', async () => {
    const thinking: Block = { type: 'thinking', thinking: 'Look at holdings.', signature: 'sig' }
    const { fetch, calls } = fakeFetch([
      { body: sse([thinking, { type: 'tool_use', id: 'toolu_1', name: 'holdings', input: '{"limit": 5}' }], 'tool_use') },
      { body: sse([{ type: 'text', text: 'You hold |AAPL.' }], 'end_turn') },
    ])
    const streamed: string[] = []
    const result = await ask(createClaudeChat('sk-ant-test', fetch), 'be brief', [{ role: 'user', text: 'What do I hold?', image }], [holdings], { text: (d) => streamed.push(d) })
    expect(result).toEqual({ text: 'You hold AAPL.', used: ['holdings'] })
    expect(streamed).toEqual(['You hold ', 'AAPL.'])
    const first = calls[0] as { model: string; system: string; stream: boolean; thinking: unknown; output_config: unknown; tools: Record<string, unknown>[]; messages: { content: { type: string }[] }[] }
    expect([first.model, first.system, first.stream]).toEqual(['claude-sonnet-5-5', 'be brief', true])
    expect(first.thinking).toEqual({ type: 'adaptive' })
    expect(first.output_config).toEqual({ effort: 'low' })
    expect(first.tools[0]).toEqual({ name: 'holdings', description: 'The holdings.', input_schema: holdings.schema, eager_input_streaming: true })
    expect(first.messages[0].content.map((c) => c.type)).toEqual(['image', 'text'])
    const second = calls[1] as { messages: { role: string; content: Record<string, unknown>[] }[] }
    expect(second.messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Look at holdings.', signature: 'sig' },
        { type: 'tool_use', id: 'toolu_1', name: 'holdings', input: { limit: 5 } },
      ],
    })
    expect(second.messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"asked":{"limit":5},"rows":[{"symbol":"AAPL"}]}' }] })
  })

  it('explains a refusal, an answer cut off and a wrong key in Thai', async () => {
    const refused = await ask(createClaudeChat('k', fakeFetch([{ body: sse([], 'refusal') }]).fetch), 's', [{ role: 'user', text: 'x' }], [], { text: () => {} }).catch((e: unknown) => e)
    expect(describeAiError(refused)).toBe('AI ไม่ตอบคำถามนี้ ลองถามแบบอื่น')
    const cut = await ask(createClaudeChat('k', fakeFetch([{ body: sse([{ type: 'text', text: 'a' }], 'max_tokens') }]).fetch), 's', [{ role: 'user', text: 'x' }], [], { text: () => {} }).catch((e: unknown) => e)
    expect(describeAiError(cut)).toBe('คำตอบยาวเกินไป ลองถามให้แคบลง')
    const auth = JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })
    const wrongKey = await ask(createClaudeChat('bad', fakeFetch([{ body: auth, status: 401 }]).fetch), 's', [{ role: 'user', text: 'x' }], [], { text: () => {} }).catch((e: unknown) => e)
    expect(describeAiError(wrongKey)).toBe('API key ไม่ถูกต้อง ตรวจอีกครั้งในหน้าตั้งค่า')
  })
})

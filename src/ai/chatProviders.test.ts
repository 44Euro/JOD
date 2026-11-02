import { describe, expect, it } from 'vitest'
import { ask, type ChatTool } from './chat'
import { createGeminiChat, createOpenAiChat } from './chatProviders'
import type { PreparedFile } from './files'
import { describeAiError } from './reader'

const image: PreparedFile = { kind: 'image', name: 'a.png', mediaType: 'image/png', data: 'AAAA', width: 10, height: 10, previewUrl: '' }

const quotes: ChatTool = {
  name: 'market_quotes',
  description: 'Latest prices.',
  schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
  run: async (input) => ({ asked: input, price: '190.5' }),
}

// Each response is a list of SSE data payloads; a status other than 200 answers with an empty JSON body.
function scripted(responses: ({ status: number } | unknown[])[]) {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = []
  const fetchFn = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init, body: JSON.parse(String(init.body)) })
    const next = responses.shift() ?? { status: 500 }
    if (!Array.isArray(next)) return new Response('{}', { status: next.status })
    return new Response(next.map((d) => `data: ${typeof d === 'string' ? d : JSON.stringify(d)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch
  return { fetchFn, calls }
}

describe('OpenAI-style chat', () => {
  it('streams the answer and joins a tool call whose arguments arrive in pieces', async () => {
    const { fetchFn, calls } = scripted([
      [
        { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'market_quotes', arguments: '{"ids": ["US' } }] } }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: ':AAPL"]}' } }] } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
        '[DONE]',
      ],
      [{ choices: [{ index: 0, delta: { content: 'AAPL is ' } }] }, { choices: [{ index: 0, delta: { content: '190.50' }, finish_reason: 'stop' }] }, '[DONE]'],
    ])
    const streamed: string[] = []
    const model = createOpenAiChat({ apiKey: 'sk-x', model: 'gpt-4.1' }, 'OpenAI', fetchFn)
    const result = await ask(model, 'be brief', [{ role: 'user', text: 'AAPL?', image }], [quotes], { text: (d) => streamed.push(d) })
    expect(result).toEqual({ text: 'AAPL is 190.50', used: ['market_quotes'] })
    expect(streamed).toEqual(['AAPL is ', '190.50'])
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions')
    const first = calls[0].body as { stream: boolean; tools: { function: { name: string } }[]; messages: { role: string; content: unknown }[] }
    expect([first.stream, first.tools[0].function.name]).toEqual([true, 'market_quotes'])
    expect(first.messages[0]).toEqual({ role: 'system', content: 'be brief' })
    expect((first.messages[1].content as { type: string }[]).map((c) => c.type)).toEqual(['image_url', 'text'])
    const second = calls[1].body as { messages: Record<string, unknown>[] }
    expect(second.messages.slice(2)).toEqual([
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'market_quotes', arguments: '{"ids": ["US:AAPL"]}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: '{"asked":{"ids":["US:AAPL"]},"price":"190.5"}' },
    ])
  })

  it('talks to a compatible service without a key and explains a refused request in Thai', async () => {
    const { fetchFn, calls } = scripted([{ status: 400 }])
    const model = createOpenAiChat({ apiKey: '', model: 'llama3', baseUrl: 'http://localhost:11434/v1/' }, 'localhost', fetchFn)
    const error = await ask(model, 's', [{ role: 'user', text: 'hi' }], [quotes], { text: () => {} }).catch((e: unknown) => e)
    expect(calls[0].url).toBe('http://localhost:11434/v1/chat/completions')
    expect(calls[0].init.headers).not.toHaveProperty('authorization')
    expect(describeAiError(error)).toBe('localhost ไม่รับคำถามนี้ รุ่นที่ตั้งไว้อาจใช้เครื่องมือหรืออ่านรูปไม่ได้')
  })

  it('explains a wrong key and an answer cut off for length', async () => {
    const wrongKey = await ask(createOpenAiChat({ apiKey: 'bad', model: 'm' }, 'OpenAI', scripted([{ status: 401 }]).fetchFn), 's', [], [], { text: () => {} }).catch((e: unknown) => e)
    expect(describeAiError(wrongKey)).toBe('API key ของ OpenAI ไม่ถูกต้องหรือไม่มีสิทธิ์ ตรวจในหน้าตั้งค่า')
    const long = scripted([[{ choices: [{ index: 0, delta: { content: 'a' }, finish_reason: 'length' }] }, '[DONE]']])
    const cut = await ask(createOpenAiChat({ apiKey: 'k', model: 'm' }, 'OpenAI', long.fetchFn), 's', [], [], { text: () => {} }).catch((e: unknown) => e)
    expect(describeAiError(cut)).toBe('คำตอบยาวเกินไป ลองถามให้แคบลง')
  })
})

describe('Gemini chat', () => {
  it('streams the answer and hands the model its own parts back with the function response', async () => {
    const call = { functionCall: { name: 'market_quotes', args: { ids: ['US:AAPL'] } }, thoughtSignature: 'sig-1' }
    const { fetchFn, calls } = scripted([
      [{ candidates: [{ content: { role: 'model', parts: [call] }, finishReason: 'STOP' }] }],
      [{ candidates: [{ content: { role: 'model', parts: [{ text: 'AAPL is ' }] } }] }, { candidates: [{ content: { role: 'model', parts: [{ text: '190.50' }] }, finishReason: 'STOP' }] }],
    ])
    const streamed: string[] = []
    const model = createGeminiChat({ apiKey: 'g-key', model: 'gemini-2.5-flash' }, fetchFn)
    const result = await ask(model, 'be brief', [{ role: 'user', text: 'AAPL?' }, { role: 'assistant', text: 'Hello' }, { role: 'user', text: 'and now?', image }], [quotes], {
      text: (d) => streamed.push(d),
    })
    expect(result).toEqual({ text: 'AAPL is 190.50', used: ['market_quotes'] })
    expect(streamed).toEqual(['AAPL is ', '190.50'])
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse')
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('g-key')
    const first = calls[0].body as { systemInstruction: unknown; contents: { role: string; parts: Record<string, unknown>[] }[]; tools: { functionDeclarations: { name: string; parametersJsonSchema: unknown }[] }[] }
    expect(first.systemInstruction).toEqual({ parts: [{ text: 'be brief' }] })
    expect(first.contents.map((c) => c.role)).toEqual(['user', 'model', 'user'])
    expect(first.contents[2].parts.map((p) => Object.keys(p)[0])).toEqual(['inline_data', 'text'])
    expect(first.tools[0].functionDeclarations[0]).toEqual({ name: 'market_quotes', description: 'Latest prices.', parametersJsonSchema: quotes.schema })
    const second = calls[1].body as { contents: unknown[] }
    expect(second.contents.slice(3)).toEqual([
      { role: 'model', parts: [call] },
      { role: 'user', parts: [{ functionResponse: { name: 'market_quotes', response: { result: { asked: { ids: ['US:AAPL'] }, price: '190.5' } } } }] },
    ])
  })

  it('says so when Gemini blocks the question', async () => {
    const { fetchFn } = scripted([[{ promptFeedback: { blockReason: 'SAFETY' } }]])
    const error = await ask(createGeminiChat({ apiKey: 'k', model: 'm' }, fetchFn), 's', [{ role: 'user', text: 'x' }], [], { text: () => {} }).catch((e: unknown) => e)
    expect(describeAiError(error)).toBe('AI ไม่ตอบคำถามนี้ ลองถามแบบอื่น')
  })
})

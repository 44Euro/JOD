import { describe, expect, it } from 'vitest'
import { ask, sseData, type ChatModel, type ChatTool, type ToolCall } from './chat'
import { AiError } from './reader'

// A model that plays back a script: each round streams its text and then asks for its calls.
function scripted(rounds: { text?: string[]; calls?: ToolCall[] }[]) {
  const given: { call: ToolCall; content: string }[][] = []
  const model: ChatModel = () => {
    let round = 0
    return {
      async next(onText) {
        const step = rounds[round++] ?? {}
        for (const delta of step.text ?? []) onText(delta)
        return step.calls ?? []
      },
      give(results) {
        given.push([...results])
      },
    }
  }
  return { model, given }
}

const holdings: ChatTool = {
  name: 'holdings',
  description: 'The holdings.',
  schema: { type: 'object', properties: {} },
  run: async () => [{ symbol: 'AAPL', value: '1000' }],
}

describe('ask', () => {
  it('runs the tools the model asks for and returns the answer with the tools it used', async () => {
    const { model, given } = scripted([
      { calls: [{ id: 't1', name: 'holdings', input: {} }] },
      { text: ['AAPL ', 'is 1,000'] },
    ])
    const streamed: string[] = []
    const tools: string[] = []
    const result = await ask(model, 'system', [{ role: 'user', text: 'what do I hold?' }], [holdings], { text: (d) => streamed.push(d), tool: (n) => tools.push(n) })
    expect(result).toEqual({ text: 'AAPL is 1,000', used: ['holdings'] })
    expect(streamed.join('')).toBe('AAPL is 1,000')
    expect(tools).toEqual(['holdings'])
    expect(given[0]).toEqual([{ call: { id: 't1', name: 'holdings', input: {} }, content: '[{"symbol":"AAPL","value":"1000"}]' }])
  })

  it('answers an unknown tool and a failing tool with an error the model can read', async () => {
    const broken: ChatTool = { ...holdings, name: 'broken', run: async () => Promise.reject(new Error('symbol must look like US:AAPL')) }
    const { model, given } = scripted([
      { calls: [{ id: 'a', name: 'made_up', input: {} }, { id: 'b', name: 'broken', input: { ids: 'x' } }] },
      { text: ['sorry'] },
    ])
    const result = await ask(model, 'system', [], [holdings, broken], { text: () => {} })
    expect(given[0].map((r) => JSON.parse(r.content))).toEqual([{ error: 'There is no tool named made_up.' }, { error: 'symbol must look like US:AAPL' }])
    expect(result.used).toEqual(['broken'])
  })

  it('separates the text of two rounds with a blank line', async () => {
    const { model } = scripted([{ text: ['Let me look.'], calls: [{ id: 't', name: 'holdings', input: {} }] }, { text: ['You hold AAPL.'] }])
    const streamed: string[] = []
    const result = await ask(model, 'system', [], [holdings], { text: (d) => streamed.push(d) })
    expect(result.text).toBe('Let me look.\n\nYou hold AAPL.')
    expect(streamed.join('')).toBe(result.text)
  })

  it('gives up after eight rounds of tool calls', async () => {
    const { model } = scripted(Array.from({ length: 9 }, (_, i) => ({ calls: [{ id: `t${i}`, name: 'holdings', input: {} }] })))
    const error = await ask(model, 'system', [], [holdings], { text: () => {} }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiError)
    expect((error as Error).message).toBe('คำถามนี้ต้องค้นข้อมูลหลายรอบเกินไป ลองถามให้แคบลง')
  })
})

function body(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = []
  for await (const data of sseData(stream)) out.push(data)
  return out
}

describe('sseData', () => {
  it('yields each event data, joining events split across chunks', async () => {
    expect(await collect(body(['data: {"a":1}\n\nda', 'ta: {"b":2}\n', '\n', 'data: [DONE]\n\n']))).toEqual(['{"a":1}', '{"b":2}', '[DONE]'])
  })

  it('reads CRLF line ends, skips comments and event names, and keeps a last event without a blank line', async () => {
    expect(await collect(body([': ping\r\n\r\nevent: delta\r\ndata: one\r\n\r\ndata: two']))).toEqual(['one', 'two'])
  })
})

import type { PreparedFile } from './files'
import { AiError } from './reader'
import { t } from '../i18n'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  image?: PreparedFile
}

export interface ToolCall {
  id: string
  name: string
  input: unknown
}

// A tool reads the person's own data or the JOD market client; its input comes from the model, so it checks it.
export interface ChatTool {
  name: string
  description: string
  schema: Record<string, unknown>
  run(input: unknown): Promise<unknown>
}

// One question's exchange with a provider: each `next` streams one message and returns the tools it asks for.
export interface ChatSession {
  next(onText: (delta: string) => void, signal?: AbortSignal): Promise<ToolCall[]>
  give(results: readonly { call: ToolCall; content: string }[]): void
}

export type ChatModel = (system: string, history: readonly ChatMessage[], tools: readonly ChatTool[]) => ChatSession

const MAX_ROUNDS = 8

export async function ask(
  model: ChatModel,
  system: string,
  history: readonly ChatMessage[],
  tools: readonly ChatTool[],
  on: { text(delta: string): void; tool?(name: string): void },
  signal?: AbortSignal,
): Promise<{ text: string; used: string[] }> {
  const session = model(system, history, tools)
  const used = new Set<string>()
  let text = ''
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let gap = text.length > 0 && !text.endsWith('\n\n')
    const calls = await session.next((delta) => {
      // Text before a tool call ("let me look") and the answer after it read as two paragraphs.
      const piece = gap ? `\n\n${delta}` : delta
      gap = false
      text += piece
      on.text(piece)
    }, signal)
    if (calls.length === 0) return { text: text.trim(), used: [...used] }
    const results = []
    for (const call of calls) {
      const tool = tools.find((x) => x.name === call.name)
      let result: unknown
      if (!tool) result = { error: `There is no tool named ${call.name}.` }
      else {
        used.add(tool.name)
        on.tool?.(tool.name)
        result = await tool.run(call.input).catch((error: unknown) => ({ error: error instanceof Error ? error.message : 'The tool failed.' }))
      }
      results.push({ call, content: JSON.stringify(result) })
    }
    session.give(results)
  }
  throw new AiError(t('คำถามนี้ต้องค้นข้อมูลหลายรอบเกินไป ลองถามให้แคบลง'))
}

// The data lines of each server-sent event, as the streaming chat APIs send them.
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const dataOf = (event: string) =>
    event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n')
  for (;;) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const events = buffer.split(/\r?\n\r?\n/)
    buffer = done ? '' : (events.pop() ?? '')
    for (const event of events) {
      const data = dataOf(event)
      if (data) yield data
    }
    if (done) return
  }
}

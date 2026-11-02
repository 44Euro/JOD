import { sseData, type ChatModel, type ChatSession } from './chat'
import { failure, post, type ProviderSettings } from './otherReaders'
import { AiError, type ReaderMode } from './reader'
import { t } from '../i18n'

// Chat with the provider set for reading, over its streaming API, with the person's own key.

function chatFailure(status: number, provider: string): AiError {
  if (status === 400) return new AiError(t('{0} ไม่รับคำถามนี้ รุ่นที่ตั้งไว้อาจใช้เครื่องมือหรืออ่านรูปไม่ได้', provider))
  return failure(status, provider)
}

export const refused = () => new AiError(t('AI ไม่ตอบคำถามนี้ ลองถามแบบอื่น'))
export const tooLong = () => new AiError(t('คำตอบยาวเกินไป ลองถามให้แคบลง'))

interface OpenAiChunk {
  choices?: {
    delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }
    finish_reason?: string | null
  }[]
}

// An argument string the model left broken reaches the tool as nothing, and the tool says what it needs.
function parseArgs(args: string): unknown {
  try {
    return args ? JSON.parse(args) : {}
  } catch {
    return undefined
  }
}

export function createOpenAiChat(settings: ProviderSettings, provider = 'OpenAI', fetchFn: typeof fetch = (i, o) => fetch(i, o)): ChatModel {
  const base = (settings.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const headers: Record<string, string> = settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}
  return (system, history, tools) => {
    const messages: Record<string, unknown>[] = [
      { role: 'system', content: system },
      ...history.map((m) =>
        m.image
          ? { role: m.role, content: [{ type: 'image_url', image_url: { url: `data:${m.image.mediaType};base64,${m.image.data}` } }, { type: 'text', text: m.text }] }
          : { role: m.role, content: m.text },
      ),
    ]
    const declared = tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.schema } }))
    return {
      async next(onText, signal) {
        const res = await post(fetchFn, `${base}/chat/completions`, headers, { model: settings.model, messages, stream: true, ...(declared.length > 0 ? { tools: declared } : {}) }, signal)
        if (!res.ok || !res.body) throw chatFailure(res.status, provider)
        let text = ''
        let finish = ''
        const calls: { id: string; name: string; args: string }[] = []
        for await (const data of sseData(res.body)) {
          if (data === '[DONE]') break
          const choice = (JSON.parse(data) as OpenAiChunk).choices?.[0]
          if (choice?.delta?.content) {
            text += choice.delta.content
            onText(choice.delta.content)
          }
          for (const piece of choice?.delta?.tool_calls ?? []) {
            const index = piece.index ?? 0
            const call = (calls[index] ??= { id: `call_${index}`, name: '', args: '' })
            if (piece.id) call.id = piece.id
            call.name += piece.function?.name ?? ''
            call.args += piece.function?.arguments ?? ''
          }
          if (choice?.finish_reason) finish = choice.finish_reason
        }
        if (finish === 'length') throw tooLong()
        if (finish === 'content_filter') throw refused()
        const asked = calls.filter(Boolean)
        messages.push({
          role: 'assistant',
          content: text || null,
          ...(asked.length > 0 ? { tool_calls: asked.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })) } : {}),
        })
        return asked.map((c) => ({ id: c.id, name: c.name, input: parseArgs(c.args) }))
      },
      give(results) {
        for (const { call, content } of results) messages.push({ role: 'tool', tool_call_id: call.id, content })
      },
    }
  }
}

interface GeminiPart {
  text?: string
  thought?: boolean
  functionCall?: { id?: string; name: string; args?: unknown }
}

interface GeminiChunk {
  promptFeedback?: { blockReason?: string }
  candidates?: { finishReason?: string; content?: { parts?: GeminiPart[] } }[]
}

// Gemini's parts go back exactly as they came, since a thinking model's thought signatures ride on them.
export function createGeminiChat(settings: ProviderSettings, fetchFn: typeof fetch = (i, o) => fetch(i, o)): ChatModel {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:streamGenerateContent?alt=sse`
  return (system, history, tools) => {
    const contents: { role: string; parts: unknown[] }[] = history.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [...(m.image ? [{ inline_data: { mime_type: m.image.mediaType, data: m.image.data } }] : []), { text: m.text }],
    }))
    const declared = tools.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.schema }))
    return {
      async next(onText, signal) {
        const body = { systemInstruction: { parts: [{ text: system }] }, contents, ...(declared.length > 0 ? { tools: [{ functionDeclarations: declared }] } : {}) }
        const res = await post(fetchFn, url, { 'x-goog-api-key': settings.apiKey }, body, signal)
        if (!res.ok || !res.body) throw chatFailure(res.status, 'Gemini')
        const parts: GeminiPart[] = []
        let finish = ''
        for await (const data of sseData(res.body)) {
          const chunk = JSON.parse(data) as GeminiChunk
          if (chunk.promptFeedback?.blockReason) throw refused()
          const candidate = chunk.candidates?.[0]
          for (const part of candidate?.content?.parts ?? []) {
            parts.push(part)
            if (part.text && !part.thought) onText(part.text)
          }
          if (candidate?.finishReason) finish = candidate.finishReason
        }
        if (finish === 'MAX_TOKENS') throw tooLong()
        if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT') throw refused()
        contents.push({ role: 'model', parts })
        return parts.flatMap((p) => (p.functionCall ? [{ id: p.functionCall.id ?? '', name: p.functionCall.name, input: p.functionCall.args ?? {} }] : []))
      },
      give(results) {
        contents.push({
          role: 'user',
          parts: results.map(({ call, content }) => ({ functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: { result: JSON.parse(content) } } })),
        })
      },
    }
  }
}

// The SDK is about a third of the app's size, so it loads only when someone asks Claude.
function lazyClaudeChat(apiKey: string): ChatModel {
  return (system, history, tools) => {
    let session: ChatSession | undefined
    return {
      async next(onText, signal) {
        session ??= (await import('./claudeChat')).createClaudeChat(apiKey)(system, history, tools)
        return session.next(onText, signal)
      },
      give: (results) => session?.give(results),
    }
  }
}

export function createChatModel(mode: ReaderMode, settings: ProviderSettings): ChatModel {
  switch (mode) {
    case 'claude':
      return lazyClaudeChat(settings.apiKey)
    case 'gemini':
      return createGeminiChat(settings)
    case 'compatible':
      return createOpenAiChat(settings, settings.baseUrl ? new URL(settings.baseUrl).host : t('บริการแบบ OpenAI'))
    default:
      return createOpenAiChat({ ...settings, baseUrl: undefined })
  }
}

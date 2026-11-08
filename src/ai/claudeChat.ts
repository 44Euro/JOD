import Anthropic from '@anthropic-ai/sdk'
import type { ChatModel } from './chat'
import { refused, tooLong } from './chatProviders'
import { contentFor, translated } from './claudeReader'
import { AI_MODEL } from './reader'

// The browser calls the API directly with the person's own key, as the reader does.
export function createClaudeChat(apiKey: string, fetch?: typeof globalThis.fetch): ChatModel {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, fetch })
  return (system, history, tools) => {
    const messages: Anthropic.MessageParam[] = history.map((m) => ({
      role: m.role,
      content: m.image ? [contentFor(m.image), { type: 'text', text: m.text }] : m.text,
    }))
    // Inputs stream as they are written; each tool checks the input it gets, so a cut-off one is answered with an error.
    const declared: Anthropic.Tool[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.schema as Anthropic.Tool.InputSchema,
      eager_input_streaming: true,
    }))
    return {
      async next(onText, signal) {
        const message = await translated(() =>
          client.messages
            .stream(
              { model: AI_MODEL, max_tokens: 16_000, system, thinking: { type: 'adaptive' }, output_config: { effort: 'low' }, tools: declared, messages },
              { signal },
            )
            .on('text', (delta) => onText(delta))
            .finalMessage(),
        )
        if (message.stop_reason === 'refusal') throw refused()
        if (message.stop_reason === 'max_tokens') throw tooLong()
        // The whole turn goes back, thinking included, so the model continues from what it reasoned.
        messages.push({ role: 'assistant', content: message.content })
        return message.content.flatMap((block) => (block.type === 'tool_use' ? [{ id: block.id, name: block.name, input: block.input }] : []))
      },
      give(results) {
        messages.push({ role: 'user', content: results.map(({ call, content }) => ({ type: 'tool_result', tool_use_id: call.id, content })) })
      },
    }
  }
}

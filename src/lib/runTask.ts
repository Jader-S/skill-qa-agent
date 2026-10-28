import type { ChatMessage, LLMTask, TokenUsage } from './llm/provider'
import type { LLMConfig } from '../types'
import { getProvider, PRESETS } from './llm'
import { recordLlmCall } from './db'
import { estimateTokens } from './llmUsage'
import { uid } from './id'

/**
 * 统一的 LLM 调用入口：根据 settings 选择提供器（云端 / Ollama / Mock），
 * 流式累加文本。onToken 用于把增量回显到 UI（生成/追问场景）。
 */
export async function runTask(
  settings: LLMConfig,
  messages: ChatMessage[],
  task: LLMTask,
  onToken?: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const provider = getProvider(settings)
  const started = Date.now()
  const usageBox: { current: TokenUsage | null } = { current: null }
  let buf = ''
  let status: 'ok' | 'error' | 'aborted' = 'ok'
  try {
    const stream = provider.streamChat(messages, {
      task,
      signal,
      onUsage: (next) => {
        usageBox.current = next
      },
    })
    for await (const chunk of stream) {
      buf += chunk
      onToken?.(buf)
    }
    return buf
  } catch (error) {
    status = signal?.aborted ? 'aborted' : 'error'
    throw error
  } finally {
    const model = settings.useMock
      ? 'mock'
      : settings.model || PRESETS[settings.provider]?.model || settings.provider
    const usage = usageBox.current
    const promptTokens = usage?.promptTokens ?? estimateTokens(messages.map((m) => m.content).join('\n'))
    const completionTokens = usage?.completionTokens ?? estimateTokens(buf)
    void recordLlmCall({
      id: uid(),
      createdAt: Date.now(),
      task,
      provider: settings.useMock ? 'mock' : settings.provider,
      model,
      status,
      promptTokens,
      completionTokens,
      estimated: usage == null,
      durationMs: Date.now() - started,
    }).catch(() => {})
  }
}

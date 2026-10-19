import type { ChatMessage, LLMTask } from './llm/provider'
import type { LLMConfig } from '../types'
import { getProvider } from './llm'

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
  const stream = provider.streamChat(messages, { task, signal })
  let buf = ''
  for await (const chunk of stream) {
    buf += chunk
    onToken?.(buf)
  }
  return buf
}

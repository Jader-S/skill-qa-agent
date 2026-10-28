export type ChatRole = 'system' | 'user' | 'assistant'

export type ChatMessage = { role: ChatRole; content: string }

export type LLMTask =
  | 'generate'
  | 'score'
  | 'followup'
  | 'interview_q'
  | 'interview_score'
  | 'interview_eval'
  | 'optimize'
  | 'outline'
  | 'chapter_kps'
  | 'interest'

export type TokenUsage = { promptTokens: number; completionTokens: number }

export interface LLMProvider {
  id: string
  label: string
  streamChat(
    messages: ChatMessage[],
    opts?: {
      signal?: AbortSignal
      task?: LLMTask
      /** 接口在流式响应里带回用量时调用。没带回则由 runTask 按文本估算。 */
      onUsage?: (usage: TokenUsage) => void
    },
  ): AsyncIterable<string>
}

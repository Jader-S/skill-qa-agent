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

export interface LLMProvider {
  id: string
  label: string
  streamChat(
    messages: ChatMessage[],
    opts?: { signal?: AbortSignal; task?: LLMTask },
  ): AsyncIterable<string>
}

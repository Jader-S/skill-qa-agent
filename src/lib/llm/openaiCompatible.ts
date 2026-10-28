import type { ChatMessage, LLMProvider } from './provider'

export type OaiConfig = { baseURL: string; apiKey: string; model: string }

/**
 * OpenAI 兼容接口实现，覆盖 DeepSeek / OpenAI / 通义千问 / Ollama（均兼容 /v1/chat/completions）。
 * 通过 fetch 直接流式解析 SSE，无额外 SDK 依赖。
 */
export function createOpenAICompatibleProvider(
  id: string,
  label: string,
  cfg: OaiConfig,
): LLMProvider {
  return {
    id,
    label,
    async *streamChat(messages, opts) {
      const base = cfg.baseURL.replace(/\/+$/, '')
      let includeUsage = true
      let res: Response | null = null
      for (let attempt = 0; attempt < 2; attempt++) {
        res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: cfg.model,
            messages,
            stream: true,
            temperature: 0.3,
            ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
          }),
          signal: opts?.signal,
        })
        if (res.ok && res.body) break
        const text = await res.text().catch(() => '')
        const rejectedUsage =
          includeUsage && res.status === 400 && /stream_options|include_usage/i.test(text)
        if (rejectedUsage) {
          includeUsage = false
          continue
        }
        throw new Error(`LLM 请求失败 (${res.status}): ${text.slice(0, 200)}`)
      }
      if (!res?.ok || !res.body) {
        throw new Error('LLM 请求失败')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          const t = line.trim()
          if (!t.startsWith('data:')) continue
          const data = t.slice(5).trim()
          if (data === '[DONE]') return
          try {
            const json = JSON.parse(data)
            const usage = json.usage
            if (usage) {
              const prompt = usage.prompt_tokens ?? usage.input_tokens
              const completion = usage.completion_tokens ?? usage.output_tokens
              if (typeof prompt === 'number' || typeof completion === 'number') {
                opts?.onUsage?.({
                  promptTokens: Number(prompt) || 0,
                  completionTokens: Number(completion) || 0,
                })
              }
            }
            const delta: string | undefined = json.choices?.[0]?.delta?.content
            if (delta) yield delta
          } catch {
            /* ignore keep-alive / partial */
          }
        }
      }
    },
  }
}

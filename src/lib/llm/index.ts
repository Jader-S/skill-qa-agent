import type { LLMConfig } from '../../types'
import type { LLMProvider } from './provider'
import { createOpenAICompatibleProvider } from './openaiCompatible'
import { mockProvider } from './mock'

export const PRESETS: Record<
  string,
  { label: string; baseURL: string; model: string }
> = {
  deepseek: {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  openai: {
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  qwen: {
    label: '通义千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  ollama: {
    label: 'Ollama',
    baseURL: 'http://localhost:11434/v1',
    model: 'llama3',
  },
}

export function getProvider(cfg: LLMConfig): LLMProvider {
  if (cfg.useMock) return mockProvider
  const p = PRESETS[cfg.provider]
  if (!p) return mockProvider
  return createOpenAICompatibleProvider(cfg.provider, p.label, {
    baseURL: cfg.baseURL || p.baseURL,
    apiKey: cfg.apiKey,
    model: cfg.model || p.model,
  })
}

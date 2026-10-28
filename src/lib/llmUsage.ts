import { useSyncExternalStore } from 'react'
import type { LLMTask } from './llm/provider'

/** 中文按字计 1，其余约 4 个字符计 1。只在接口没返回用量时使用。 */
export function estimateTokens(text: string): number {
  let n = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    n += code >= 0x4e00 && code <= 0x9fff ? 1 : 0.25
  }
  return Math.ceil(n)
}

export const TASK_LABEL: Record<LLMTask, string> = {
  generate: '出题',
  score: '评分',
  followup: '追问',
  interview_q: '面试出题',
  interview_score: '面试评分',
  interview_eval: '面试总评',
  optimize: 'AI 补充',
  outline: '生成目录',
  chapter_kps: '生成知识点',
  interest: '兴趣补充',
}

let tick = 0
const listeners = new Set<() => void>()

export function bumpUsageTick(): void {
  tick += 1
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useUsageTick(): number {
  return useSyncExternalStore(subscribe, () => tick, () => tick)
}

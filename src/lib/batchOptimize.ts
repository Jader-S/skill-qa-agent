import { runTask } from './runTask'
import { buildOptimizeMessages } from './prompts'
import type { KnowledgePoint, LLMConfig } from '../types'

/**
 * 单个知识点的 AI 优化补充：基于笔记原文产出「补充与拓展」Markdown。
 * 与详情面板 / 章节批量共用同一逻辑，避免重复实现。
 */
export async function optimizeOne(
  settings: LLMConfig,
  kp: KnowledgePoint,
  signal?: AbortSignal,
  onToken?: (text: string) => void,
): Promise<string> {
  const { system, user } = buildOptimizeMessages(kp)
  const text = await runTask(
    settings,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    'optimize',
    onToken,
    signal,
  )
  return text.trim()
}

export interface BatchOptimizeResult {
  success: number
  failed: number
  skipped: number
  aborted: boolean
}

export interface BatchOptimizeOptions {
  settings: LLMConfig
  kps: KnowledgePoint[]
  /** 并发数（默认 2）：过低慢、过高易触发限流 429。 */
  concurrency?: number
  /** 跳过已有 AI 补充的知识点。 */
  skipOptimized?: boolean
  signal?: AbortSignal
  onProgress?: (done: number, total: number, current?: KnowledgePoint) => void
  /** 每完成一项回调：成功时 ai 为文本，失败时 error 有值。 */
  onItem?: (kp: KnowledgePoint, ai: string | null, error?: string) => void
}

/**
 * 章节级批量 AI 整理补充：以固定并发的小任务池顺序处理，避免一次性打爆 API。
 * 任一单项失败不影响其余项（失败隔离）。
 */
export async function runBatchOptimize(
  opts: BatchOptimizeOptions,
): Promise<BatchOptimizeResult> {
  const { settings, kps, concurrency = 2, skipOptimized = false, signal, onProgress, onItem } =
    opts

  const queue = kps.filter((k) => !(skipOptimized && k.aiContent))
  const skipped = kps.length - queue.length
  const total = queue.length

  let success = 0
  let failed = 0
  let done = 0
  let cursor = 0

  const worker = async () => {
    while (cursor < queue.length) {
      if (signal?.aborted) return
      const kp = queue[cursor++]
      onProgress?.(done, total, kp)
      try {
        const ai = await optimizeOne(settings, kp, signal)
        if (ai) {
          onItem?.(kp, ai)
          success++
        } else {
          onItem?.(kp, null, '返回为空')
          failed++
        }
      } catch (e: any) {
        if (signal?.aborted) return
        onItem?.(kp, null, e?.message || String(e))
        failed++
      } finally {
        done++
        onProgress?.(done, total)
      }
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, total || 1)) },
    () => worker(),
  )
  await Promise.all(workers)

  return { success, failed, skipped, aborted: !!signal?.aborted }
}

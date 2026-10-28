import { useSyncExternalStore } from 'react'
import { runBatchOptimize } from './batchOptimize'
import { useStore } from '../store/useStore'
import type { KnowledgePoint, LLMConfig } from '../types'

/**
 * 批量补充的进度放在组件外面。
 * 知识点页一切走就会卸载，进度条不能只存在那个组件里。
 * 刷新页面不会接着跑：请求本身已经断了，这里只保住同一次打开里的切换。
 */
export type OptimizeSession = {
  running: boolean
  done: number
  total: number
  current: string
  errCount: number
  summary: string | null
  scopeLabel: string
  busyIds: string[]
}

const idle: OptimizeSession = {
  running: false,
  done: 0,
  total: 0,
  current: '',
  errCount: 0,
  summary: null,
  scopeLabel: '',
  busyIds: [],
}

let snapshot: OptimizeSession = idle
let abort: AbortController | null = null
const listeners = new Set<() => void>()

function emit(next: OptimizeSession) {
  snapshot = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getOptimizeSession(): OptimizeSession {
  return snapshot
}

export function useOptimizeSession(): OptimizeSession {
  return useSyncExternalStore(subscribe, getOptimizeSession, getOptimizeSession)
}

/** 单条补充进行中。切页后再回来，按钮仍显示「生成中」。 */
export function trackOptimize(id: string): () => void {
  if (!snapshot.busyIds.includes(id)) {
    emit({ ...snapshot, busyIds: [...snapshot.busyIds, id] })
  }
  return () => {
    if (!snapshot.busyIds.includes(id)) return
    emit({ ...snapshot, busyIds: snapshot.busyIds.filter((x) => x !== id) })
  }
}

export function startOptimizeSession(opts: {
  settings: LLMConfig
  kps: KnowledgePoint[]
  skipOptimized: boolean
  skipMock: boolean
  scopeLabel: string
}): void {
  if (snapshot.running) return
  const ac = new AbortController()
  abort = ac
  emit({
    ...snapshot,
    running: true,
    done: 0,
    total: 0,
    current: '',
    errCount: 0,
    summary: null,
    scopeLabel: opts.scopeLabel,
  })

  void runBatchOptimize({
    settings: opts.settings,
    kps: opts.kps,
    concurrency: 2,
    skipOptimized: opts.skipOptimized,
    skipMock: opts.skipMock,
    signal: ac.signal,
    onProgress: (done, total, kp) => {
      emit({
        ...snapshot,
        running: true,
        done,
        total,
        current: kp?.title ?? snapshot.current,
      })
    },
    onItem: (kp, ai) => {
      if (ai) useStore.getState().optimizeKP(kp.id, ai)
      else emit({ ...snapshot, errCount: snapshot.errCount + 1 })
    },
  }).then((res) => {
    if (abort === ac) abort = null
    const summary =
      (res.aborted ? '已取消 · ' : '完成 · ') +
      (opts.scopeLabel ? `${opts.scopeLabel} · ` : '') +
      `成功 ${res.success}` +
      (res.failed ? ` · 失败 ${res.failed}` : '') +
      (res.skipped ? ` · 跳过已补充 ${res.skipped}` : '') +
      (res.skippedMock ? ` · 跳过 Mock 补充 ${res.skippedMock}` : '')
    emit({
      ...snapshot,
      running: false,
      current: '',
      summary,
    })
  })
}

export function cancelOptimizeSession(): void {
  abort?.abort()
}

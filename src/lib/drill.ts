import { useSyncExternalStore } from 'react'

/** 从错题本跳进自测或面试时，临时收窄知识点范围。刷新后清空。 */
export type Drill = { kind: 'quiz' | 'interview'; kpIds: string[] } | null

let drill: Drill = null
const listeners = new Set<() => void>()

function emit(next: Drill) {
  drill = next
  listeners.forEach((listener) => listener())
}

export function useDrill(): Drill {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => drill,
    () => drill,
  )
}

export function startDrill(next: Exclude<Drill, null>): void {
  emit(next)
}

export function clearDrill(): void {
  emit(null)
}

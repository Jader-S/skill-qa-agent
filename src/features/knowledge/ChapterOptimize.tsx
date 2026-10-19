import { useRef, useState } from 'react'
import { useStore } from '../../store/useStore'
import { runBatchOptimize } from '../../lib/batchOptimize'
import type { KnowledgePoint } from '../../types'

/**
 * 章节级「一键 AI 整理补充」：
 * - 对当前作用域内的全部知识点批量生成 AI 补充与拓展（原文不动，只写 aiContent）。
 * - 固定并发 + 失败隔离 + 实时进度 + 可随时取消。
 * - 默认跳过已有 AI 补充的知识点，支持「重跑全部」。
 */
export default function ChapterOptimize({
  kps,
  scopeLabel,
}: {
  kps: KnowledgePoint[]
  scopeLabel: string
}) {
  const settings = useStore((s) => s.settings)
  const optimizeKP = useStore((s) => s.optimizeKP)

  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [current, setCurrent] = useState('')
  const [skipOptimized, setSkipOptimized] = useState(true)
  const [summary, setSummary] = useState<string | null>(null)
  const [errCount, setErrCount] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  const pending = skipOptimized ? kps.filter((k) => !k.aiContent).length : kps.length

  const start = async () => {
    if (kps.length === 0 || running) return
    const ac = new AbortController()
    abortRef.current = ac
    setRunning(true)
    setSummary(null)
    setErrCount(0)
    setDone(0)
    setTotal(pending)
    setCurrent('')

    const res = await runBatchOptimize({
      settings,
      kps,
      concurrency: 2,
      skipOptimized,
      signal: ac.signal,
      onProgress: (d, t, kp) => {
        setDone(d)
        setTotal(t)
        if (kp) setCurrent(kp.title)
      },
      onItem: (kp, ai, err) => {
        if (ai) optimizeKP(kp.id, ai)
        else if (err) setErrCount((n) => n + 1)
      },
    })

    setRunning(false)
    setCurrent('')
    setSummary(
      (res.aborted ? '已取消 · ' : '完成 · ') +
        `成功 ${res.success}` +
        (res.failed ? ` · 失败 ${res.failed}` : '') +
        (res.skipped ? ` · 跳过已补充 ${res.skipped}` : ''),
    )
  }

  const cancel = () => abortRef.current?.abort()

  return (
    <div className="chapter-optimize">
      <div className="row" style={{ gap: 6 }}>
        <label
          className="muted"
          style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
          title="勾选后跳过已生成 AI 补充的知识点"
        >
          <input
            type="checkbox"
            checked={skipOptimized}
            disabled={running}
            onChange={(e) => setSkipOptimized(e.target.checked)}
            style={{ width: 'auto' }}
          />
          跳过已有补充
        </label>
        {!running ? (
          <button
            className="accent-2"
            onClick={start}
            disabled={pending === 0}
            title={
              pending === 0
                ? '该作用域内的知识点都已有 AI 补充（可取消勾选「跳过已有补充」重跑）'
                : '基于笔记原文，为每个知识点生成 AI 补充与拓展'
            }
          >
            ✨ 一键 AI 整理补充（{scopeLabel} {pending} 个）
          </button>
        ) : (
          <button className="danger" onClick={cancel}>
            停止
          </button>
        )}
      </div>

      {(running || summary) && (
        <div style={{ marginTop: 8, minWidth: 240 }}>
          {running && (
            <>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                整理中 {done}/{total}
                {current && <> · 当前：{current}</>}
                {errCount > 0 && <span className="badge bad" style={{ marginLeft: 6 }}>失败 {errCount}</span>}
              </div>
              <div className="score-bar">
                <div
                  className="score-fill"
                  style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }}
                />
              </div>
            </>
          )}
          {!running && summary && (
            <div className="muted" style={{ fontSize: 12 }}>{summary}</div>
          )}
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { optimizeSkipReason } from '../../lib/batchOptimize'
import { cancelOptimizeSession, startOptimizeSession, useOptimizeSession } from '../../lib/optimizeSession'
import type { KnowledgePoint } from '../../types'

/**
 * 章节级「一键 AI 整理补充」：
 * - 对当前作用域内的全部知识点批量生成 AI 补充与拓展（原文不动，只写 aiContent）。
 * - 固定并发 + 失败隔离 + 实时进度 + 可随时取消。进度放在页面外，切换 Tab 后仍可见。
 * - 默认跳过已有真实补充；Mock 占位默认重新生成。取消「跳过已有补充」则整批重跑，含 Mock。
 */
export default function ChapterOptimize({
  kps,
  scopeLabel,
}: {
  kps: KnowledgePoint[]
  scopeLabel: string
}) {
  const settings = useStore((s) => s.settings)
  const session = useOptimizeSession()

  const [skipOptimized, setSkipOptimized] = useState(true)
  const [redoMock, setRedoMock] = useState(true)

  const skipMock = skipOptimized && !redoMock
  const pending = kps.filter(
    (k) => optimizeSkipReason(k, { skipOptimized, skipMock }) === null,
  ).length
  const { running, done, total, current, errCount, summary } = session

  const start = () => {
    if (kps.length === 0 || running) return
    startOptimizeSession({ settings, kps, skipOptimized, skipMock, scopeLabel })
  }

  return (
    <div className="chapter-optimize">
      <div className="row" style={{ gap: 6 }}>
        <label
          className="muted"
          style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
          title="勾选后跳过已经由真实模型写过的补充。Mock 占位不在此列。"
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
        <label
          className="muted"
          style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
          title="勾选后，离线 Mock 占位会按当前模型重新生成。取消「跳过已有补充」时也会重做 Mock。"
        >
          <input
            type="checkbox"
            checked={!skipOptimized || redoMock}
            disabled={running || !skipOptimized}
            onChange={(e) => setRedoMock(e.target.checked)}
            style={{ width: 'auto' }}
          />
          重新生成 Mock 补充
        </label>
        {!running ? (
          <button
            className="accent-2"
            onClick={start}
            disabled={pending === 0}
            title={
              pending === 0
                ? '没有待整理的知识点。取消「跳过已有补充」可重跑真实补充；勾选「重新生成 Mock 补充」可重做离线占位。'
                : '基于笔记原文生成补充。已有真实补充可跳过，Mock 占位可整批重做。'
            }
          >
            ✨ 一键 AI 整理补充（{scopeLabel} {pending} 个）
          </button>
        ) : (
          <button className="danger" onClick={cancelOptimizeSession}>
            停止
          </button>
        )}
      </div>

      {(running || summary || (settings.useMock && pending > 0)) && (
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
          {!running && settings.useMock && pending > 0 && (
            <div className="muted" style={{ fontSize: 12, marginBottom: summary ? 4 : 0 }}>
              当前是 Mock 离线模式，批量结果仍是占位文案。要换成真实补充，请先在「设置」里关闭 Mock。
            </div>
          )}
          {!running && summary && (
            <div className="muted" style={{ fontSize: 12 }}>{summary}</div>
          )}
        </div>
      )}
    </div>
  )
}

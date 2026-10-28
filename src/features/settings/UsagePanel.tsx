import { useEffect, useMemo, useState } from 'react'
import { listLlmCalls } from '../../lib/db'
import type { LlmCallRow } from '../../lib/dbSchema'
import { TASK_LABEL, useUsageTick } from '../../lib/llmUsage'
import type { LLMTask } from '../../lib/llm/provider'

type RangeId = 'today' | '7d' | '30d' | 'all'

const RANGES: { id: RangeId; label: string }[] = [
  { id: 'today', label: '今天' },
  { id: '7d', label: '近 7 天' },
  { id: '30d', label: '近 30 天' },
  { id: 'all', label: '全部' },
]

function startOfDay(offsetDays: number): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - offsetDays)
  return d.getTime()
}

function rangeStart(id: RangeId): number {
  if (id === 'today') return startOfDay(0)
  if (id === '7d') return startOfDay(6)
  if (id === '30d') return startOfDay(29)
  return 0
}

function dayKey(ts: number): string {
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function fmt(n: number): string {
  return n.toLocaleString('zh-CN')
}

export default function UsagePanel() {
  const tick = useUsageTick()
  const [range, setRange] = useState<RangeId>('7d')
  const [rows, setRows] = useState<LlmCallRow[]>([])

  useEffect(() => {
    let alive = true
    void listLlmCalls(rangeStart(range)).then((list) => {
      if (alive) setRows(list)
    })
    return () => {
      alive = false
    }
  }, [range, tick])

  const summary = useMemo(() => {
    let ok = 0
    let failed = 0
    let prompt = 0
    let completion = 0
    let estimated = 0
    const byTask = new Map<string, { calls: number; tokens: number }>()
    const byDay = new Map<string, { calls: number; tokens: number }>()
    for (const row of rows) {
      if (row.status === 'ok') ok++
      else failed++
      prompt += row.promptTokens
      completion += row.completionTokens
      if (row.estimated) estimated++
      const tokens = row.promptTokens + row.completionTokens
      const task = byTask.get(row.task) ?? { calls: 0, tokens: 0 }
      task.calls++
      task.tokens += tokens
      byTask.set(row.task, task)
      const day = dayKey(row.createdAt)
      const bucket = byDay.get(day) ?? { calls: 0, tokens: 0 }
      bucket.calls++
      bucket.tokens += tokens
      byDay.set(day, bucket)
    }
    const days = [...byDay.entries()].map(([day, value]) => ({ day, ...value }))
    const maxTokens = Math.max(1, ...days.map((d) => d.tokens))
    return { ok, failed, prompt, completion, estimated, byTask, days, maxTokens }
  }, [rows])

  return (
    <div className="panel">
      <div className="row" style={{ marginBottom: 8 }}>
        <strong>AI 调用监控</strong>
        <div className="spacer" />
        {RANGES.map((item) => (
          <button
            key={item.id}
            className={range === item.id ? 'primary mini' : 'mini'}
            onClick={() => setRange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="muted" style={{ marginBottom: 10, fontSize: 12 }}>
        只统计次数和 token，不保存提问或回答正文。接口返回了用量就记真实数字，没返回则按文本长度估算。
      </div>
      {rows.length === 0 ? (
        <div className="empty">这段时间还没有调用。</div>
      ) : (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <span className="badge ok">{fmt(rows.length)} 次</span>
            <span className="badge ok">成功 {fmt(summary.ok)}</span>
            {summary.failed > 0 && <span className="badge bad">失败 {fmt(summary.failed)}</span>}
            <span className="badge">输入 {fmt(summary.prompt)}</span>
            <span className="badge">输出 {fmt(summary.completion)}</span>
            <span className="badge fix">合计 {fmt(summary.prompt + summary.completion)}</span>
          </div>
          {summary.estimated > 0 && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              其中 {summary.estimated} 次用量是估算（接口没有返回 token）。
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 72, marginBottom: 6 }}>
            {summary.days.map((day) => (
              <div
                key={day.day}
                title={`${day.day} · ${day.calls} 次 · ${fmt(day.tokens)} token`}
                style={{
                  flex: 1,
                  height: `${Math.max(4, Math.round((day.tokens / summary.maxTokens) * 100))}%`,
                  background: 'var(--accent)',
                  borderRadius: 3,
                  minWidth: 6,
                }}
              />
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11, marginBottom: 12 }}>
            {summary.days.length > 1
              ? `${summary.days[0].day} 至 ${summary.days[summary.days.length - 1].day}，柱高按当天 token 合计`
              : summary.days[0]
                ? `${summary.days[0].day}，柱高按当天 token 合计`
                : ''}
          </div>
          <div>
            {[...summary.byTask.entries()]
              .sort((a, b) => b[1].calls - a[1].calls)
              .map(([task, value]) => (
                <div key={task} className="row" style={{ fontSize: 13, marginBottom: 4 }}>
                  <span>{TASK_LABEL[task as LLMTask] ?? task}</span>
                  <div className="spacer" />
                  <span className="muted">
                    {value.calls} 次 · {fmt(value.tokens)} token
                  </span>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  )
}

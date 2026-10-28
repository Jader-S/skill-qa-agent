import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store/useStore'
import { subtreeIds } from '../../lib/courseTree'
import { runTask } from '../../lib/runTask'
import { extractJson } from '../../lib/llm/parse'
import { buildGenerateMessages, buildScoreMessages, buildFollowupMessages } from '../../lib/prompts'
import { uid } from '../../lib/id'
import type { Course, KnowledgePoint, Question, QuestionType } from '../../types'
import QuestionCard from './QuestionCard'
import { clearDrill, useDrill } from '../../lib/drill'

type Group = { course: Course; kps: KnowledgePoint[] }

export default function SelfTestView({ courseId }: { courseId: string | null }) {
  const courses = useStore((s) => s.courses)
  const allKps = useStore((s) => s.knowledgePoints)
  const questions = useStore((s) => s.questions)
  const addQuestions = useStore((s) => s.addQuestions)
  const settings = useStore((s) => s.settings)
  const drill = useDrill()

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState('')

  // 选中课程子树内的全部知识点，按「所属章节（直接父课程）」分组 —— 出题按目录分类。
  const groups = useMemo<Group[]>(() => {
    if (drill?.kind !== 'quiz' && !courseId) return []
    const ids = courseId ? new Set(subtreeIds(courses, courseId)) : null
    const courseById = new Map(courses.map((c) => [c.id, c]))
    const map = new Map<string, KnowledgePoint[]>()
    for (const k of allKps) {
      if (drill?.kind === 'quiz') {
        if (!drill.kpIds.includes(k.id)) continue
      } else if (!ids?.has(k.courseId)) continue
      const cid = k.courseId
      if (!map.has(cid)) map.set(cid, [])
      map.get(cid)!.push(k)
    }
    return [...map.entries()]
      .map(([cid, kps]) => ({ course: courseById.get(cid)!, kps }))
      .filter((g) => g.course)
      .sort((a, b) => a.course.sort - b.course.sort)
  }, [courseId, courses, allKps, drill])

  const flatKps = useMemo(() => groups.flatMap((g) => g.kps), [groups])

  useEffect(() => {
    setSelected(new Set(flatKps.map((k) => k.id)))
  }, [courseId, flatKps.length])

  if (!courseId && drill?.kind !== 'quiz') {
    return (
      <div>
        <h2 className="page-title">自测</h2>
        <div className="empty">请在左侧课程目录中选择一门课程，进入后按章节生成题目。</div>
      </div>
    )
  }

  const visibleQuestions = questions.filter((q) => selected.has(q.kpId))
  const kpById = (id: string) => flatKps.find((k) => k.id === id)

  // 生成指定知识点（默认按 5 个一批，单批失败隔离）。chapterName 用于提示章节上下文。
  const generateSome = async (targets: KnowledgePoint[], label: string) => {
    if (targets.length === 0) return
    const BATCH = 5
    const qs: Question[] = []
    let failed = 0
    for (let i = 0; i < targets.length; i += BATCH) {
      const group = targets.slice(i, i + BATCH)
      setProgress(`${label}：${Math.min(i + BATCH, targets.length)}/${targets.length}…`)
      try {
        const { system, user } = buildGenerateMessages(group, 2)
        const text = await runTask(
          settings,
          [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          'generate',
        )
        const arr = extractJson<any[]>(text)
        arr.forEach((x) => {
          if (!x || typeof x.stem !== 'string' || !x.stem.trim()) return
          const type: QuestionType =
            x.type === 'choice' ? 'choice' : x.type === 'code' ? 'code' : 'short_answer'
          qs.push({
            id: uid(),
            kpId: group.find((k) => x.kp === k.title || k.title.endsWith(x.kp ?? ''))?.id ?? group[0].id,
            type,
            stem: x.stem,
            options: Array.isArray(x.options) ? x.options : undefined,
            modelAnswer: typeof x.modelAnswer === 'string' ? x.modelAnswer : '',
            difficulty: x.difficulty ?? 'medium',
            explanation: x.explanation ?? '',
            createdAt: Date.now(),
          })
        })
      } catch {
        failed++
      }
    }
    if (qs.length > 0) addQuestions(qs)
    if (qs.length === 0) {
      alert(`「${label}」生成失败：所有批次均未成功，请检查网络 / API Key / 额度后重试。`)
    } else if (failed > 0) {
      alert(`「${label}」部分批次失败：成功 ${qs.length} 题，${failed} 批未成功，可重试补齐。`)
    }
    return qs.length
  }

  const generateAll = async () => {
    const targets = flatKps.filter((k) => selected.has(k.id))
    if (targets.length === 0) return
    setGenerating(true)
    try {
      // 逐章节调用，避免把所有知识点一股脑丢给 AI。
      let total = 0
      for (const g of groups) {
        const gTargets = g.kps.filter((k) => selected.has(k.id))
        total += (await generateSome(gTargets, g.course.name)) ?? 0
      }
      if (total > 0) setProgress('')
    } finally {
      setGenerating(false)
      setProgress('')
    }
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const toggleGroup = (g: Group) => {
    const allIn = g.kps.every((k) => selected.has(k.id))
    setSelected((prev) => {
      const next = new Set(prev)
      g.kps.forEach((k) => (allIn ? next.delete(k.id) : next.add(k.id)))
      return next
    })
  }

  const selectedCount = flatKps.filter((k) => selected.has(k.id)).length

  return (
    <>
    {drill?.kind === 'quiz' && (
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="badge fix">正在按错题本里的知识点再练</span>
        <button className="mini" onClick={clearDrill}>退出再练</button>
      </div>
    )}
    <div>
      <h2 className="page-title">自测</h2>

      <div className="panel">
        <div className="muted" style={{ marginBottom: 8 }}>
          知识点按所属章节分组，可逐章生成题目（默认全选）。出题以章节为单位调用 AI，避免整体倾倒。
        </div>
        <div className="row">
          <button
            className="primary"
            onClick={generateAll}
            disabled={generating || selectedCount === 0}
          >
            {generating ? progress || '生成中…' : '按章节生成题目（全选）'}
          </button>
          <span className="muted">已选 {selectedCount} / {flatKps.length} 个知识点 · 已生成 {visibleQuestions.length} 题</span>
        </div>
      </div>

      {groups.map((g) => {
        const gSel = g.kps.filter((k) => selected.has(k.id))
        return (
          <div className="panel" key={g.course.id}>
            <div className="row" style={{ marginBottom: 6 }}>
              <strong>📂 {g.course.name}</strong>
              <span className="muted">{g.kps.length} 个知识点</span>
              <div className="spacer" />
              <button className="mini ghost" onClick={() => toggleGroup(g)}>
                {g.kps.every((k) => selected.has(k.id)) ? '取消本章' : '全选本章'}
              </button>
              <button
                className="mini accent-2"
                disabled={generating || gSel.length === 0}
                onClick={() => {
                  setGenerating(true)
                  generateSome(gSel, g.course.name).finally(() => setGenerating(false))
                }}
              >
                生成本章题目
              </button>
            </div>
            <div className="row">
              {g.kps.map((k) => (
                <label key={k.id} style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selected.has(k.id)}
                    onChange={() => toggle(k.id)}
                    style={{ width: 'auto', marginRight: 4 }}
                  />
                  {k.title}
                </label>
              ))}
              {g.kps.length === 0 && <span className="muted">本章暂无知识点。</span>}
            </div>
          </div>
        )
      })}
      {groups.length === 0 && <div className="empty">该课程下暂无知识点，请先去「知识点」录入或导入。</div>}

      <div style={{ marginTop: 12 }}>
        {visibleQuestions.map((q) => {
          const kp = kpById(q.kpId)
          if (!kp) return null
          return <QuestionCard key={q.id} q={q} kp={kp} settings={settings} />
        })}
        {visibleQuestions.length === 0 && (
          <div className="empty">还没有题目。勾选知识点后点击「生成题目」。</div>
        )}
      </div>
    </div>
    </>
  )
}

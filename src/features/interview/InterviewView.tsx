import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store/useStore'
import { subtreeIds } from '../../lib/courseTree'
import { runTask } from '../../lib/runTask'
import { extractJson } from '../../lib/llm/parse'
import {
  buildInterviewQuestionMessages,
  buildInterviewScoreMessages,
  buildInterviewEvalMessages,
} from '../../lib/prompts'
import { LexicalRetriever, chunksToContext, type RetrievedChunk } from '../../lib/retrieval'
import { downloadMarkdown } from '../../lib/exportObsidian'
import { speech } from '../../lib/speech'
import type { InterviewRound, InterviewReport, KnowledgePoint } from '../../types'

type Phase = 'config' | 'running' | 'done'

export default function InterviewView({ courseId = null }: { courseId?: string | null }) {
  const courses = useStore((s) => s.courses)
  const allKps = useStore((s) => s.knowledgePoints)
  const settings = useStore((s) => s.settings)
  const interviewSessions = useStore((s) => s.interviewSessions)
  const addInterviewSession = useStore((s) => s.addInterviewSession)
  const voice = useStore((s) => s.voice)
  const setLiveInterview = useStore((s) => s.setLiveInterview)

  // 恢复上次未完成的面试快照：切换目录 / 切换 Tab / 刷新后仍可继续。
  const restoredRef = useRef(useStore.getState().liveInterview ?? null)
  const snap = restoredRef.current && restoredRef.current.phase !== 'config' ? restoredRef.current : null

  const [scope, setScope] = useState<string>(snap?.scope ?? courseId ?? 'all')
  const [role, setRole] = useState(snap?.role ?? '前端工程师')
  const [rounds, setRounds] = useState(snap?.rounds ?? 5)
  const [phase, setPhase] = useState<Phase>(snap?.phase ?? 'config')

  const [current, setCurrent] = useState<{ question: string; intent: string; reference: string } | null>(
    snap?.current ?? null,
  )
  const [answer, setAnswer] = useState('')
  const [history, setHistory] = useState<InterviewRound[]>(snap?.history ?? [])
  const [roundIdx, setRoundIdx] = useState(snap?.roundIdx ?? 0)
  const [busy, setBusy] = useState(false)
  const [streaming, setStreaming] = useState('')
  const [report, setReport] = useState<InterviewReport | null>(snap?.report ?? null)
  const [listening, setListening] = useState(false)
  const [partial, setPartial] = useState('')

  // 运行期快照（避免闭包陈旧）
  const kpsRef = useRef<KnowledgePoint[]>([])
  const retrieverRef = useRef<LexicalRetriever>(new LexicalRetriever())
  const ctxRef = useRef<string>('')
  const scopeNameRef = useRef(snap?.scopeName ?? '全部知识库')

  // 首次挂载：用快照里的知识点 id 重建检索器与 grounding 上下文（仅恢复一次）。
  useEffect(() => {
    const s = restoredRef.current
    if (!s || s.phase === 'config') return
    const kps = useStore.getState().knowledgePoints.filter((k) => s.kpIds.includes(k.id))
    if (kps.length === 0) return
    kpsRef.current = kps
    retrieverRef.current.buildIndex(kps)
    ctxRef.current = s.ctx
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 把本轮进度实时写回 store（自动落库）；回到配置页即视为本轮结束，清空快照。
  useEffect(() => {
    if (phase === 'config') {
      if (useStore.getState().liveInterview) setLiveInterview(null)
      return
    }
    setLiveInterview({
      phase,
      role,
      rounds,
      scope,
      scopeName: scopeNameRef.current,
      current,
      history,
      roundIdx,
      report,
      ctx: ctxRef.current,
      kpIds: kpsRef.current.map((k) => k.id),
      updatedAt: Date.now(),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, current, history, roundIdx, report])

  const flatCourses = useMemo(() => {
    const out: { id: string; label: string }[] = []
    const walk = (parentId: string | null, depth: number) => {
      courses
        .filter((c) => c.parentId === parentId)
        .forEach((c) => {
          out.push({ id: c.id, label: '　'.repeat(depth) + c.name })
          walk(c.id, depth + 1)
        })
    }
    walk(null, 0)
    return out
  }, [courses])

  const start = () => {
    const kps =
      scope === 'all'
        ? allKps
        : allKps.filter((k) => subtreeIds(courses, scope).includes(k.courseId))
    if (kps.length === 0) {
      alert('所选范围下没有知识点，请先导入或选择其他范围。')
      return
    }
    kpsRef.current = kps
    retrieverRef.current.buildIndex(kps)
    scopeNameRef.current =
      scope === 'all' ? '全部知识库' : courses.find((c) => c.id === scope)?.name ?? '所选课程'
    setHistory([])
    setRoundIdx(0)
    setReport(null)
    setAnswer('')
    setPhase('running')
    askQuestion(0, kps, [])
  }

  const startListen = async () => {
    if (listening) {
      speech.stopListening()
      setListening(false)
      return
    }
    setListening(true)
    setPartial('聆听中…')
    try {
      const t = await speech.listen({ lang: voice.lang, onPartial: setPartial })
      if (t) setAnswer((prev) => (prev.trim() ? prev.trimEnd() + '\n' + t : t))
    } catch (e: any) {
      alert(e.message)
    } finally {
      setListening(false)
      setPartial('')
    }
  }
  const askQuestion = async (i: number, kps: KnowledgePoint[], askedHistory: InterviewRound[]) => {
    setBusy(true)
    setStreaming('面试官出题中…')
    setAnswer('')
    setCurrent(null)
    try {
      const intent = ['基础概念', '原理深挖', '实战编码', '调试排错', '系统设计'][i % 5]
      const query = `${role} 面试 ${intent}`
      const chunks: RetrievedChunk[] = retrieverRef.current.retrieve(query, kps, 3)
      const context = chunksToContext(chunks)
      ctxRef.current = context
      const { system, user } = buildInterviewQuestionMessages(
        role,
        context,
        i,
        askedHistory.map((h) => h.question),
      )
      const out = await runTask(
        settings,
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        'interview_q',
      )
      const q = extractJson<{ question: string; intent: string; reference: string }>(out)
      setCurrent({ question: q.question, intent: q.intent || intent, reference: q.reference })
    } catch (e: any) {
      setStreaming('出题失败：' + e.message)
    } finally {
      setBusy(false)
      setStreaming('')
    }
  }

  const submitAnswer = async () => {
    if (!current || !answer.trim()) return
    setBusy(true)
    setStreaming('评分中…')
    try {
      const { system, user } = buildInterviewScoreMessages(role, ctxRef.current, {
        question: current.question,
        reference: current.reference,
        userAnswer: answer,
      })
      const out = await runTask(
        settings,
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        'interview_score',
      )
      const r = extractJson<{ score: number; correct: boolean; feedback: string; weakPoints?: string[] }>(out)
      const round: InterviewRound = {
        question: current.question,
        intent: current.intent,
        userAnswer: answer,
        score: r.score,
        feedback: r.feedback,
        weakPoints: r.weakPoints,
      }
      const nextHistory = [...history, round]
      setHistory(nextHistory)
      const nextIdx = roundIdx + 1
      setRoundIdx(nextIdx)
      if (nextIdx < rounds) {
        askQuestion(nextIdx, kpsRef.current, nextHistory)
      } else {
        finalize(nextHistory)
      }
    } catch (e: any) {
      setStreaming('评分失败：' + e.message)
    } finally {
      setBusy(false)
      setStreaming('')
    }
  }

  const finalize = async (h: InterviewRound[]) => {
    setBusy(true)
    setStreaming('生成整体评估…')
    try {
      const { system, user } = buildInterviewEvalMessages(role, h)
      const out = await runTask(
        settings,
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        'interview_eval',
      )
      const rep = extractJson<InterviewReport>(out)
      setReport(rep)
      addInterviewSession({
        role,
        scopeName: scopeNameRef.current,
        rounds,
        history: h,
        report: rep,
      })
      setPhase('done')
    } catch (e: any) {
      setStreaming('评估失败：' + e.message)
    } finally {
      setBusy(false)
      setStreaming('')
    }
  }

  const exportReport = () => {
    if (!report) return
    const md =
      `# 模拟面试报告 · ${role}\n\n` +
      `范围：${scopeNameRef.current}　轮数：${rounds}\n\n` +
      `## 总评\n\n- 综合得分：**${report.overall}**\n- 评级：${report.level}\n- 建议：${report.recommendation}\n\n` +
      `## 优势\n` +
      report.strengths.map((s) => `- ${s}`).join('\n') +
      `\n\n## 不足\n` +
      report.weaknesses.map((w) => `- ${w}`).join('\n') +
      `\n\n## 逐轮记录\n` +
      history
        .map(
          (h, i) =>
            `### 第${i + 1}题（${h.intent}）得分 ${h.score}\n- 题：${h.question}\n- 作答：${h.userAnswer}\n- 反馈：${h.feedback}`,
        )
        .join('\n\n')
    downloadMarkdown(`面试报告-${role}.md`, md)
  }

  if (phase === 'config') {
    return (
      <div>
        <h2 className="page-title">模拟面试</h2>
        <div className="panel" style={{ maxWidth: 560 }}>
          <div className="muted" style={{ marginBottom: 10 }}>
            基于你的本地知识库，按岗位进行多轮模拟面试：每轮检索相关知识点出题 → 你作答 → 评分反馈 → 末轮整体评估。
          </div>
          <label style={{ display: 'block', marginBottom: 10 }}>
            目标岗位
            <input value={role} onChange={(e) => setRole(e.target.value)} style={{ marginTop: 4 }} />
          </label>
          <label style={{ display: 'block', marginBottom: 10 }}>
            考察范围
            <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ marginTop: 4 }}>
              <option value="all">全部知识库（{allKps.length} 个知识点）</option>
              {flatCourses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'block', marginBottom: 14 }}>
            面试轮数
            <input
              type="number"
              min={1}
              max={20}
              value={rounds}
              onChange={(e) => setRounds(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              style={{ marginTop: 4, width: 120 }}
            />
          </label>
          <button className="primary" onClick={start}>
            开始面试
          </button>
        </div>

        {interviewSessions.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div className="muted">历史面试（{interviewSessions.length}）</div>
            {interviewSessions.slice(0, 8).map((s) => (
              <div key={s.id} className="card" style={{ marginTop: 8 }}>
                <strong>{s.role}</strong> · {s.scopeName} · {s.rounds} 轮 · 综合 {s.report.overall}（{s.report.level}）
                <div className="muted" style={{ fontSize: 12 }}>
                  {new Date(s.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (phase === 'done' && report) {
    return (
      <div>
        <h2 className="page-title">模拟面试 · 评估报告</h2>
        <div className="panel" style={{ maxWidth: 720 }}>
          <div className="row">
            <div>
              <div className="muted">综合得分</div>
              <div style={{ fontSize: 32, fontWeight: 700 }}>{report.overall}</div>
            </div>
            <div className="badge ok" style={{ alignSelf: 'center' }}>
              {report.level}
            </div>
            <div className="spacer" />
            <button onClick={exportReport}>导出报告 (.md)</button>
            <button className="ghost" onClick={() => setPhase('config')}>
              再来一次
            </button>
          </div>
          <div style={{ marginTop: 12 }}>
            <b>提升建议：</b>
            {report.recommendation}
          </div>
          <div style={{ marginTop: 10 }}>
            <b>优势：</b>
            <ul style={{ margin: '4px 0' }}>{report.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
          <div>
            <b>不足：</b>
            <ul style={{ margin: '4px 0' }}>{report.weaknesses.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          {history.map((h, i) => (
            <RoundCard key={i} h={h} index={i} />
          ))}
        </div>
      </div>
    )
  }

  // running
  const avg = history.length ? Math.round(history.reduce((a, h) => a + h.score, 0) / history.length) : 0
  return (
    <div>
      <h2 className="page-title">模拟面试 · 进行中</h2>
      <div className="panel" style={{ maxWidth: 760 }}>
        <div className="row">
          <span className="tag">{role}</span>
          <span className="tag">{scopeNameRef.current}</span>
          <span className="muted">
            第 {Math.min(roundIdx + 1, rounds)} / {rounds} 轮
          </span>
          {history.length > 0 && (
            <span className="muted">已答均分 {avg}</span>
          )}
          <div className="spacer" />
          <span className="muted" style={{ fontSize: 12 }}>进度已自动保存，可随时切换目录</span>
        </div>

        {current && (
          <div style={{ marginTop: 14 }}>
            <span className="tag">{current.intent}</span>
            <div style={{ marginTop: 8, fontSize: 16, whiteSpace: 'pre-wrap' }}>{current.question}</div>
            <textarea
              placeholder="在此作答…"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              style={{ marginTop: 10 }}
            />
            <div className="mic-row" style={{ marginTop: 8 }}>
              <button className={listening ? 'rec on' : 'rec'} onClick={startListen} title="语音作答">
                {listening ? '⏹ 停止' : '🎤 语音作答'}
              </button>
            </div>
            {listening && partial && (
              <div className="streaming" style={{ marginTop: 6 }}>识别中：{partial}</div>
            )}
            <div className="row" style={{ marginTop: 10 }}>
              <button className="primary" onClick={submitAnswer} disabled={!answer.trim() || busy}>
                {busy ? '处理中…' : '提交并评分'}
              </button>
            </div>
          </div>
        )}
        {streaming && <div className="streaming" style={{ marginTop: 10 }}>{streaming}</div>}
      </div>

      <div style={{ marginTop: 14 }}>
        {history.map((h, i) => (
          <RoundCard key={i} h={h} index={i} />
        ))}
      </div>
    </div>
  )
}

/**
 * 单轮问答卡：统一呈现「问 / 答 / 评」三块。
 * 之前「进行中」阶段漏了作答内容，导致答完只能看到题与评语，看不到自己写了什么。
 */
function RoundCard({ h, index }: { h: InterviewRound; index: number }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="card round-card">
      <div className="row">
        <span className="muted" style={{ fontSize: 12 }}>第 {index + 1} 题</span>
        <span className="tag">{h.intent}</span>
        <span className="tag">得分 {h.score}</span>
        <span className={`badge ${h.score >= 60 ? 'ok' : 'bad'}`}>
          {h.score >= 60 ? '达标' : '待加强'}
        </span>
        <div className="spacer" />
        <button className="mini ghost" onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : '展开'}
        </button>
      </div>

      <div className="qa-block">
        <span className="qa-label">问</span>
        <span style={{ whiteSpace: 'pre-wrap' }}>{h.question}</span>
      </div>

      {open && (
        <>
          <div className="qa-block qa-answer">
            <span className="qa-label">答</span>
            {h.userAnswer && h.userAnswer.trim() ? (
              <span style={{ whiteSpace: 'pre-wrap' }}>{h.userAnswer}</span>
            ) : (
              <span className="muted">（未作答）</span>
            )}
          </div>
          <div className="qa-block qa-feedback">
            <span className="qa-label">评</span>
            <span style={{ whiteSpace: 'pre-wrap' }}>{h.feedback}</span>
            {h.weakPoints && h.weakPoints.length > 0 && (
              <div className="muted" style={{ marginTop: 4 }}>
                薄弱点：{h.weakPoints.join('、')}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

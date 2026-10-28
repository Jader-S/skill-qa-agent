import { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore'
import { runTask } from '../../lib/runTask'
import { extractJson } from '../../lib/llm/parse'
import { buildScoreMessages, buildFollowupMessages } from '../../lib/prompts'
import type { AnswerRecord, AttemptAnalysis, KnowledgePoint, LLMConfig, Question } from '../../types'
import { speech } from '../../lib/speech'
import { normalizeAnalysis } from '../../lib/analysis'
import AnalysisView, { authorLabel } from '../shared/AnalysisView'

type ScoreResult = {
  score: number
  correct: boolean
  feedback: string
  weakPoints?: string[]
  analysis?: AttemptAnalysis
}

export default function QuestionCard({
  q,
  kp,
  settings,
}: {
  q: Question
  kp: KnowledgePoint
  settings: LLMConfig
}) {
  const recordAnswer = useStore((s) => s.recordAnswer)
  const answers = useStore((s) => s.answers)
  const optimizeKP = useStore((s) => s.optimizeKP)
  const addCorrection = useStore((s) => s.addCorrection)
  const corrections = useStore((s) => s.corrections)
  const voice = useStore((s) => s.voice)

  const [choice, setChoice] = useState('')
  const [text, setText] = useState('')
  const [result, setResult] = useState<ScoreResult | null>(null)
  const [streaming, setStreaming] = useState('')
  const [followup, setFollowup] = useState('')
  const [fixOpen, setFixOpen] = useState(false)
  const [fixScore, setFixScore] = useState('')
  const [fixFeedback, setFixFeedback] = useState('')
  const [listening, setListening] = useState(false)
  const [partial, setPartial] = useState('')

  const answer = q.type === 'choice' ? choice : text

  useEffect(() => {
    const latest = [...answers].reverse().find((item) => item.questionId === q.id)
    if (!latest) return
    setResult({
      score: latest.score,
      correct: latest.correct,
      feedback: latest.feedback,
      weakPoints: latest.weakPoints,
      analysis: latest.analysis,
    })
    if (q.type === 'choice') setChoice(latest.userAnswer)
    else setText(latest.userAnswer)
    // 只在换题时回放最近一次作答。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.id])

  const submit = async () => {
    if (!answer) return
    const { system, user } = buildScoreMessages(q, kp, answer)
    setStreaming('评分中…')
    setResult(null)
    try {
      const out = await runTask(
        settings,
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        'score',
      )
      const parsed = extractJson<ScoreResult & { lossPoints?: unknown; explanation?: unknown; complexity?: unknown; references?: unknown }>(out)
      const analysis = normalizeAnalysis(parsed, Number(parsed.score))
      const rec: Omit<AnswerRecord, 'id' | 'createdAt'> = {
        questionId: q.id,
        userAnswer: answer,
        score: parsed.score,
        correct: parsed.correct,
        feedback: parsed.feedback,
        weakPoints: parsed.weakPoints,
        analysis,
      }
      recordAnswer(rec)
      setResult({ ...parsed, analysis })
    } catch (e: any) {
      setStreaming('解析失败：' + e.message)
    } finally {
      setStreaming('')
    }
  }

  const askFollowup = async () => {
    const { system, user } = buildFollowupMessages(q, kp, answer, result?.feedback ?? '')
    setStreaming('追问生成中…')
    setFollowup('')
    try {
      await runTask(
        settings,
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        'followup',
        (t) => setFollowup(t),
      )
    } catch (e: any) {
      setFollowup('生成失败：' + e.message)
    } finally {
      setStreaming('')
    }
  }

  // 修正覆盖（按题目 id 关联，本卡片每题一次作答）
  const scoreFix = corrections.find((c) => c.targetId === q.id && c.field === 'score')
  const feedbackFix = corrections.find((c) => c.targetId === q.id && c.field === 'feedback')
  const showScore = scoreFix ? Number(scoreFix.corrected) : result?.score
  const showFeedback = feedbackFix ? feedbackFix.corrected : result?.feedback

  const saveFix = () => {
    if (!result) return
    if (fixScore !== '') {
      addCorrection({
        targetType: 'answer',
        targetId: q.id,
        field: 'score',
        original: String(result.score),
        corrected: fixScore,
      })
    }
    if (fixFeedback.trim()) {
      addCorrection({
        targetType: 'answer',
        targetId: q.id,
        field: 'feedback',
        original: result.feedback,
        corrected: fixFeedback.trim(),
      })
    }
    setFixOpen(false)
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
      if (t) setText((prev) => (prev.trim() ? prev.trimEnd() + '\n' + t : t))
    } catch (e: any) {
      alert(e.message)
    } finally {
      setListening(false)
      setPartial('')
    }
  }

  return (
    <div className="card">
      <div className="row">
        <span className="tag">{q.type === 'choice' ? '选择题' : q.type === 'code' ? '代码题' : '简答'}</span>
        <span className="tag">{q.difficulty}</span>
        <span className="tag">#{kp.title}</span>
        {authorLabel(kp) && <span className="badge fix">{authorLabel(kp)}</span>}
      </div>
      <div style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{q.stem}</div>

      {q.type === 'choice' && q.options && (
        <div style={{ marginTop: 8 }}>
          {q.options.map((o) => (
            <label key={o} style={{ display: 'block', cursor: 'pointer', marginTop: 4 }}>
              <input
                type="radio"
                name={q.id}
                checked={choice === o}
                onChange={() => setChoice(o)}
                style={{ width: 'auto', marginRight: 6 }}
              />
              {o}
            </label>
          ))}
        </div>
      )}

      {q.type !== 'choice' && (
        <textarea
          placeholder="在此作答…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ marginTop: 8 }}
        />
      )}

      {q.type !== 'choice' && (
        <div className="mic-row">
          <button className={listening ? 'rec on' : 'rec'} onClick={startListen} title="语音作答">
            {listening ? '⏹ 停止' : '🎤 语音作答'}
          </button>
        </div>
      )}
      {listening && partial && (
        <div className="streaming" style={{ marginTop: 6 }}>识别中：{partial}</div>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        <button className="primary" onClick={submit} disabled={!answer || !!streaming}>
          {streaming || '提交并评分'}
        </button>
        <button onClick={askFollowup} disabled={!result || !!streaming}>
          深入追问
        </button>
        {result && (
          <button className="ghost" onClick={() => setFixOpen((v) => !v)}>
            修正答案
          </button>
        )}
      </div>

      {streaming && <div className="streaming" style={{ marginTop: 8 }}>{streaming}</div>}

      {result && (
        <div className="feedback">
          <div className="row">
            <strong>得分 {showScore}</strong>
            <span className={`badge ${result.correct ? 'ok' : 'bad'}`}>
              {result.correct ? '正确' : '待加强'}
            </span>
            {(scoreFix || feedbackFix) && <span className="badge fix">已修正</span>}
          </div>
          <div className="score-bar">
            <div className="score-fill" style={{ width: `${Math.max(0, Math.min(100, Number(showScore) || 0))}%` }} />
          </div>
          <div style={{ marginTop: 8 }}>{showFeedback}</div>
          {Number(showScore) < 60 && (
            <AnalysisView
              analysis={result.analysis}
              kp={kp}
              onSaveExplanation={
                result.analysis?.explanation
                  ? () => {
                      if (kp.aiContent && !confirm('这个知识点已有补充，要覆盖吗？')) return
                      optimizeKP(kp.id, result.analysis!.explanation)
                    }
                  : undefined
              }
            />
          )}
          {result.weakPoints && result.weakPoints.length > 0 && (
            <div className="muted" style={{ marginTop: 6 }}>
              薄弱点：{result.weakPoints.join('、')}
            </div>
          )}
        </div>
      )}

      {followup && (
        <div className="feedback" style={{ borderColor: 'var(--accent)' }}>
          <div className="muted" style={{ marginBottom: 4 }}>导师追问：</div>
          {followup}
        </div>
      )}

      {fixOpen && result && (
        <div className="panel" style={{ marginTop: 10 }}>
          <div className="muted" style={{ marginBottom: 6 }}>修正评分与评语（将沉淀为权威覆盖）</div>
          <input
            placeholder={`原得分 ${result.score}，输入修正分`}
            value={fixScore}
            onChange={(e) => setFixScore(e.target.value)}
            style={{ marginBottom: 6 }}
          />
          <textarea
            placeholder="输入修正后的评语"
            value={fixFeedback}
            onChange={(e) => setFixFeedback(e.target.value)}
            style={{ marginBottom: 6 }}
          />
          <div className="row">
            <button className="primary" onClick={saveFix}>
              保存修正
            </button>
            <button className="ghost" onClick={() => setFixOpen(false)}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

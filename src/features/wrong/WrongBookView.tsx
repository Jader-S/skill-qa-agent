import { useMemo, useState } from 'react'
import { useStore } from '../../store/useStore'
import { subtreeIds } from '../../lib/courseTree'
import { buildWrongItems, type WrongItem } from '../../lib/wrongBook'
import { startDrill } from '../../lib/drill'
import AnalysisView from '../shared/AnalysisView'
import MarkdownView from '../knowledge/MarkdownView'

export default function WrongBookView({
  courseId,
  onPractice,
}: {
  courseId: string | null
  onPractice: (kind: 'quiz' | 'interview') => void
}) {
  const courses = useStore((s) => s.courses)
  const knowledgePoints = useStore((s) => s.knowledgePoints)
  const questions = useStore((s) => s.questions)
  const answers = useStore((s) => s.answers)
  const corrections = useStore((s) => s.corrections)
  const interviewSessions = useStore((s) => s.interviewSessions)
  const masteredWrongIds = useStore((s) => s.masteredWrongIds)
  const markMastered = useStore((s) => s.markMastered)
  const optimizeKP = useStore((s) => s.optimizeKP)

  const [scope, setScope] = useState<'all' | 'course'>(courseId ? 'course' : 'all')
  const [filter, setFilter] = useState<'open' | 'mastered'>('open')
  const [openKey, setOpenKey] = useState<string | null>(null)

  const items = useMemo(
    () =>
      buildWrongItems({
        answers,
        questions,
        knowledgePoints,
        corrections,
        interviewSessions,
        masteredWrongIds,
      }),
    [answers, questions, knowledgePoints, corrections, interviewSessions, masteredWrongIds],
  )

  const scoped = items.filter((item) => {
    if (scope === 'all' || !courseId) return true
    const ids = new Set(subtreeIds(courses, courseId))
    return item.courseIds.some((id) => ids.has(id))
  })
  const visible = scoped.filter((item) => (filter === 'open' ? !item.mastered : item.mastered))
  const open = visible.find((item) => item.key === openKey) ?? null
  const kp = open ? knowledgePoints.find((k) => k.id === open.kpIds[0]) : undefined

  const practice = (kind: 'quiz' | 'interview', list: WrongItem[]) => {
    const kpIds = [...new Set(list.flatMap((item) => item.kpIds))]
    if (kpIds.length === 0) {
      alert('这些错题没有对应的知识点，没法按它们再练。')
      return
    }
    startDrill({ kind, kpIds })
    onPractice(kind)
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <h2 className="page-title" style={{ margin: 0 }}>错题本</h2>
        <div className="spacer" />
        <button className={scope === 'all' ? 'primary mini' : 'mini'} onClick={() => setScope('all')}>
          全部
        </button>
        <button
          className={scope === 'course' ? 'primary mini' : 'mini'}
          disabled={!courseId}
          onClick={() => setScope('course')}
        >
          当前课程
        </button>
        <button className={filter === 'open' ? 'primary mini' : 'mini'} onClick={() => setFilter('open')}>
          在册 {scoped.filter((item) => !item.mastered).length}
        </button>
        <button className={filter === 'mastered' ? 'primary mini' : 'mini'} onClick={() => setFilter('mastered')}>
          已掌握 {scoped.filter((item) => item.mastered).length}
        </button>
      </div>
      {filter === 'open' && visible.length > 0 && (
        <div className="row" style={{ marginBottom: 10 }}>
          <button onClick={() => practice('quiz', visible)}>按这些知识点再自测</button>
          <button onClick={() => practice('interview', visible)}>按这些知识点再面试</button>
        </div>
      )}
      {visible.length === 0 ? (
        <div className="empty">{filter === 'open' ? '这个范围里没有未掌握的错题。' : '还没有已掌握的记录。'}</div>
      ) : (
        visible.map((item) => (
          <div key={item.key} className="card" style={{ marginBottom: 8 }}>
            <div className="row">
              <span className="tag">{item.kind === 'quiz' ? '自测' : '面试'}</span>
              <strong style={{ flex: 1 }}>{item.question}</strong>
              <span className="badge bad">{item.score} 分</span>
              <button className="mini" onClick={() => setOpenKey(openKey === item.key ? null : item.key)}>
                {openKey === item.key ? '收起' : '自查'}
              </button>
              {!item.mastered && (
                <button className="mini" onClick={() => markMastered([item.key])}>
                  已掌握
                </button>
              )}
            </div>
            {openKey === item.key && open?.key === item.key && (
              <div style={{ marginTop: 8 }}>
                <div className="muted">作答</div>
                <div style={{ whiteSpace: 'pre-wrap', marginBottom: 6 }}>{item.userAnswer || '（未作答）'}</div>
                <div style={{ marginBottom: 6 }}>{item.feedback}</div>
                <AnalysisView
                  analysis={item.analysis}
                  kp={kp}
                  onSaveExplanation={
                    kp && item.analysis?.explanation
                      ? () => {
                          if (kp.aiContent && !confirm('这个知识点已有补充，要覆盖吗？')) return
                          optimizeKP(kp.id, item.analysis!.explanation)
                        }
                      : undefined
                  }
                />
                {kp && (
                  <div style={{ marginTop: 8 }}>
                    <div className="muted">知识点原文</div>
                    <MarkdownView text={kp.content} />
                    {kp.aiContent && (
                      <>
                        <div className="muted" style={{ marginTop: 6 }}>已有补充</div>
                        <MarkdownView text={kp.aiContent} />
                      </>
                    )}
                  </div>
                )}
                {item.earlier.length > 0 && (
                  <div className="muted" style={{ marginTop: 8 }}>
                    更早的作答：{item.earlier.map((row) => `${row.score} 分`).join('、')}
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}

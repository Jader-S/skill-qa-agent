import type { AttemptAnalysis, KnowledgePoint } from '../../types'

export function authorLabel(kp: { sourceType: string; sourceName?: string }): string | null {
  if (kp.sourceType !== 'ai') return null
  return kp.sourceName?.includes('已编辑') ? '已对照并编辑' : 'AI 编写，尚未对照笔记'
}

export default function AnalysisView({
  analysis,
  kp,
  onSaveExplanation,
}: {
  analysis?: AttemptAnalysis
  kp?: KnowledgePoint
  onSaveExplanation?: () => void
}) {
  if (!analysis) return null
  return (
    <div style={{ marginTop: 8 }}>
      {analysis.lossPoints.length > 0 && (
        <div>
          <div className="muted" style={{ marginBottom: 4 }}>丢分点</div>
          {analysis.lossPoints.map((item, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              <b>{item.point}</b>
              {item.why && <span className="muted"> · {item.why}</span>}
            </div>
          ))}
        </div>
      )}
      {analysis.explanation && (
        <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{analysis.explanation}</div>
      )}
      {analysis.references.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {analysis.references.map((ref) => (
            <div key={ref.url}>
              <a href={ref.url} target="_blank" rel="noreferrer">
                {ref.title}
              </a>
              <span className="muted"> · 未经核实</span>
            </div>
          ))}
        </div>
      )}
      {kp && onSaveExplanation && analysis.explanation && (
        <button className="mini" style={{ marginTop: 8 }} onClick={onSaveExplanation}>
          把讲解写入这个知识点的补充
        </button>
      )}
    </div>
  )
}

import type { AttemptAnalysis } from '../types'

const PASS = 60

export function normalizeAnalysis(raw: unknown, score: number): AttemptAnalysis | undefined {
  if (score >= PASS) return undefined
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const lossPoints = Array.isArray(obj.lossPoints)
    ? obj.lossPoints
        .map((item) => {
          const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
          return { point: String(row.point ?? '').trim(), why: String(row.why ?? '').trim() }
        })
        .filter((item) => item.point || item.why)
        .slice(0, 8)
    : []
  const explanation = String(obj.explanation ?? '').trim()
  const complexity = obj.complexity === 'complex' ? 'complex' : 'simple'
  const references =
    complexity === 'complex' && Array.isArray(obj.references)
      ? obj.references
          .map((item) => {
            const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
            return { title: String(row.title ?? '').trim(), url: String(row.url ?? '').trim() }
          })
          .filter((item) => item.title && item.url.startsWith('https://'))
          .slice(0, 3)
      : []
  if (lossPoints.length === 0 && !explanation) return undefined
  return { lossPoints, explanation, complexity, references }
}

export const SCORE_JSON =
  '输出 JSON：{"score":0-100,"correct":true|false,"feedback":"简短评语","weakPoints":["薄弱点"],"lossPoints":[{"point":"丢分点","why":"原因"}],"explanation":"对着知识点的讲解","complexity":"simple|complex","references":[{"title":"文档名","url":"https://..."}]}。得分达到 60 时 lossPoints、explanation、references 必须留空。低于 60 时写清丢分点和讲解；内容简单则 complexity 为 simple 且 references 为空，内容复杂则 complexity 为 complex，并给 1 到 3 个 https 链接。只输出 JSON。'

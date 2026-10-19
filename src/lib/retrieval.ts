import type { KnowledgePoint } from '../types'

/** 一个被索引/检索到的知识点片段。 */
export type RetrievedChunk = {
  kpId: string
  title: string
  content: string
  score: number
}

/**
 * 检索器接口。当前提供 LexicalRetriever（词法）；后续可加 VectorRetriever
 * （transformers.js 本地嵌入），只需实现同一接口，主流程无需改动。
 */
export interface Retriever {
  retrieve(query: string, kps: KnowledgePoint[], topK?: number): RetrievedChunk[]
}

/** 中文 aware 分词：CJK 取 uni+bigram，拉丁/数字按词切分。 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const terms: string[] = []
  // 拉丁词 / 数字
  for (const m of lower.match(/[a-z0-9]+/g) ?? []) terms.push(m)
  // 连续 CJK 字符块 → uni + bigram
  for (const seg of lower.match(/[一-鿿]+/g) ?? []) {
    for (let i = 0; i < seg.length; i++) {
      terms.push(seg[i])
      if (i + 1 < seg.length) terms.push(seg.slice(i, i + 2))
    }
  }
  return terms.filter((t) => t.length > 0)
}

function tfMap(terms: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of terms) m.set(t, (m.get(t) ?? 0) + 1)
  return m
}

/** 词法检索器：TF-IDF 点积打分，零依赖、可离线、即时可用。 */
export class LexicalRetriever implements Retriever {
  private docs: { kp: KnowledgePoint; tf: Map<string, number> }[] = []
  private idf = new Map<string, number>()
  private built = false

  /** 用知识库构建索引（可重复调用以重建）。 */
  buildIndex(kps: KnowledgePoint[]): void {
    const docs = kps.map((kp) => ({
      kp,
      tf: tfMap(tokenize(`${kp.title}\n${kp.content}`)),
    }))
    const df = new Map<string, number>()
    for (const d of docs) {
      for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
    }
    const N = docs.length || 1
    const idf = new Map<string, number>()
    for (const [t, n] of df) idf.set(t, Math.log((N + 1) / (n + 1)) + 1)
    this.docs = docs
    this.idf = idf
    this.built = true
  }

  retrieve(query: string, kps: KnowledgePoint[], topK = 5): RetrievedChunk[] {
    if (!this.built || this.docs.length !== kps.length) this.buildIndex(kps)
    const qtf = tfMap(tokenize(query))
    if (qtf.size === 0) return []
    const results: RetrievedChunk[] = []
    for (const d of this.docs) {
      let score = 0
      for (const [t, qf] of qtf) {
        const dfreq = d.tf.get(t)
        if (!dfreq) continue
        const idf = this.idf.get(t) ?? 1
        score += (1 + Math.log(dfreq)) * idf * (1 + Math.log(qf))
      }
      if (score > 0) {
        results.push({ kpId: d.kp.id, title: d.kp.title, content: d.kp.content, score })
      }
    }
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }
}

/** 把检索结果拼成给 LLM 的 grounding 上下文文本。 */
export function chunksToContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return '（知识库中未检索到相关内容）'
  return chunks
    .map((c, i) => `【知识点 ${i + 1}：${c.title}】\n${c.content}`)
    .join('\n\n')
}

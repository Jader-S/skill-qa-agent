export type ParsedKP = { title: string; content: string; tags: string[] }

type Frontmatter = { title?: string; tags: string[] }

/** 解析 Obsidian 风格 frontmatter（文件顶部 --- 包裹的简单 key: value）。 */
function parseFrontmatter(text: string): { data: Frontmatter; body: string } {
  const m = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/)
  if (!m) return { data: { tags: [] }, body: text }

  const data: Frontmatter = { tags: [] }
  for (const raw of m[1].split(/\r?\n/)) {
    const idx = raw.indexOf(':')
    if (idx === -1) continue
    const key = raw.slice(0, idx).trim().toLowerCase()
    let val = raw.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    if (key === 'title') data.title = val
    else if (key === 'tags') {
      if (val.startsWith('[')) {
        data.tags = val
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
      } else {
        data.tags = val.split(/[,，\s]+/).filter(Boolean)
      }
    }
  }
  return { data, body: text.slice(m[0].length) }
}

/** 单个知识点内容超过此长度时，按段落再切分为多个子知识点，保证 RAG grounding 粒度。 */
const MAX_KP_LEN = 2000

/**
 * 把一段正文按指定标题层级切成多个知识点；若内容超长，进一步按空行分段。
 * 第一个分片保留原标题，后续分片追加「 · 节n」后缀。
 */
function chunkContent(title: string, content: string, tags: string[], maxLen: number): ParsedKP[] {
  if (content.length <= maxLen) return [{ title, content, tags }]
  const paras = content.split(/\n\s*\n/)
  const out: ParsedKP[] = []
  let buf = ''
  let idx = 0
  const flush = () => {
    if (!buf.trim()) return
    out.push({ title: idx === 0 ? title : `${title} · 节${idx + 1}`, content: buf.trim(), tags })
    buf = ''
    idx++
  }
  for (const p of paras) {
    if (buf && buf.length + p.length + 2 > maxLen) flush()
    buf = buf ? buf + '\n\n' + p : p
  }
  flush()
  return out.length ? out : [{ title, content, tags }]
}

/** 行 + 是否处于代码围栏内（``` 或 ~~~）。围栏内的 # 行是代码注释，不是 Markdown 标题。 */
type Line = { text: string; inCode: boolean }

function tagCodeFences(body: string): Line[] {
  const lines = body.split(/\r?\n/)
  let inCode = false
  let marker = ''
  return lines.map((line) => {
    const m = line.trim().match(/^(`{3,}|~{3,})/)
    if (m) {
      if (!inCode) {
        inCode = true
        marker = m[1][0]
      } else if (m[1][0] === marker) {
        inCode = false
        marker = ''
      }
      return { text: line, inCode: true }
    }
    return { text: line, inCode }
  })
}

/**
 * 将 Markdown 解析为知识点数组：
 * - 代码围栏（``` / ~~~）内的 # 行视为代码注释，绝不作为标题拆分。
 * - 拆分轴取「标题数量 ≥ 2 的最浅层级」：单 H1 文件（课件常见：H1=文件名）自动落到 H2，
 *   保证按章节成体系拆分；若无任何层级 ≥ 2，回退到最浅存在层级（整篇一条）。
 * - 标题拼接父级路径（如「变量 · 命名规范」）；标题数 = 1 的祖先视为文档题名，不进路径。
 * - 选中层级之前的导语（无标题内容）拼到第一个知识点前面。
 * - 任一知识点内容超过 MAX_KP_LEN 时按段落再切，避免巨型知识点。
 * - frontmatter 的 tags 应用到所有知识点。
 */
export function parseMarkdownToKPs(text: string, fallbackTitle: string): ParsedKP[] {
  const { data, body } = parseFrontmatter(text)
  const lines = tagCodeFences(body)

  // 统计围栏外各层级的标题数量
  const headingTest = (lv: number) => new RegExp(`^#{${lv}}\\s+`)
  const headingCap = (lv: number) => new RegExp(`^#{${lv}}\\s+(.+?)\\s*$`)
  const countAt = (lv: number) =>
    lines.filter((l) => !l.inCode && headingTest(lv).test(l.text)).length

  // 选定拆分层级：首个标题数 ≥ 2 的最浅层级；否则最浅存在层级
  let level = 0
  for (let lv = 1; lv <= 6; lv++) {
    if (countAt(lv) >= 2) {
      level = lv
      break
    }
  }
  if (!level) {
    for (let lv = 1; lv <= 6; lv++) {
      if (countAt(lv) >= 1) {
        level = lv
        break
      }
    }
  }
  if (!level) {
    return [{ title: data.title || fallbackTitle, content: body.trim(), tags: data.tags }]
  }

  const re = headingCap(level)
  // 祖先是否进标题路径：该祖先层级的标题数 > 1（=1 的是文档题名）
  const ancestorKept = (lv: number) => countAt(lv) > 1

  const sections: { title: string; content: string[] }[] = []
  const preamble: string[] = []
  // 各层级最近一次出现的标题文本，用于拼父级路径
  const ancestors: Record<number, string> = {}
  let cur: { title: string; content: string[] } | null = null
  for (const { text: line, inCode } of lines) {
    if (!inCode) {
      const h = line.match(re)
      if (h) {
        if (cur) sections.push({ title: cur.title, content: cur.content })
        const path: string[] = []
        for (let lv = 1; lv < level; lv++) {
          if (ancestorKept(lv) && ancestors[lv]) path.push(ancestors[lv])
        }
        path.push(h[1].trim())
        cur = { title: path.join(' · '), content: [] }
        ancestors[level] = h[1].trim()
        // 更浅层级的祖先已过期，清掉避免污染后续路径
        for (let lv = level + 1; lv <= 6; lv++) delete ancestors[lv]
        continue
      }
      // 记录更浅层级的祖先标题
      for (let lv = 1; lv < level; lv++) {
        const m = line.match(headingCap(lv))
        if (m) ancestors[lv] = m[1].trim()
      }
    }
    if (cur) cur.content.push(line)
    else preamble.push(line)
  }
  if (cur) sections.push({ title: cur.title, content: cur.content })

  if (sections.length === 0) {
    return [{ title: data.title || fallbackTitle, content: body.trim(), tags: data.tags }]
  }

  const pre = preamble.join('\n').trim()
  if (pre && sections.length) {
    sections[0] = {
      title: sections[0].title,
      content: [pre, ...sections[0].content],
    }
  }

  const out: ParsedKP[] = []
  for (const s of sections) {
    const content = s.content.join('\n').trim()
    if (!content) continue
    out.push(...chunkContent(s.title, content, data.tags, MAX_KP_LEN))
  }
  return out
}

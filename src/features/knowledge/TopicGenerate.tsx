import { useRef, useState } from 'react'
import { useStore } from '../../store/useStore'
import { runTask } from '../../lib/runTask'
import { extractJson } from '../../lib/llm/parse'
import { buildChapterKpMessages, buildInterestMessages, buildOutlineMessages } from '../../lib/prompts'
import { uid } from '../../lib/id'
import type { Course, KnowledgePoint } from '../../types'

type EditNode = { id: string; parentId: string | null; title: string; blurb: string }
type Point = { title: string; content: string; checked: boolean }
type InterestPreview = { action: 'points' | 'chapter'; chapterTitle: string; points: Point[] }

function depthOf(nodes: EditNode[], id: string | null): number {
  let depth = 0
  let cur = id
  while (cur) {
    depth++
    const node = nodes.find((item) => item.id === cur)
    cur = node?.parentId ?? null
  }
  return depth
}

function flattenOutline(raw: unknown): EditNode[] {
  const root = raw && typeof raw === 'object' ? (raw as { chapters?: unknown }).chapters : []
  const out: EditNode[] = []
  const walk = (nodes: unknown, parentId: string | null, depth: number) => {
    if (!Array.isArray(nodes) || depth > 3) return
    nodes.forEach((item) => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
      const title = String(row.title ?? '').trim()
      if (!title) return
      const id = uid()
      out.push({ id, parentId, title, blurb: String(row.blurb ?? '').trim() })
      walk(row.children, id, depth + 1)
    })
  }
  walk(root, null, 1)
  return out
}

export default function TopicGenerate({ parentId }: { parentId: string | null }) {
  const settings = useStore((s) => s.settings)
  const courses = useStore((s) => s.courses)
  const importFolder = useStore((s) => s.importFolder)
  const addKP = useStore((s) => s.addKP)

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [depth, setDepth] = useState<'入门' | '进阶'>('入门')
  const [interests, setInterests] = useState('')
  const [nodes, setNodes] = useState<EditNode[] | null>(null)
  const [rootCourseId, setRootCourseId] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [interest, setInterest] = useState('')
  const [preview, setPreview] = useState<InterestPreview | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const reset = () => {
    abortRef.current?.abort()
    setNodes(null)
    setRootCourseId(null)
    setPreview(null)
    setBusy('')
  }

  const makeOutline = async () => {
    if (!name.trim()) return
    setBusy('正在生成目录…')
    try {
      const { system, user } = buildOutlineMessages({
        name: name.trim(),
        goal: goal.trim(),
        depth,
        interests: interests.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean),
      })
      const text = await runTask(settings, [{ role: 'system', content: system }, { role: 'user', content: user }], 'outline')
      const next = flattenOutline(extractJson(text))
      if (next.length === 0) throw new Error('目录是空的')
      setNodes(next)
    } catch (error: any) {
      alert('生成目录失败：' + error.message)
    } finally {
      setBusy('')
    }
  }

  const confirmOutline = async () => {
    if (!nodes || nodes.length === 0) return
    const now = Date.now()
    const rootId = uid()
    const made: Course[] = [
      { id: rootId, name: name.trim(), parentId, sort: now, createdAt: now },
    ]
    const idOf = new Map<string, string>()
    nodes.forEach((node, index) => {
      const id = uid()
      idOf.set(node.id, id)
      made.push({
        id,
        name: node.title,
        parentId: node.parentId ? idOf.get(node.parentId) ?? rootId : rootId,
        sort: index,
        createdAt: now,
      })
    })
    importFolder(made, [])
    setRootCourseId(rootId)
    const leaves = nodes.filter((node) => !nodes.some((item) => item.parentId === node.id))
    const ac = new AbortController()
    abortRef.current = ac
    let failed = 0
    for (let i = 0; i < leaves.length; i++) {
      if (ac.signal.aborted) break
      const leaf = leaves[i]
      setBusy(`正在写知识点 ${i + 1}/${leaves.length}：${leaf.title}`)
      try {
        const { system, user } = buildChapterKpMessages(leaf.title, leaf.blurb, name.trim())
        const text = await runTask(
          settings,
          [{ role: 'system', content: system }, { role: 'user', content: user }],
          'chapter_kps',
          undefined,
          ac.signal,
        )
        const parsed = extractJson<{ points?: { title?: string; content?: string }[] }>(text)
        const courseId = idOf.get(leaf.id)
        if (!courseId) continue
        for (const point of parsed.points ?? []) {
          const title = String(point.title ?? '').trim()
          const content = String(point.content ?? '').trim()
          if (!title || !content) continue
          addKP({
            courseId,
            title,
            content,
            tags: [],
            sourceType: 'ai',
            sourceName: name.trim(),
          })
        }
      } catch (error: any) {
        if (ac.signal.aborted) break
        failed++
      }
    }
    setBusy('')
    if (failed > 0) alert(`${failed} 个章节没有生成成功，其余已经写入。`)
  }

  const askInterest = async () => {
    if (!interest.trim() || !rootCourseId) return
    setBusy('正在拟定补充…')
    try {
      const names = courses.filter((c) => c.parentId === rootCourseId).map((c) => c.name)
      const { system, user } = buildInterestMessages({
        course: name.trim(),
        chapters: names,
        interest: interest.trim(),
      })
      const text = await runTask(settings, [{ role: 'system', content: system }, { role: 'user', content: user }], 'interest')
      const parsed = extractJson<{ action?: string; chapterTitle?: string; points?: { title?: string; content?: string }[] }>(text)
      const points = (parsed.points ?? [])
        .map((point) => ({
          title: String(point.title ?? '').trim(),
          content: String(point.content ?? '').trim(),
          checked: true,
        }))
        .filter((point) => point.title && point.content)
      if (points.length === 0) throw new Error('没有可写入的知识点')
      setPreview({
        action: parsed.action === 'chapter' ? 'chapter' : 'points',
        chapterTitle: String(parsed.chapterTitle ?? '').trim(),
        points,
      })
    } catch (error: any) {
      alert('补充失败：' + error.message)
    } finally {
      setBusy('')
    }
  }

  const commitInterest = () => {
    if (!preview || !rootCourseId) return
    const picked = preview.points.filter((point) => point.checked)
    if (picked.length === 0) return
    let courseId = rootCourseId
    if (preview.action === 'chapter' && preview.chapterTitle) {
      const id = uid()
      const now = Date.now()
      importFolder([{ id, name: preview.chapterTitle, parentId: rootCourseId, sort: now, createdAt: now }], [])
      courseId = id
    } else {
      const leaf = courses.find((c) => c.parentId === rootCourseId)
      if (leaf) courseId = leaf.id
    }
    const kps: KnowledgePoint[] = picked.map((point) => ({
      id: uid(),
      courseId,
      title: point.title,
      content: point.content,
      tags: [],
      sourceType: 'ai',
      sourceName: `${name.trim()} · ${interest.trim()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }))
    importFolder([], kps)
    setPreview(null)
    setInterest('')
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}>
        {parentId ? '按主题生成子目录' : '按主题生成课程'}
      </button>
    )
  }

  return (
    <div className="panel">
      <div className="row" style={{ marginBottom: 8 }}>
        <strong>{parentId ? '往下生成子目录' : '按主题生成课程'}</strong>
        <div className="spacer" />
        <button className="mini ghost" onClick={() => { reset(); setOpen(false) }}>关闭</button>
      </div>
      {!rootCourseId && (
        <>
          <input placeholder="课程名" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 8 }} />
          <input placeholder="一句话目标，可选" value={goal} onChange={(e) => setGoal(e.target.value)} style={{ marginBottom: 8 }} />
          <div className="row" style={{ marginBottom: 8 }}>
            <button className={depth === '入门' ? 'primary mini' : 'mini'} onClick={() => setDepth('入门')}>入门</button>
            <button className={depth === '进阶' ? 'primary mini' : 'mini'} onClick={() => setDepth('进阶')}>进阶</button>
          </div>
          <textarea placeholder="感兴趣的点，逗号或换行分隔，可选" value={interests} onChange={(e) => setInterests(e.target.value)} style={{ marginBottom: 8 }} />
          {!nodes ? (
            <button className="primary" disabled={!name.trim() || !!busy} onClick={makeOutline}>{busy || '生成目录'}</button>
          ) : (
            <>
              {nodes.map((node) => (
                <div key={node.id} className="row" style={{ marginBottom: 6, paddingLeft: depthOf(nodes, node.parentId) * 16 }}>
                  <input value={node.title} onChange={(e) => setNodes(nodes.map((item) => item.id === node.id ? { ...item, title: e.target.value } : item))} />
                  <button className="mini danger" onClick={() => {
                    const drop = new Set<string>()
                    const collect = (id: string) => { drop.add(id); nodes.filter((item) => item.parentId === id).forEach((item) => collect(item.id)) }
                    collect(node.id)
                    setNodes(nodes.filter((item) => !drop.has(item.id)))
                  }}>删除</button>
                </div>
              ))}
              <div className="row">
                <button className="primary" disabled={!!busy || nodes.length === 0} onClick={confirmOutline}>{busy || '确认目录并生成知识点'}</button>
                {busy && <button className="danger" onClick={() => abortRef.current?.abort()}>停止</button>}
              </div>
            </>
          )}
        </>
      )}
      {rootCourseId && (
        <>
          <div className="muted" style={{ marginBottom: 8 }}>目录和知识点已写入。可以再按感兴趣的点补充。</div>
          <div className="row" style={{ marginBottom: 8 }}>
            <input placeholder="感兴趣的点" value={interest} onChange={(e) => setInterest(e.target.value)} />
            <button disabled={!interest.trim() || !!busy} onClick={askInterest}>{busy || '预览补充'}</button>
          </div>
          {preview && (
            <div>
              {preview.action === 'chapter' && preview.chapterTitle && (
                <div className="muted" style={{ marginBottom: 6 }}>将新增章节「{preview.chapterTitle}」</div>
              )}
              {preview.points.map((point, index) => (
                <label key={index} className="row" style={{ marginBottom: 4 }}>
                  <input type="checkbox" checked={point.checked} onChange={(e) => {
                    const points = preview.points.map((item, i) => i === index ? { ...item, checked: e.target.checked } : item)
                    setPreview({ ...preview, points })
                  }} />
                  {point.title}
                </label>
              ))}
              <button className="primary" onClick={commitInterest}>写入勾选的知识点</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

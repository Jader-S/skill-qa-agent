import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { subtreeIds, coursePath } from '../../lib/courseTree'
import { courseToMarkdown, downloadMarkdown } from '../../lib/exportObsidian'
import { parseDocToKPs, detectFormat } from '../../lib/parseDoc'
import { buildFolderImport, type FolderImportPlan } from '../../lib/importFolder'
import { optimizeOne } from '../../lib/batchOptimize'
import KnowledgePointDetail from './KnowledgePointDetail'
import ChapterOptimize from './ChapterOptimize'
import type { KnowledgePoint } from '../../types'

export default function KnowledgeView({
  courseId,
  onNavigateCourse,
}: {
  courseId: string | null
  onNavigateCourse: (id: string | null) => void
}) {
  const courses = useStore((s) => s.courses)
  const allKps = useStore((s) => s.knowledgePoints)
  const addKP = useStore((s) => s.addKP)
  const deleteKP = useStore((s) => s.deleteKP)
  const importFolder = useStore((s) => s.importFolder)

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState('')
  const [plan, setPlan] = useState<FolderImportPlan | null>(null)
  const [mountUnder, setMountUnder] = useState(true)
  const [busy, setBusy] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [includeSub, setIncludeSub] = useState(false)

  if (!courseId) {
    return (
      <div>
        <h2 className="page-title">知识点</h2>
        <div className="empty">请在左侧课程目录中选择一门课程，进入后即可查看 / 录入 / 导入其下的知识点。</div>
      </div>
    )
  }

  const course = courses.find((c) => c.id === courseId)
  const path = coursePath(courses, courseId)
  const subCourses = courses.filter((c) => c.parentId === courseId)
  // 仅展示「直接」属于本课程的知识点（不摊平整棵子树），关系更清晰。
  const directKps = allKps.filter((k) => k.courseId === courseId)
  const detailKp = allKps.find((k) => k.id === detailId) ?? null
  // 一键 AI 整理的作用域：默认仅本章直接知识点，可选含子课程（整棵子树）。
  const subtreeIdSet = new Set(subtreeIds(courses, courseId))
  const scopeKps = includeSub ? allKps.filter((k) => subtreeIdSet.has(k.courseId)) : directKps

  const resetForm = () => {
    setTitle('')
    setContent('')
    setTags('')
  }

  const submitAdd = () => {
    if (!title.trim() || !content.trim()) return
    addKP({
      courseId,
      title: title.trim(),
      content: content.trim(),
      tags: tags.split(/[,，\s]+/).filter(Boolean),
      sourceType: 'manual',
    })
    resetForm()
  }

  const onFiles = async (files: FileList | null) => {
    if (!files) return
    let created = 0
    for (const f of Array.from(files)) {
      const fallbackTitle = f.name.replace(/\.\w+$/, '')
      try {
        const parsed = await parseDocToKPs(f, fallbackTitle)
        const fmt = detectFormat(f.name)
        parsed.forEach((k) =>
          addKP({
            courseId,
            title: k.title,
            content: k.content,
            tags: k.tags,
            sourceType: fmt,
            sourceName: f.name,
          }),
        )
        created += parsed.length
      } catch (e: any) {
        alert('解析失败：' + f.name + ' — ' + e.message)
      }
    }
    if (created > 0) alert(`已导入 ${created} 个知识点（来自 ${files.length} 个文件）`)
  }

  const onFolder = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    try {
      const p = await buildFolderImport(Array.from(files))
      setPlan(p)
      setMountUnder(true)
    } finally {
      setBusy(false)
    }
  }

  const confirmImport = () => {
    if (!plan) return
    const mapped = plan.courses.map((c) =>
      mountUnder && c.id === plan.rootCourseId ? { ...c, parentId: courseId } : c,
    )
    importFolder(mapped, plan.kps)
    const where = mountUnder ? `（挂载到「${course?.name}」下）` : '（作为顶级课程）'
    alert(
      `已导入 ${plan.stats.kpCount} 个知识点，创建 ${plan.stats.courseCount} 门课程${where}` +
        (plan.stats.skipped > 0 ? `；跳过 ${plan.stats.skipped} 个不支持/忽略的文件` : ''),
    )
    setPlan(null)
  }

  const doExport = () => {
    if (!course) return
    const ids = new Set(subtreeIds(courses, courseId))
    const kps = allKps.filter((k) => ids.has(k.courseId))
    const md = courseToMarkdown(course, kps)
    downloadMarkdown(`${course.name}.md`, md)
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <h2 className="page-title" style={{ margin: 0 }}>知识点</h2>
        {subCourses.length > 0 && (
          <label
            className="muted"
            style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
            title="勾选后作用域扩展到所有子课程"
          >
            <input
              type="checkbox"
              checked={includeSub}
              onChange={(e) => setIncludeSub(e.target.checked)}
              style={{ width: 'auto' }}
            />
            含子课程
          </label>
        )}
        <div className="spacer" />
        <button onClick={doExport} disabled={directKps.length === 0 && subCourses.length === 0}>
          导出 Obsidian (.md)
        </button>
      </div>

      {/* 章节级一键 AI 整理补充：把「藏在详情里」的优化提上来 */}
      <div className="panel chapter-optimize-panel">
        <ChapterOptimize kps={scopeKps} scopeLabel={includeSub ? '含子课程' : '本章'} />
      </div>

      {/* 面包屑：目录层级与知识点关系一目了然 */}
      <div className="breadcrumb">
        {path.map((c, i) => (
          <span key={c.id}>
            <span
              className="crumb"
              onClick={() => onNavigateCourse(c.id)}
            >
              {c.name}
            </span>
            {i < path.length - 1 && <span className="crumb-sep"> / </span>}
          </span>
        ))}
      </div>

      {/* 子课程（目录嵌套）：点击钻取，强化「目录↔知识点」的归属关系 */}
      {subCourses.length > 0 && (
        <div className="panel">
          <div className="muted" style={{ marginBottom: 8 }}>子课程（点击进入）</div>
          <div className="subcourse-grid">
            {subCourses.map((c) => (
              <div
                key={c.id}
                className="subcourse"
                onClick={() => onNavigateCourse(c.id)}
              >
                <strong>{c.name}</strong>
                <span className="muted">{allKps.filter((k) => k.courseId === c.id).length} 个知识点</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="muted" style={{ marginBottom: 8 }}>手动录入一个知识点（归属当前课程）</div>
        <input
          placeholder="知识点标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        <textarea
          placeholder="知识点内容（支持 Markdown）"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        <div className="row">
          <input
            placeholder="标签，逗号分隔"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
          <button className="primary" onClick={submitAdd}>添加知识点</button>
          <label className="mini" style={{ cursor: 'pointer', border: '1px solid var(--border)', padding: '3px 9px', borderRadius: 8 }}>
            上传文件 (md/txt/json/docx/pptx/pdf)
            <input
              type="file"
              accept=".md,.txt,.json,.docx,.pptx,.pdf"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => onFiles(e.target.files)}
            />
          </label>
          <label className="mini" style={{ cursor: 'pointer', border: '1px solid var(--border)', padding: '3px 9px', borderRadius: 8 }}>
            {busy ? '解析中…' : '上传文件夹（递归）'}
            <input
              type="file"
              /* @ts-expect-error webkitdirectory 非标准属性 */
              webkitdirectory=""
              directory=""
              style={{ display: 'none' }}
              onChange={(e) => onFolder(e.target.files)}
            />
          </label>
        </div>
      </div>

      {plan && (
        <div className="panel" style={{ marginTop: 12, borderColor: 'var(--accent)' }}>
          <div style={{ marginBottom: 8 }}>
            将导入：<b>{plan.stats.courseCount}</b> 门课程（来自文件夹目录）、
            <b>{plan.stats.kpCount}</b> 个知识点（来自 {plan.stats.fileCount} 个文件）
            {plan.stats.skipped > 0 && <>；跳过 {plan.stats.skipped} 个不支持/忽略的文件</>}
          </div>
          <label className="row" style={{ marginBottom: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={mountUnder} onChange={(e) => setMountUnder(e.target.checked)} />
            <span>挂载到当前课程「{course?.name}」下（取消则作为顶级课程）</span>
          </label>
          <div className="row">
            <button className="primary" onClick={confirmImport}>确认导入</button>
            <button className="ghost" onClick={() => setPlan(null)}>取消</button>
          </div>
        </div>
      )}

      <div className="kp-list">
        {directKps.length === 0 && subCourses.length === 0 && (
          <div className="empty">该课程下还没有知识点。录入 / 上传 / 导入文件夹后，点击知识点卡片可查看详情与 AI 优化。</div>
        )}
        {directKps.map((k) => (
          <KPCard
            key={k.id}
            kp={k}
            onClick={() => setDetailId(k.id)}
            onDelete={() => {
              if (confirm(`删除知识点「${k.title}」？`)) deleteKP(k.id)
            }}
          />
        ))}
      </div>

      {detailKp && <KnowledgePointDetail kp={detailKp} onClose={() => setDetailId(null)} />}
    </div>
  )
}

function KPCard({
  kp,
  onClick,
  onDelete,
}: {
  kp: KnowledgePoint
  onClick: () => void
  onDelete: () => void
}) {
  const settings = useStore((s) => s.settings)
  const optimizeKP = useStore((s) => s.optimizeKP)
  const hasAi = !!kp.aiContent
  const [aiBusy, setAiBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const quickOptimize = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (aiBusy) return
    setAiBusy(true)
    setErr(null)
    try {
      const ai = await optimizeOne(settings, kp)
      if (ai) optimizeKP(kp.id, ai)
      else setErr('返回为空')
    } catch (er: any) {
      setErr(er?.message || String(er))
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <div className="card kp-card" onClick={onClick}>
      <div className="row">
        <strong>{kp.title}</strong>
        <div className="spacer" />
        {err && <span className="badge bad" title={err}>失败</span>}
        <span className="tag">{kp.sourceType}</span>
        {hasAi && <span className="badge fix">AI已补充</span>}
        {kp.tags.map((x) => (
          <span key={x} className="tag">#{x}</span>
        ))}
        <button
          className="mini accent-2"
          onClick={quickOptimize}
          disabled={aiBusy}
          title={hasAi ? '重新生成 AI 补充与拓展' : '基于原文生成 AI 补充与拓展'}
        >
          {aiBusy ? '生成中…' : hasAi ? '重补充' : '✨ AI补充'}
        </button>
        <button
          className="mini danger"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          删除
        </button>
      </div>
      <div className="muted" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
        {kp.content.slice(0, 200)}
        {kp.content.length > 200 ? '…' : ''}
      </div>
      <div className="muted" style={{ marginTop: 4, fontSize: 11 }}>点击查看详情 / 编辑 / AI 优化</div>
    </div>
  )
}

import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { countKPsInSubtree } from '../../lib/courseTree'
import type { Course } from '../../types'

/**
 * 常驻左侧栏的课程树：以目录为核心的一级导航。
 * - 递归展开 / 折叠，点击节点即选中课程（作用域到右侧内容）。
 * - 每个节点显示其子树的知识点数量，直观呈现「目录 ↔ 知识点」的关联关系。
 * - 保留改 / ＋（子课程）/ ×（删除子树）的就地 CRUD。
 */
export default function CourseTree({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const courses = useStore((s) => s.courses)
  const kps = useStore((s) => s.knowledgePoints)
  const addCourse = useStore((s) => s.addCourse)
  const renameCourse = useStore((s) => s.renameCourse)
  const deleteCourse = useStore((s) => s.deleteCourse)

  // 默认展开全部；折叠状态可切换。
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const roots = courses.filter((c) => c.parentId === null)

  const renderNode = (c: Course) => {
    const children = courses.filter((x) => x.parentId === c.id)
    const isCollapsed = collapsed.has(c.id)
    const count = countKPsInSubtree(courses, kps, c.id)
    return (
      <div className="tree-node" key={c.id}>
        <div
          className={`tree-row ${selectedId === c.id ? 'sel' : ''}`}
          onClick={() => onSelect(c.id)}
        >
          <span
            className="tree-toggle"
            style={{ width: 14, textAlign: 'center', cursor: 'pointer', opacity: children.length ? 1 : 0.25 }}
            onClick={(e) => {
              e.stopPropagation()
              if (children.length) toggle(c.id)
            }}
          >
            {children.length ? (isCollapsed ? '▸' : '▾') : '·'}
          </span>
          <span
            style={{
              flex: 1,
              cursor: 'pointer',
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
              minWidth: 0,
            }}
            title={c.name}
          >
            {c.name}
          </span>
          {(count > 0 || children.length > 0) && <span className="tree-count">{count}</span>}
          <button
            className="mini ghost"
            title="重命名"
            onClick={(e) => {
              e.stopPropagation()
              const n = prompt('重命名', c.name)
              if (n && n.trim()) renameCourse(c.id, n.trim())
            }}
          >
            改
          </button>
          <button
            className="mini ghost"
            title="新建子课程"
            onClick={(e) => {
              e.stopPropagation()
              addCourse('新子课程', c.id)
            }}
          >
            ＋
          </button>
          <button
            className="mini danger"
            title="删除（含子课程与下属知识点）"
            onClick={(e) => {
              e.stopPropagation()
              if (confirm(`删除「${c.name}」及其子课程与下属知识点？`)) deleteCourse(c.id)
            }}
          >
            ×
          </button>
        </div>
        {!isCollapsed && children.length > 0 && (
          <div className="tree-children">
            {children.map((x) => renderNode(x))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="course-tree">
      <div className="row" style={{ marginBottom: 8 }}>
        <input
          placeholder="新建根课程"
          onKeyDown={(e) => {
            const v = (e.target as HTMLInputElement).value.trim()
            if (e.key === 'Enter' && v) {
              addCourse(v, null)
              ;(e.target as HTMLInputElement).value = ''
            }
          }}
        />
        <button
          className="primary mini"
          onClick={(e) => {
            const input = (e.currentTarget.previousSibling as HTMLInputElement)
            const v = input.value.trim()
            if (v) {
              addCourse(v, null)
              input.value = ''
            }
          }}
        >
          ＋
        </button>
      </div>
      {roots.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>
          暂无课程。在上方输入名称创建根课程，或去「知识点」导入文件夹。
        </div>
      ) : (
        roots.map((r) => renderNode(r))
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useStore } from './store/useStore'
import { getLastBackupAt } from './lib/autoBackup'
import { isDesktop } from './lib/desktop'
import CourseTree from './features/courses/CourseTree'
import KnowledgeView from './features/knowledge/KnowledgeView'
import SelfTestView from './features/selfTest/SelfTestView'
import InterviewView from './features/interview/InterviewView'
import SettingsView from './features/settings/SettingsView'

type Tab = 'knowledge' | 'selftest' | 'interview' | 'settings'

const NAV: { key: Tab; label: string }[] = [
  { key: 'knowledge', label: '知识点' },
  { key: 'selftest', label: '自测' },
  { key: 'interview', label: '模拟面试' },
  { key: 'settings', label: '设置' },
]

const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 560
const STALE_BACKUP_MS = 7 * 24 * 60 * 60 * 1000

export default function App() {
  const [tab, setTab] = useState<Tab>('knowledge')
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [sidebarW, setSidebarW] = useState<number>(() => {
    const saved =
      typeof localStorage !== 'undefined' ? localStorage.getItem('sqa-sidebar-w') : null
    const n = saved ? Number(saved) : NaN
    if (Number.isFinite(n)) return Math.min(Math.max(n, SIDEBAR_MIN), SIDEBAR_MAX)
    return 280
  })
  const draggingRef = useRef(false)
  const hydrated = useStore((s) => s.hydrated)
  const courseCount = useStore((s) => s.courses.length)
  const kpCount = useStore((s) => s.knowledgePoints.length)

  // 数据安全兜底：有数据但超过 7 天没备份 ⇒ 顶栏告警 + 关闭页面前弹浏览器确认。
  const [staleBackup, setStaleBackup] = useState(false)
  useEffect(() => {
    const at = getLastBackupAt()
    const hasData = useStore.getState().knowledgePoints.length > 0
    const stale = hasData && (!at || Date.now() - at > STALE_BACKUP_MS)
    setStaleBackup(stale)
    if (!stale) return
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [hydrated, kpCount])

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return
      const w = Math.min(Math.max(ev.clientX, SIDEBAR_MIN), Math.min(SIDEBAR_MAX, window.innerWidth - 320))
      setSidebarW(w)
    }
    const onUp = () => {
      draggingRef.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try {
        localStorage.setItem('sqa-sidebar-w', String(sidebarW))
      } catch {
        /* ignore */
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  if (!hydrated) {
    return (
      <div className="app">
        <main className="main">
          <div className="empty" style={{ marginTop: 80 }}>加载中…</div>
        </main>
      </div>
    )
  }

  return (
    <div className="app" style={{ ['--sidebar-w' as string]: `${sidebarW}px` } as React.CSSProperties}>
      <aside className="sidebar">
        <div className="brand">
          技能问答 Agent
          <small>前端 / 全栈 / AI 自测</small>
        </div>
        <div className="muted" style={{ fontSize: 11, margin: '2px 2px 8px' }}>
          课程目录（点击进入）
        </div>
        <div className="tree-scroll">
          <CourseTree selectedId={selectedCourseId} onSelect={setSelectedCourseId} />
        </div>
        <div className="muted sidebar-foot" style={{ fontSize: 11 }}>
          {courseCount} 门课程 · {kpCount} 个知识点
        </div>
      </aside>
      <div className="resizer" onMouseDown={startResize} title="拖拽调整侧栏宽度" />
      <main className="main">
        <div className="topbar">
          {NAV.map((n) => (
            <div
              key={n.key}
              className={`tab ${tab === n.key ? 'active' : ''}`}
              onClick={() => setTab(n.key)}
            >
              {n.label}
            </div>
          ))}
          {staleBackup && (
            <div
              className="tab"
              style={{ marginLeft: 'auto', color: 'var(--warn)', borderColor: 'var(--warn)' }}
              title={
                isDesktop()
                  ? '超过 7 天没有做 JSON 备份。数据库文件还在，但建议再导出一份。'
                  : '数据只存在浏览器本地库中，清站点数据会全部丢失。点击前往设置备份。'
              }
              onClick={() => setTab('settings')}
            >
              数据未备份
            </div>
          )}
        </div>
        {tab === 'knowledge' && <KnowledgeView courseId={selectedCourseId} onNavigateCourse={setSelectedCourseId} />}
        {tab === 'selftest' && <SelfTestView courseId={selectedCourseId} />}
        {tab === 'interview' && <InterviewView courseId={selectedCourseId} />}
        {tab === 'settings' && <SettingsView />}
      </main>
    </div>
  )
}

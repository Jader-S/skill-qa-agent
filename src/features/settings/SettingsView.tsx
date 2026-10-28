import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store/useStore'
import { PRESETS } from '../../lib/llm'
import { downloadBackup, parseBackup } from '../../lib/backup'
import {
  connectDir,
  disconnectDir,
  getDirName,
  getLastBackupAt,
  isDirSupported,
  listSnapshots,
  loadSnapshot,
  markBackedUp,
  runAutoBackup,
  type SnapshotMeta,
} from '../../lib/autoBackup'
import type { LLMConfig } from '../../types'
import { ensureDbPath, getCachedDbPath, isDesktop } from '../../lib/desktop'

const STALE_MS = 7 * 24 * 60 * 60 * 1000

function fmtAgo(at: number | null): string {
  if (!at) return '从未备份'
  const diff = Date.now() - at
  if (diff < 60 * 60 * 1000) return '刚刚'
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`
  return `${Math.floor(diff / 86400000)} 天前`
}

export default function SettingsView() {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const reset = useStore((s) => s.reset)
  const replaceAll = useStore((s) => s.replaceAll)
  const voice = useStore((s) => s.voice)
  const setVoice = useStore((s) => s.setVoice)
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string>('')
  const desktop = isDesktop()
  const [dbPath, setDbPath] = useState<string | null>(() => getCachedDbPath())

  // 自动备份面板
  const [lastAt, setLastAt] = useState<number | null>(() => getLastBackupAt())
  const [dirName, setDirName] = useState<string | null>(null)
  const [snaps, setSnaps] = useState<SnapshotMeta[]>([])
  const [abMsg, setAbMsg] = useState('')

  useEffect(() => {
    void (async () => {
      setDirName(await getDirName())
      setSnaps(await listSnapshots())
      if (desktop) setDbPath(await ensureDbPath())
    })()
  }, [desktop])

  const stale = !lastAt || Date.now() - lastAt > STALE_MS

  const doAutoBackup = async () => {
    setAbMsg('备份中…')
    const r = await runAutoBackup(useStore.getState())
    setLastAt(getLastBackupAt())
    setSnaps(await listSnapshots())
    setAbMsg(
      `已备份：本地快照${r.snap ? '成功' : '失败'}` +
        (r.file ? ` · 已写入 ${r.file}` : dirName ? ' · 写入文件夹失败（权限可能已失效）' : ''),
    )
  }

  const doConnect = async () => {
    if (!isDirSupported()) {
      setAbMsg('当前浏览器不支持「连接文件夹」（需 Chrome / Edge）。可继续用本地快照 + 手动下载备份。')
      return
    }
    try {
      const n = await connectDir()
      if (!n) {
        setAbMsg('已取消选择文件夹。')
        return
      }
      setDirName(n)
      setAbMsg(`已连接备份文件夹：${n}`)
    } catch (e: any) {
      setAbMsg('连接失败：' + e.message)
    }
  }

  const doDisconnect = async () => {
    await disconnectDir()
    setDirName(null)
    setAbMsg('已断开备份文件夹')
  }

  const doRollback = async (id: string, at: number) => {
    if (!confirm(`回滚到 ${new Date(at).toLocaleString()} 的快照？将整库覆盖当前数据，且不可恢复。`)) return
    try {
      const data = await loadSnapshot(id)
      replaceAll(data)
      setAbMsg('已回滚到所选快照')
    } catch (e: any) {
      setAbMsg('回滚失败：' + e.message)
    }
  }

  const preset = PRESETS[settings.provider]

  return (
    <div>
      <h2 className="page-title">设置</h2>

      <div className="panel">
        <div className="muted" style={{ marginBottom: 10 }}>
          LLM 后端（混合可切换）。默认走云端 API；勾选 Mock 可完全离线演示，无需 Key。
        </div>

        <label className="row" style={{ marginBottom: 10 }}>
          <span style={{ width: 90 }}>提供方</span>
          <select
            value={settings.provider}
            onChange={(e) =>
              setSettings({
                provider: e.target.value as LLMConfig['provider'],
                baseURL: '',
                model: '',
              })
            }
          >
            {Object.entries(PRESETS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>

        <label className="row" style={{ marginBottom: 10 }}>
          <span style={{ width: 90 }}>离线 Mock</span>
          <input
            type="checkbox"
            checked={settings.useMock}
            onChange={(e) => setSettings({ useMock: e.target.checked })}
            style={{ width: 'auto' }}
          />
        </label>

        <label className="row" style={{ marginBottom: 10 }}>
          <span style={{ width: 90 }}>Base URL</span>
          <input
            placeholder={preset?.baseURL ?? ''}
            value={settings.baseURL}
            onChange={(e) => setSettings({ baseURL: e.target.value })}
          />
        </label>

        <label className="row" style={{ marginBottom: 10 }}>
          <span style={{ width: 90 }}>API Key</span>
          <input
            type="password"
            placeholder="本地保存，不上传"
            value={settings.apiKey}
            onChange={(e) => setSettings({ apiKey: e.target.value })}
          />
        </label>

        <label className="row" style={{ marginBottom: 10 }}>
          <span style={{ width: 90 }}>模型名</span>
          <input
            placeholder={preset?.model ?? ''}
            value={settings.model}
            onChange={(e) => setSettings({ model: e.target.value })}
          />
        </label>

        <div className="muted">
          当前：<b>{settings.useMock ? 'Mock 离线模式' : `${preset?.label} · ${settings.model || preset?.model}`}</b>
          {settings.apiKey && !settings.useMock && (desktop ? ' · 已接入 API Key（存在 Windows 凭据管理器）' : ' · 已接入 API Key（默认来自 .env.local）')}
        </div>
      </div>

      <div className="panel">
        <div className="muted" style={{ marginBottom: 8 }}>
          {desktop
            ? `桌面版数据库：${dbPath || '正在打开…'}。API Key 存在 Windows 凭据管理器，不会写进这个文件。这里的数据和浏览器里的库是分开的；要把网页里的资料带过来，请先在浏览器导出整库备份，再于下方导入。`
            : '数据管理：所有课程/知识点/题目/答案均保存在本地浏览器。'}
        </div>
        <button
          className="danger"
          onClick={() => {
            if (confirm('清空全部本地数据？此操作不可恢复。')) reset()
          }}
        >
          清空全部数据
        </button>
      </div>

      <div className="panel">
        <div className="muted" style={{ marginBottom: 10 }}>
          {desktop
            ? '自动备份：课程数据已经写在上面的数据库文件里。这里仍会留本地 JSON 快照（最近 5 份），连接文件夹后还会按天抄一份到磁盘。距上次备份超 10 分钟且有数据变更时自动触发。'
            : '自动备份：数据只存在浏览器本地库里，清站点数据会全部丢失。系统会自动留存本地快照（最近 5 份）；连接文件夹后，还会把备份 JSON 真正写进磁盘。距上次备份超 10 分钟且有数据变更时自动触发。'}
        </div>

        <div className="row" style={{ marginBottom: 8 }}>
          <span>
            上次备份：
            <b style={{ color: stale ? 'var(--warn)' : 'var(--accent-2)' }}>{fmtAgo(lastAt)}</b>
          </span>
          <div className="spacer" />
          <button className="primary" onClick={doAutoBackup}>
            立即备份
          </button>
        </div>

        <div className="row" style={{ marginBottom: 8 }}>
          <span>
            备份文件夹：
            {dirName ? <b style={{ color: 'var(--accent-2)' }}>{dirName}</b> : <span className="muted">未连接</span>}
          </span>
          <div className="spacer" />
          {dirName ? (
            <button onClick={doDisconnect}>断开</button>
          ) : (
            <button onClick={doConnect}>连接文件夹</button>
          )}
        </div>

        {stale && (
          <div style={{ color: 'var(--warn)', fontSize: 13, marginBottom: 8 }}>
            {lastAt ? '距上次备份已超过 7 天' : '尚未做过任何备份'}，建议立即备份或连接备份文件夹。
          </div>
        )}

        {snaps.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <div className="muted" style={{ marginBottom: 6 }}>
              本地快照（最近 {snaps.length} 份）
            </div>
            {snaps.map((s) => (
              <div key={s.id} className="row" style={{ marginBottom: 4 }}>
                <span>{new Date(s.at).toLocaleString()}</span>
                <span className="muted">
                  {s.courses} 课程 · {s.kps} 知识点 · {(s.bytes / 1024).toFixed(0)} KB
                </span>
                <div className="spacer" />
                <button className="ghost" onClick={() => doRollback(s.id, s.at)}>
                  回滚
                </button>
              </div>
            ))}
          </div>
        )}

        {abMsg && (
          <div className="muted" style={{ marginTop: 8 }}>
            {abMsg}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="muted" style={{ marginBottom: 8 }}>
          整库备份：把全部课程 / 知识点 / 题目 / 答案 / 修正 / 面试 / 设置导出成一个 JSON
          文件。换机、清浏览器数据或重装前用它恢复（区别于「导出 Obsidian」仅导出知识点）。
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => {
              downloadBackup(useStore.getState())
              markBackedUp()
              setLastAt(Date.now())
              setMsg('已导出整库备份文件（.json）')
            }}
          >
            导出整库备份
          </button>
          <button
            onClick={() => {
              fileRef.current?.click()
            }}
          >
            导入整库备份
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              try {
                const text = await f.text()
                const data = parseBackup(text)
                if (
                  !confirm(
                    '导入将用备份文件「整库覆盖」当前所有数据，且不可恢复。确认继续？',
                  )
                ) {
                  return
                }
                replaceAll(data)
                setMsg('整库备份已导入并覆盖当前数据')
              } catch (err) {
                setMsg(`导入失败：${(err as Error).message}`)
              }
            }}
          />
        </div>
        {msg && (
          <div className="muted" style={{ marginTop: 8 }}>
            {msg}
          </div>
        )}
      </div>
    </div>
  )
}

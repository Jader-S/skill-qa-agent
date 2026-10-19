import type { AppState } from '../types'
import { buildBackup, parseBackup } from './backup'

/**
 * 数据安全兜底层（不依赖 Rust / Tauri，纯浏览器可用）。
 *
 * 背景：全部数据只存在浏览器 IndexedDB 里，清站点数据即全部丢失。
 * 这里提供两道防线：
 *   1. 本地自动快照 —— 存进**独立的** IndexedDB 库，保留最近 N 份，可一键回滚（防误删/损坏）。
 *   2. 真实文件夹落盘 —— File System Access API 授权一次后，自动把备份 JSON 写进用户选的
 *      真实目录（防清浏览器数据 / 换机）。浏览器不支持时降级为「快照 + 手动下载」。
 */

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: any) => Promise<any>
  }
}

const IDB_NAME = 'skill-qa-agent-backups'
const SNAP_STORE = 'snapshots'
const MISC_STORE = 'misc'
const DIR_KEY = 'backup-dir-handle'
const LS_LAST_KEY = 'sqa-last-backup-at'

/** 本地快照保留份数。 */
export const MAX_SNAPSHOTS = 5
/** 落盘文件保留份数（按天命名，同一天覆盖）。 */
export const MAX_DIR_FILES = 7
export const FILE_PREFIX = 'skill-qa-agent-auto-'

export type SnapshotMeta = {
  id: string
  at: number
  bytes: number
  courses: number
  kps: number
}

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(SNAP_STORE)) d.createObjectStore(SNAP_STORE)
      if (!d.objectStoreNames.contains(MISC_STORE)) d.createObjectStore(MISC_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(d: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode)
    const rq = fn(t.objectStore(store))
    rq.onsuccess = () => resolve(rq.result)
    rq.onerror = () => reject(rq.error)
  })
}

// ---------- 防线 1：本地自动快照 ----------

export async function saveSnapshot(state: AppState): Promise<SnapshotMeta | null> {
  try {
    const payload = JSON.stringify(buildBackup(state))
    const meta: SnapshotMeta = {
      id: String(Date.now()),
      at: Date.now(),
      bytes: payload.length,
      courses: state.courses.length,
      kps: state.knowledgePoints.length,
    }
    const d = await idbOpen()
    await tx(d, SNAP_STORE, 'readwrite', (s) => s.put({ meta, payload }, meta.id) as IDBRequest<any>)
    const keys = (await tx(d, SNAP_STORE, 'readonly', (s) => s.getAllKeys())) as string[]
    if (keys.length > MAX_SNAPSHOTS) {
      const sorted = keys.slice().sort()
      for (const k of sorted.slice(0, keys.length - MAX_SNAPSHOTS)) {
        await tx(d, SNAP_STORE, 'readwrite', (s) => s.delete(k) as IDBRequest<any>)
      }
    }
    return meta
  } catch {
    return null
  }
}

export async function listSnapshots(): Promise<SnapshotMeta[]> {
  try {
    const d = await idbOpen()
    const rows = (await tx(d, SNAP_STORE, 'readonly', (s) => s.getAll())) as { meta: SnapshotMeta }[]
    return rows.map((r) => r.meta).sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}

/** 读回某份快照并解析成可整库替换的 AppState。 */
export async function loadSnapshot(id: string): Promise<AppState> {
  const d = await idbOpen()
  const row = (await tx(d, SNAP_STORE, 'readonly', (s) => s.get(id))) as
    | { meta: SnapshotMeta; payload: string }
    | undefined
  if (!row) throw new Error('快照不存在')
  return parseBackup(row.payload)
}

// ---------- 防线 2：真实文件夹落盘 ----------

export function isDirSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

async function readHandle(): Promise<any | null> {
  try {
    const d = await idbOpen()
    return (await tx(d, MISC_STORE, 'readonly', (s) => s.get(DIR_KEY))) ?? null
  } catch {
    return null
  }
}

async function ensurePermission(h: any): Promise<boolean> {
  if (!h || typeof h.queryPermission !== 'function') return true
  const opts = { mode: 'readwrite' }
  let p = await h.queryPermission(opts)
  if (p === 'granted') return true
  if (typeof h.requestPermission === 'function') p = await h.requestPermission(opts)
  return p === 'granted'
}

/** 弹出系统目录选择器并记住句柄；返回目录名，不支持/取消返回 null。 */
export async function connectDir(): Promise<string | null> {
  if (!isDirSupported()) return null
  const h = await window.showDirectoryPicker!({ id: 'sqa-backup', mode: 'readwrite' })
  if (!h) return null
  const d = await idbOpen()
  await tx(d, MISC_STORE, 'readwrite', (s) => s.put(h, DIR_KEY) as IDBRequest<any>)
  return (h.name as string) ?? null
}

export async function disconnectDir(): Promise<void> {
  const d = await idbOpen()
  await tx(d, MISC_STORE, 'readwrite', (s) => s.delete(DIR_KEY) as IDBRequest<any>)
}

/** 已连接的备份目录名（未连接返回 null）。 */
export async function getDirName(): Promise<string | null> {
  const h = await readHandle()
  return h ? ((h.name as string) ?? '已连接') : null
}

async function pruneDir(h: any): Promise<void> {
  try {
    const names: string[] = []
    for await (const [name, entry] of h.entries()) {
      if (entry?.kind === 'file' && String(name).startsWith(FILE_PREFIX) && String(name).endsWith('.json')) {
        names.push(String(name))
      }
    }
    if (names.length <= MAX_DIR_FILES) return
    names.sort()
    for (const n of names.slice(0, names.length - MAX_DIR_FILES)) {
      await h.removeEntry(n)
    }
  } catch {
    /* 清理失败不影响备份本身 */
  }
}

/** 把整库 JSON 写进已连接的真实目录，按天一份（同一天覆盖），返回文件名。 */
export async function writeToDir(state: AppState): Promise<string | null> {
  const h = await readHandle()
  if (!h) return null
  if (!(await ensurePermission(h))) return null
  const day = new Date().toISOString().slice(0, 10)
  const name = `${FILE_PREFIX}${day}.json`
  const fh = await h.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(JSON.stringify(buildBackup(state), null, 2))
  await w.close()
  await pruneDir(h)
  return name
}

// ---------- 编排 ----------

/** 上次成功备份时间（localStorage，同步读取，便于 UI 即时显示）。 */
export function getLastBackupAt(): number | null {
  try {
    const v = localStorage.getItem(LS_LAST_KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

/** 标记「刚刚备份过」（手动下载备份文件时也调用）。 */
export function markBackedUp(at = Date.now()): void {
  try {
    localStorage.setItem(LS_LAST_KEY, String(at))
  } catch {
    /* noop */
  }
}

export type AutoBackupResult = { snap: boolean; file: string | null }

/** 执行一次自动备份：本地快照 + （若已连目录）真实落盘。 */
export async function runAutoBackup(state: AppState): Promise<AutoBackupResult> {
  const meta = await saveSnapshot(state)
  const file = await writeToDir(state).catch(() => null)
  if (meta || file) markBackedUp()
  return { snap: !!meta, file }
}

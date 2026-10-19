import initSqlJs from 'sql.js'
// Vite 会把 wasm 作为资源处理并返回 URL；浏览器加载需要它。
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import type { AppState } from '../types'
import * as schema from './dbSchema'

/**
 * 浏览器内「独立数据库」适配层：sql.js（SQLite 编译成 WASM）跑真 SQL，
 * DB 文件字节持久化到 IndexedDB。无需服务器、规范化多表、自动保存。
 *
 * 接口刻意做成 DatabaseAdapter 风格（open/syncAll/loadAll/resetDb），
 * 将来切 Tauri 原生 SQLite 或 Node better-sqlite3 时只换本文件实现，store 不动。
 */

let SQL: any = null
let database: any = null
let ready: Promise<void> | null = null

const IDB_NAME = 'skill-qa-agent'
const IDB_STORE = 'sqlite'
const DB_KEY = 'main'

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(key: string): Promise<Uint8Array | null> {
  const dbh = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = dbh.transaction(IDB_STORE, 'readonly')
    const rq = tx.objectStore(IDB_STORE).get(key)
    rq.onsuccess = () => resolve((rq.result as Uint8Array) ?? null)
    rq.onerror = () => reject(rq.error)
  })
}

async function idbSet(key: string, data: Uint8Array): Promise<void> {
  const dbh = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = dbh.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(data, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 启动数据库：初始化 WASM、从 IndexedDB 载入已有 DB 文件、建表、一次性迁移旧 localStorage。 */
export async function openDb(): Promise<void> {
  if (ready) return ready
  ready = (async () => {
    if (!SQL) {
      SQL = await initSqlJs({ locateFile: () => sqlWasmUrl })
    }
    const bytes = await idbGet(DB_KEY)
    database = bytes ? new SQL.Database(bytes) : new SQL.Database()
    schema.migrate(database)
    schema.migrateFromLocalStorage(database)
  })()
  return ready
}

/** 全量同步 AppState 到各表，并把 DB 文件落盘到 IndexedDB（防抖由调用方控制）。 */
export async function syncAll(state: AppState): Promise<void> {
  if (!database) return
  schema.syncAll(database, state)
  const bytes = database.export()
  await idbSet(DB_KEY, bytes)
}

/** 从各表读回完整 AppState。 */
export async function loadAll(): Promise<AppState> {
  if (!database) {
    return {
      courses: [],
      knowledgePoints: [],
      questions: [],
      answers: [],
      corrections: [],
      interviewSessions: [],
      settings: { provider: 'deepseek', baseURL: '', apiKey: '', model: '', useMock: true },
      voice: { lang: 'zh-CN' },
    }
  }
  return schema.loadAll(database)
}

/** 重置：清空所有业务表。 */
export async function resetDb(): Promise<void> {
  if (!database) {
    await openDb()
  }
  schema.resetDb(database)
}

import initSqlJs from 'sql.js'
// Vite 会把 wasm 作为资源处理并返回 URL；浏览器加载需要它。
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import type { AppState } from '../types'
import * as schema from './dbSchema'
import {
  forgetApiKey,
  isDesktop,
  openDesktopDatabase,
  readApiKey,
  rememberApiKey,
} from './desktop'

/**
 * 数据库适配层。
 * - 浏览器：sql.js（真 SQLite）+ IndexedDB 持久化。
 * - 桌面壳：同一套 SQL 交给 Rust rusqlite，文件落在应用数据目录。
 * store 只调用 open / syncAll / loadAll / resetDb。
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

/** 桌面版不把 API Key 写进数据库文件；写入失败时保留在文件里，避免丢钥匙。 */
async function sealSettings(state: AppState): Promise<AppState> {
  if (!isDesktop()) return state
  const key = state.settings.apiKey || ''
  try {
    if (key) await rememberApiKey(key)
    else await forgetApiKey()
    return { ...state, settings: { ...state.settings, apiKey: '' } }
  } catch (error) {
    console.error('凭据管理器写入失败，API Key 仍会留在数据库文件里', error)
    return state
  }
}

async function unsealSettings(state: AppState): Promise<AppState> {
  if (!isDesktop()) return state
  let vault = ''
  try {
    vault = await readApiKey()
  } catch (error) {
    console.error('读取凭据管理器失败', error)
  }
  const fromDb = state.settings.apiKey || ''
  const key = vault || fromDb
  if (fromDb) {
    try {
      if (fromDb !== vault) await rememberApiKey(fromDb)
      await database.run('UPDATE kv SET value = ? WHERE key = ?', [
        JSON.stringify({ ...state.settings, apiKey: '' }),
        'settings',
      ])
    } catch (error) {
      console.error('无法把已有 API Key 迁入凭据管理器', error)
    }
  }
  return { ...state, settings: { ...state.settings, apiKey: key } }
}

/** 启动数据库：浏览器走 WASM + IndexedDB；桌面壳打开本机 .db 文件。 */
export async function openDb(): Promise<void> {
  if (ready) return ready
  ready = (async () => {
    if (isDesktop()) {
      database = await openDesktopDatabase()
    } else {
      if (!SQL) {
        SQL = await initSqlJs({ locateFile: () => sqlWasmUrl })
      }
      const bytes = await idbGet(DB_KEY)
      database = bytes ? new SQL.Database(bytes) : new SQL.Database()
    }
    await schema.migrate(database)
    await schema.migrateFromLocalStorage(database)
  })()
  return ready
}

/** 全量同步 AppState。浏览器再把 DB 字节写入 IndexedDB；桌面壳由 rusqlite 直接落盘。 */
export async function syncAll(state: AppState): Promise<void> {
  if (!database) return
  const sealed = await sealSettings(state)
  await schema.syncAll(database, sealed)
  if (!isDesktop()) {
    const bytes = database.export()
    await idbSet(DB_KEY, bytes)
  }
}

/** 从各表读回完整 AppState。桌面版会把凭据管理器里的 API Key 填回内存。 */
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
  return unsealSettings(await schema.loadAll(database))
}

/** 重置：清空所有业务表。 */
export async function resetDb(): Promise<void> {
  if (!database) {
    await openDb()
  }
  await schema.resetDb(database)
}

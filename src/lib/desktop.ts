/**
 * 桌面壳（Tauri）探测与原生命令。
 * 浏览器里这些函数不会被调用；invoke 也只在确认是桌面窗口后才动态加载。
 */

let cachedDbPath: string | null = null

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function getCachedDbPath(): string | null {
  return cachedDbPath
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

/** 打开（或复用）应用数据目录里的 skill-qa-agent.db，返回给 dbSchema 用的 run/exec。 */
export async function openDesktopDatabase(): Promise<{
  run: (sql: string, params?: unknown[]) => Promise<void>
  exec: (sql: string) => Promise<{ columns: string[]; values: unknown[][] }[]>
}> {
  cachedDbPath = await invoke<string>('db_open')
  return {
    async run(sql: string, params?: unknown[]) {
      await invoke('db_run', { sql, params: params ?? [] })
    },
    async exec(sql: string) {
      return await invoke('db_query', { sql })
    },
  }
}

export async function ensureDbPath(): Promise<string | null> {
  if (!isDesktop()) return null
  if (cachedDbPath) return cachedDbPath
  try {
    cachedDbPath = await invoke<string>('db_path')
    return cachedDbPath
  } catch {
    return null
  }
}

export async function readApiKey(): Promise<string> {
  const value = await invoke<string | null>('secret_get')
  return value ?? ''
}

export async function rememberApiKey(secret: string): Promise<void> {
  if (!secret) {
    await invoke('secret_delete')
    return
  }
  await invoke('secret_set', { secret })
}

export async function forgetApiKey(): Promise<void> {
  await invoke('secret_delete')
}

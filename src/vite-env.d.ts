/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LLM_PROVIDER?: string
  readonly VITE_LLM_BASE_URL?: string
  readonly VITE_LLM_MODEL?: string
  readonly VITE_LLM_API_KEY?: string
  readonly VITE_LLM_USE_MOCK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// sql.js 的 wasm 资源通过 Vite ?url 导入
declare module 'sql.js/dist/sql-wasm.wasm?url' {
  const src: string
  export default src
}

// sql.js 无官方类型声明，按 any 处理
declare module 'sql.js'

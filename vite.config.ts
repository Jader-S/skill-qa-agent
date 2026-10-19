import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tauri 约定开发端口 1420；桌面构建时由 tauri.conf.json 的 devUrl 引用。
export default defineConfig({
  plugins: [react()],
  server: { port: 1420, strictPort: true },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
})

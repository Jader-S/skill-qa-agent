# 技能问答 Agent

本地优先的学习与面试助手：把课程资料整理成知识点，按章节自测，再用同一份知识库做模拟面试。数据存在浏览器里（sql.js + IndexedDB），不依赖后端服务。

开发端口约定为 **1420**（Tauri 桌面壳已预留，当前按 Vite Web 应用运行）。

## 能做什么

- **课程目录**：左侧常驻课程树，右侧按选中课程作用域切换「知识点 / 自测 / 模拟面试 / 设置」
- **导入资料**：支持文件夹批量导入，以及 `.md` / `.txt` / `.json` / `.docx` / `.pptx` / `.pdf`
- **知识点**：原文与 AI 补充分开展示；可单点或按章节批量生成补充（原文不会被改写）
- **自测**：按章节出题、作答、LLM 评分与追问；可修正答案作为后续权威依据
- **模拟面试**：多轮问答 + 深度/广度/表达评分；进行中进度会自动保存，刷新或切 Tab 后可继续
- **语音作答**：浏览器 Web Speech API 转写（仅输入，不朗读）
- **备份**：整库 JSON 导入/导出；可连接本地文件夹做自动备份（Chrome / Edge）

## 技术栈

React 18 · TypeScript · Vite · Zustand · sql.js（WASM SQLite）· IndexedDB

大模型走 OpenAI 兼容接口，可切换 DeepSeek / OpenAI / 通义千问 / 本地 Ollama，也可开 Mock。

## 本地运行

需要 Node.js 18+。

```bash
npm install
cp .env.example .env.local
npm run dev
```

浏览器打开 http://localhost:1420/

`.env.local` 示例（不要提交这个文件）：

```env
VITE_LLM_PROVIDER=deepseek
VITE_LLM_BASE_URL=
VITE_LLM_MODEL=
VITE_LLM_API_KEY=your_key_here
VITE_LLM_USE_MOCK=false
```

也可在应用「设置」页填写 Provider、Base URL、模型和 API Key。

### 常用命令

```bash
npm run dev         # 开发
npm run build       # 生产构建
npm run preview     # 预览构建产物
npm run typecheck   # TypeScript 检查
npm test            # 解析 / 导入 / 数据库 / 备份等脚本测试
```

## 数据说明

- 课程、知识点、题目、修正、面试记录都在浏览器 IndexedDB 中
- 清站点数据会丢库，请定期在设置里导出整库备份，或连接备份文件夹
- 超过 7 天未备份且库中已有知识点时，顶栏会提示

## 目录

```
src/
  features/     课程树、知识点、自测、面试、设置
  lib/          LLM、解析、检索、备份、语音
  store/        Zustand + 落库
src-tauri/      Tauri v2 壳（需本机安装 Rust 后才能编译桌面版）
scripts/        单测与探测脚本
```

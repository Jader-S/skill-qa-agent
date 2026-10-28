# 技能问答 Agent

本地优先的学习与面试助手：把课程资料整理成知识点，按章节自测，再用同一份知识库做模拟面试。不依赖后端服务。

网页版把数据放在浏览器里；Windows 桌面版写成一个本机 SQLite 文件。开发端口是 **1420**。

## 能做什么

- **课程目录**：左侧常驻课程树，右侧按选中课程切换「知识点 / 自测 / 模拟面试 / 错题本 / 设置」。母节点显示其下全部知识点数量，没有知识点时也显示 0
- **导入资料**：支持文件夹批量导入，以及 `.md` / `.txt` / `.json` / `.docx` / `.pptx` / `.pdf`。Markdown 按标题拆成课程目录，重复导入同一文件夹会覆盖而不是叠出副本
- **没有笔记时生成课程**：按主题先预览目录，确认后再逐节写知识点，也可以按感兴趣的点勾选补充。这类正文标成「AI 编写，尚未对照笔记」；改过正文后标成「已对照并编辑」
- **知识点**：原文按 Markdown 展示，和 AI 补充分开。可单点或按章节批量生成补充，原文不会被改写。「跳过已有补充」只跳过真实补充，Mock 占位可以整批重做。补充进行中切到别的页，顶栏仍显示进度；刷新页面不会续跑
- **自测**：按章节出题、作答、评分与追问；可修正答案作为后续权威依据。低于 60 分时，同一次评分带上丢分点和讲解，复杂内容可附参考链接（新标签页打开，标为未经核实）
- **模拟面试**：多轮问答 + 深度/广度/表达评分；进行中进度会自动保存，刷新或切 Tab 后可继续。每一轮会记下当时检索到的知识点
- **错题本**：收录低于 60 分的自测和面试，可看全部或当前课程。能对着解析和原文自查，或按这些知识点再自测、再面试。达到 60 分或手动标成已掌握后，从在册挪到「已掌握」
- **语音作答**：浏览器 Web Speech API 转写（仅输入，不朗读）
- **AI 调用监控**：设置页按今天 / 近 7 天 / 近 30 天 / 全部查看调用次数和 token。不保存提问和回答正文，也不进整库备份
- **备份**：整库 JSON 导入/导出；可连接本地文件夹做自动备份（Chrome / Edge）

## 技术栈

React 18 · TypeScript · Vite · Zustand · sql.js（WASM SQLite）· IndexedDB

桌面壳：Tauri 2 · rusqlite · Windows 凭据管理器

大模型走 OpenAI 兼容接口，可切换 DeepSeek / OpenAI / 通义千问 / 本地 Ollama。未填写 API Key 时自动使用 Mock，不发起真实请求。

## 本地运行

需要 Node.js 18+。

```bash
npm install
cp .env.example .env.local
npm run dev
```

PowerShell 可把复制写成 `copy .env.example .env.local`。然后打开 http://localhost:1420/ 。

不填 Key 就能点界面、导入资料、走 Mock 出题和评分。要真实模型时，在 `.env.local` 或应用「设置」页填入你自己的 Provider、Base URL、模型和 API Key。

### 配置

`.env.local` 已被 gitignore，不要提交。

```env
VITE_LLM_PROVIDER=deepseek
VITE_LLM_BASE_URL=
VITE_LLM_MODEL=
VITE_LLM_API_KEY=your_key_here
```

`VITE_LLM_API_KEY` 留空时走 Mock；填了 Key 则默认调用真实接口。这些 `VITE_` 变量会在 `npm run build` 时打进前端包，所以不要带着真实 Key 去构建再把 `dist` 或安装包发出去。

### 桌面版

在 Windows 上验证过。除了 Node.js，还需要 [Rust](https://rustup.rs/) 和 Visual Studio 的「使用 C++ 的桌面开发」工作负载。Windows 11 一般已经带了 WebView2。

1420 端口被占用时桌面版起不来。如果网页开发服务还开着，先关掉它。

```bash
npm run desktop          # 开发窗口
npm run desktop:build    # 安装包
```

课程数据在 `%APPDATA%\com.example.skillqa\skill-qa-agent.db`。API Key 写入 Windows 凭据管理器，不进这个文件。桌面库和浏览器库互不相通；要把网页里的资料带过来，先在浏览器「设置」导出整库备份，再在桌面版导入。

### 常用命令

```bash
npm run dev            # 网页开发
npm run build          # 生产构建
npm run preview        # 预览构建产物
npm run desktop        # 桌面开发窗口
npm run desktop:build  # 桌面安装包
npm run typecheck      # TypeScript 检查
npm test               # 解析 / 导入 / 数据库 / 备份等脚本测试
```

## 数据说明

- 浏览器里：课程、知识点、题目、作答、考后解析、错题掌握标记、修正和面试记录都在 IndexedDB 中；清站点数据会丢库
- 桌面版：同一份结构写在 `%APPDATA%\com.example.skillqa\skill-qa-agent.db`，API Key 在 Windows 凭据管理器
- AI 调用次数和 token 记在本地 `llm_calls`，清空全部数据时一并删除，不进整库 JSON
- 自动备份另留最近 5 份 JSON 快照；连接文件夹后还会按天写到磁盘。超过 7 天未备份且库中已有知识点时，顶栏会提示

## 目录

```
src/
  features/     课程树、知识点、自测、面试、错题本、设置
  lib/          LLM、解析、检索、备份、语音、桌面桥接
  store/        Zustand + 落库
src-tauri/      Tauri v2 桌面壳（rusqlite + Windows 凭据管理器）
scripts/        单测与探测脚本
```

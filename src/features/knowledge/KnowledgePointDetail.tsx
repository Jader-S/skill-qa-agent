import { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore'
import { optimizeOne } from '../../lib/batchOptimize'
import type { KnowledgePoint } from '../../types'

/**
 * 知识点详情面板（模态）：
 * - 原文（笔记内容）与 AI 补充与拓展为两个独立区块，各自带标识；原文永不被 AI 改动。
 * - 可编辑标题 / 标签 / 原文 / AI 内容，并单独「清除 AI 补充」或「重新生成」。
 */
export default function KnowledgePointDetail({
  kp,
  onClose,
}: {
  kp: KnowledgePoint
  onClose: () => void
}) {
  const updateKP = useStore((s) => s.updateKP)
  const optimizeKP = useStore((s) => s.optimizeKP)
  const settings = useStore((s) => s.settings)

  const [title, setTitle] = useState(kp.title)
  const [tags, setTags] = useState(kp.tags.join(', '))
  const [content, setContent] = useState(kp.content)
  const [ai, setAi] = useState(kp.aiContent ?? '')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiStream, setAiStream] = useState('')

  // 切换知识点时同步本地状态
  useEffect(() => {
    setTitle(kp.title)
    setTags(kp.tags.join(', '))
    setContent(kp.content)
    setAi(kp.aiContent ?? '')
    setAiStream('')
  }, [kp.id])

  const save = () => {
    updateKP(kp.id, {
      title: title.trim() || kp.title,
      content: content.trim(),
      tags: tags.split(/[,，\s]+/).filter(Boolean),
    })
  }

  const runOptimize = async () => {
    setAiBusy(true)
    setAiStream('AI 补充生成中…')
    try {
      const text = await optimizeOne(
        settings,
        { ...kp, title: title.trim() || kp.title, content: content.trim() },
        undefined,
        (t) => setAiStream(t),
      )
      setAi(text)
      optimizeKP(kp.id, text)
      setAiStream('')
    } catch (e: any) {
      setAiStream('生成失败：' + e.message)
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 10 }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="知识点标题" />
          <button className="ghost" onClick={onClose}>
            关闭
          </button>
        </div>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="标签，逗号分隔"
          style={{ marginBottom: 10 }}
        />

        <div className="block-label">
          <span className="badge ok">笔记原文</span>
          <span className="muted">（AI 优化不会改动此部分）</span>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          style={{ minHeight: 180, marginBottom: 14 }}
        />

        <div className="block-label">
          <span className="badge fix">AI 补充与拓展</span>
          {kp.aiOptimizedAt && (
            <span className="muted">
              生成于 {new Date(kp.aiOptimizedAt).toLocaleString()}
            </span>
          )}
          <div className="spacer" />
          {ai && (
            <button
              className="mini danger"
              onClick={() => {
                if (confirm('清除 AI 补充内容？')) {
                  setAi('')
                  optimizeKP(kp.id, '')
                }
              }}
            >
              清除 AI 补充
            </button>
          )}
        </div>
        <textarea
          value={aiStream || ai}
          onChange={(e) => setAi(e.target.value)}
          placeholder="尚未 AI 优化。点击下方按钮，基于笔记原文生成补充与拓展。"
          style={{ minHeight: 140, marginBottom: 10 }}
        />

        <div className="row">
          <button className="primary" onClick={save}>
            保存修改
          </button>
          <button className="accent-2" onClick={runOptimize} disabled={aiBusy || !content.trim()}>
            {aiBusy ? '生成中…' : ai ? '重新生成 AI 补充' : 'AI 优化补充'}
          </button>
          {aiStream && aiStream !== ai && (
            <span className="streaming" style={{ alignSelf: 'center' }}>AI 流式输出中…</span>
          )}
        </div>
      </div>
    </div>
  )
}

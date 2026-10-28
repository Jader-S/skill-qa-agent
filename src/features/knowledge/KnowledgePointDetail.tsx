import { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore'
import { optimizeOne } from '../../lib/batchOptimize'
import type { KnowledgePoint } from '../../types'
import MarkdownView from './MarkdownView'

/**
 * 知识点详情：默认是一篇渲染后的文档。
 * 原文在前，AI 补充接在同一篇里，只用一行提示标出，不再分成上下两块。
 * 存储仍分开：AI 不改写原文。
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

  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(kp.title)
  const [tags, setTags] = useState(kp.tags.join(', '))
  const [content, setContent] = useState(kp.content)
  const [ai, setAi] = useState(kp.aiContent ?? '')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiStream, setAiStream] = useState('')

  useEffect(() => {
    setEditing(false)
    setTitle(kp.title)
    setTags(kp.tags.join(', '))
    setContent(kp.content)
    setAi(kp.aiContent ?? '')
    setAiStream('')
  }, [kp.id])

  const resetDraft = () => {
    setTitle(kp.title)
    setTags(kp.tags.join(', '))
    setContent(kp.content)
    setAi(kp.aiContent ?? '')
  }

  const save = () => {
    const nextContent = content.trim()
    const edited = kp.sourceType === 'ai' && nextContent !== kp.content.trim()
    const sourceName = edited
      ? `${(kp.sourceName ?? '').replace(/ · 已编辑$/, '')} · 已编辑`.replace(/^ · /, '')
      : kp.sourceName
    updateKP(kp.id, {
      title: title.trim() || kp.title,
      content: nextContent,
      tags: tags.split(/[,，\s]+/).filter(Boolean),
      ...(edited ? { sourceName } : {}),
    })
    const nextAi = ai.trim()
    if (nextAi !== (kp.aiContent ?? '').trim()) optimizeKP(kp.id, nextAi)
    setEditing(false)
  }

  const runOptimize = async () => {
    setAiBusy(true)
    setAiStream('')
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

  const aiText = aiStream || ai
  const showAi = editing || !!aiText

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal modal-doc" onClick={(e) => e.stopPropagation()}>
        <header className="doc-head">
          <div className="doc-head-main">
            {editing ? (
              <>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="知识点标题" />
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="标签，逗号分隔"
                  style={{ marginTop: 8 }}
                />
              </>
            ) : (
              <>
                <h2 className="doc-title">{kp.title}</h2>
                {kp.tags.length > 0 && (
                  <div className="doc-tags">
                    {kp.tags.map((t) => (
                      <span key={t} className="tag">#{t}</span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <button className="ghost" onClick={onClose}>关闭</button>
        </header>

        <div className="doc-body">
          {editing ? (
            <textarea
              className="doc-source"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          ) : (
            <MarkdownView text={content} />
          )}

          {showAi && (
            <div className="md-ai">
              <div className="md-ai-mark">
                AI 补充
                {kp.aiOptimizedAt && !aiStream && (
                  <span className="muted">{new Date(kp.aiOptimizedAt).toLocaleString()}</span>
                )}
              </div>
              {editing ? (
                <textarea
                  className="doc-source doc-source-ai"
                  value={aiText}
                  onChange={(e) => setAi(e.target.value)}
                  placeholder="生成后会接在原文后面。也可以直接在这里写。"
                />
              ) : (
                <MarkdownView text={aiText} />
              )}
            </div>
          )}
        </div>

        <footer className="doc-foot">
          {editing ? (
            <>
              <button className="primary" onClick={save}>保存</button>
              <button
                className="ghost"
                onClick={() => {
                  resetDraft()
                  setEditing(false)
                }}
              >
                取消
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)}>编辑</button>
          )}
          <button className="accent-2" onClick={runOptimize} disabled={aiBusy || !content.trim()}>
            {aiBusy ? '生成中…' : ai ? '重新生成 AI 补充' : 'AI 补充'}
          </button>
          {ai && (
            <button
              className="mini danger"
              onClick={() => {
                if (confirm('清除 AI 补充？原文会保留。')) {
                  setAi('')
                  optimizeKP(kp.id, '')
                }
              }}
            >
              清除 AI 补充
            </button>
          )}
          {aiBusy && <span className="muted">正在写入本文档…</span>}
        </footer>
      </div>
    </div>
  )
}

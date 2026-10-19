import type { Course, KnowledgePoint } from '../types'

export function courseToMarkdown(course: Course, kps: KnowledgePoint[]): string {
  const head = `# ${course.name}\n\n> 由「技能问答 Agent」导出\n\n`
  const body = kps
    .map((k) => {
      const tags = k.tags?.length ? '\n' + k.tags.map((t) => `#${t}`).join(' ') + '\n' : ''
      return `## ${k.title}${tags}\n${k.content}\n`
    })
    .join('\n---\n\n')
  return head + body
}

/**
 * 导出为 Markdown。Web 环境走浏览器下载；
 * Tauri 环境可替换为 invoke('write_markdown', {path, content}) 直接写入 Obsidian vault。
 */
export function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

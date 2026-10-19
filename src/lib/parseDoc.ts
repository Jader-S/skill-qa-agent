import type { ParsedKP } from './parseMd'
import { parseMarkdownToKPs } from './parseMd.ts'

export type DocFormat = 'md' | 'txt' | 'json' | 'docx' | 'pptx' | 'pdf'

export function detectFormat(filename: string): DocFormat {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'md':
    case 'markdown':
      return 'md'
    case 'txt':
      return 'txt'
    case 'json':
      return 'json'
    case 'docx':
      return 'docx'
    case 'pptx':
      return 'pptx'
    case 'pdf':
      return 'pdf'
    default:
      return 'txt'
  }
}

/**
 * 把任意支持格式的文件解析为知识点数组：
 * - md：按 H1 拆分（parseMarkdownToKPs）
 * - txt/json：原逻辑
 * - docx/pptx/pdf：抽取纯文本后按标题启发式切分（splitProseToKPs）/ 按幻灯片切分
 */
export async function parseDocToKPs(file: File, fallbackTitle: string): Promise<ParsedKP[]> {
  const fmt = detectFormat(file.name)
  if (fmt === 'md') {
    const text = await file.text()
    return parseMarkdownToKPs(text, fallbackTitle)
  }
  if (fmt === 'txt') {
    const text = await file.text()
    return [{ title: fallbackTitle, content: text.trim(), tags: [] }]
  }
  if (fmt === 'json') {
    const text = await file.text()
    try {
      const data = JSON.parse(text)
      const arr = Array.isArray(data) ? data : [data]
      return arr
        .map((d: any) => ({
          title: d.title ?? fallbackTitle,
          content: d.content ?? '',
          tags: d.tags ?? [],
        }))
        .filter((k: ParsedKP) => k.content.trim().length > 0)
    } catch {
      return []
    }
  }
  const buf = await file.arrayBuffer()
  if (fmt === 'docx') return splitProseToKPs(await docxToText(buf), fallbackTitle)
  if (fmt === 'pptx') return pptxToKPs(buf, fallbackTitle)
  if (fmt === 'pdf') return splitProseToKPs(await pdfToText(buf), fallbackTitle)
  return []
}

/** docx → 纯文本（mammoth，保留段落）。浏览器走 arrayBuffer，Node 走 Buffer，双端兼容。 */
async function docxToText(buf: ArrayBuffer): Promise<string> {
  const mammoth = await import('mammoth')
  const opts: any = {}
  if (typeof (globalThis as any).Buffer !== 'undefined') {
    opts.buffer = (globalThis as any).Buffer.from(buf)
  } else {
    opts.arrayBuffer = buf
  }
  const { value } = await mammoth.extractRawText(opts)
  return value
}

/** pptx → 按幻灯片切分，每页一个候选知识点。 */
async function pptxToKPs(buf: ArrayBuffer, fallbackTitle: string): Promise<ParsedKP[]> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buf)
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
      const nb = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
      return na - nb
    })
  const out: ParsedKP[] = []
  for (const f of slideFiles) {
    const xml = await zip.file(f)!.async('string')
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((m) => m[1].trim())
      .filter(Boolean)
    const slideText = texts.join('\n')
    if (!slideText) continue
    const first = texts[0] ?? ''
    const title = first.length > 0 && first.length <= 30 ? first : `${fallbackTitle} · 幻灯片${out.length + 1}`
    out.push({ title, content: slideText, tags: [] })
  }
  return out.filter((k) => k.content.length > 0)
}

/** pdf → 纯文本（pdfjs，浏览器用 ?url worker；Node 测试不触发此分支）。 */
async function pdfToText(buf: ArrayBuffer): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist')
  const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc
  const doc = await pdfjsLib.getDocument({ data: buf }).promise
  let text = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    const pageText = tc.items.map((it: any) => ('text' in it ? it.text : '')).join(' ')
    text += pageText + '\n'
  }
  return text
}

function looksLikeHeading(line: string, next: string): boolean {
  if (line.length === 0 || line.length > 40) return false
  if (/[。．.，,！？!?；;：:]$/.test(line)) return false // 以句末标点结尾 → 非标题
  if (/^#{1,6}\s/.test(line)) return true
  if (/^[0-9]+[.、)）]/.test(line)) return true
  if (/^[一二三四五六七八九十百千]+[.、)）、]/.test(line)) return true
  if (/^[A-Z][A-Z\s]{3,}$/.test(line)) return true // 全大写英文标题
  if (next.length > line.length) return true // 短行后跟长行 → 倾向标题
  return false
}

/**
 * 通用散文切分：把纯文本按「标题行」切成多个知识点。
 * 标题启发式：不长(≤40)、不以句末标点结尾、且符合 Markdown 标题/编号/全大写，或后跟更长行。
 * 无标题时整篇兜底为一条。
 */
export function splitProseToKPs(text: string, fallbackTitle: string): ParsedKP[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const sections: { title: string; content: string[] }[] = []
  let cur: { title: string; content: string[] } | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const next = lines[i + 1] ?? ''
    if (looksLikeHeading(line, next)) {
      if (cur) sections.push(cur)
      cur = { title: line.replace(/^#+\s*/, ''), content: [] }
    } else {
      if (!cur) cur = { title: fallbackTitle, content: [] }
      cur.content.push(line)
    }
  }
  if (cur) sections.push(cur)
  const out = sections
    .map((s) => ({ title: s.title, content: s.content.join('\n').trim(), tags: [] as string[] }))
    .filter((s) => s.content.length > 0)
  if (out.length === 0) return [{ title: fallbackTitle, content: text.trim(), tags: [] }]
  return out
}

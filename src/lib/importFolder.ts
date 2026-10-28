import type { Course, KnowledgePoint } from '../types'
import { parseDocToKPs, detectFormat } from './parseDoc.ts'
import { parseMarkdownOutline, type OutlineSection } from './parseMd.ts'

/** 简单稳定哈希：把路径映射成确定 id，保证重复导入幂等（覆盖而非翻倍）。 */
function hash(str: string): string {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/**
 * 文件夹导入只接受这些扩展名。任何其它文件（源码、图片、配置、二进制）
 * 一律忽略，避免把项目文件解析成垃圾知识点。
 */
const ALLOWED_EXT = new Set(['md', 'markdown', 'txt', 'json', 'docx', 'pptx', 'pdf'])

/**
 * 这些目录名及其子树直接跳过：依赖目录、构建产物、VCS、编辑器/笔记软件配置等。
 * 命中任一路径段即忽略（例如 node_modules/、.git/、dist/、.obsidian/）。
 */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.vite',
  'dist',
  'build',
  'out',
  'coverage',
  '.idea',
  '.cache',
  'target',
  '__pycache__',
  '.next',
  '.nuxt',
  '.output',
  'vendor',
  'bin',
  'obj',
  '.obsidian',
  '.trash',
  '.config',
])

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

/** 路径段是否命中忽略目录，或文件名是点文件（.DS_Store / .gitignore 等噪声）。 */
function isIgnoredPath(rel: string): boolean {
  const segs = rel.split('/')
  for (const s of segs) {
    if (IGNORED_DIRS.has(s)) return true
    if (s.startsWith('.')) return true
  }
  return false
}

export type FolderImportStats = {
  courseCount: number // 目录 → 课程数（仅含可解析文件的目录）
  kpCount: number // 知识点总数
  fileCount: number // 成功解析的文件数
  skipped: number // 被忽略（扩展名/目录/点文件）或解析产出为空的文件数
}

export type FolderImportPlan = {
  courses: Course[]
  kps: KnowledgePoint[]
  stats: FolderImportStats
  rootCourseId: string // 顶层文件夹对应的课程 id（用于决定是否挂载到当前课程下）
}

/** 概述类文件：同目录还有其它资料时，正文留在当前目录，不单独拆成一章。 */
const INTRO_LABELS = new Set(['readme', 'index', '目录', '概述', '简介', '说明'])

type ParsedFile = {
  rel: string
  dir: string
  label: string
  tags: string[]
  sections: OutlineSection[]
  format: ReturnType<typeof detectFormat>
}

/**
 * 把浏览器选择的文件夹（files 含 webkitRelativePath）构建为导入计划：
 * - 仅接受白名单扩展名，并跳过依赖/构建/VCS/配置目录与点文件。
 * - 物理目录 → 课程树（顶层文件夹 = 根课程，子文件夹 = 子课程）。
 * - 同一目录下的多个文件按关联再拆章节，并可嵌套：
 *   文件名共同前缀（分隔符或中英文边界）归到同一父章节；否则用能区分文件的共同标签；
 *   对不上的文件各自成章。Markdown 里「还有子标题」的标题继续向下嵌套，叶子仍是知识点。
 * - 目录里只有一个文件时，不再套一层与文件同名的目录；README 等概述留在当前目录。
 * - 所有 id 由路径哈希确定，重复导入幂等。
 *
 * @param parentId 顶层课程挂载的父课程（null = 顶级）。构建后 UI 可再覆写。
 */
export async function buildFolderImport(
  files: File[],
  parentId: string | null = null,
): Promise<FolderImportPlan> {
  const now = Date.now()
  const total = files.length

  // 1) 过滤：只保留白名单扩展名 + 非忽略路径的文件
  const keep: File[] = []
  for (const f of files) {
    const rel = (f as any).webkitRelativePath || f.name
    if (isIgnoredPath(rel)) continue
    if (!ALLOWED_EXT.has(extOf(f.name))) continue
    keep.push(f)
  }
  const skippedByFilter = total - keep.length

  // 2) 收集实际含可解析文件的目录路径（含顶层文件夹），用于建课程树
  const dirPaths = new Set<string>()
  for (const f of keep) {
    const rel = (f as any).webkitRelativePath || f.name
    const parts = rel.split('/')
    for (let i = 1; i < parts.length; i++) dirPaths.add(parts.slice(0, i).join('/'))
  }

  // 3) 建课程：每个有效目录一个，parent 链按路径前缀推导
  const courseMap = new Map<string, string>() // dirPath -> courseId
  const courses: Course[] = []
  let sort = 0
  for (const d of [...dirPaths].sort()) {
    const lastSep = d.lastIndexOf('/')
    const parentDir = lastSep === -1 ? null : d.slice(0, lastSep)
    const id = 'fd:' + hash(d)
    courseMap.set(d, id)
    courses.push({
      id,
      name: d.slice(lastSep + 1),
      parentId: parentDir === null ? parentId : courseMap.get(parentDir)!,
      sort: sort++,
      createdAt: now,
    })
  }

  // 4) 解析文件。章节在全部文件解析完后按目录统一拆，才能看到同级文件的关联。
  const parsedFiles: ParsedFile[] = []
  let fileCount = 0
  let skipped = skippedByFilter

  for (const f of keep) {
    const rel = (f as any).webkitRelativePath || f.name
    const parts = rel.split('/')
    const dir = parts.slice(0, parts.length - 1).join('/')
    if (!courseMap.has(dir)) continue
    const label = labelOf(f.name)
    try {
      const sections = await sectionsOf(f, label)
      if (sections.length === 0) {
        skipped++
        continue
      }
      const tags: string[] = []
      for (const s of sections) {
        for (const t of s.tags) if (!tags.includes(t)) tags.push(t)
      }
      parsedFiles.push({ rel, dir, label, tags, sections, format: detectFormat(f.name) })
      fileCount++
    } catch {
      skipped++
    }
  }

  // 5) 按目录拆章节，知识点挂到最深的那一层
  const kps: KnowledgePoint[] = []
  const chapterIds = new Map<string, string>() // dir + '//' + 章节路径 -> courseId
  const byDir = new Map<string, ParsedFile[]>()
  for (const pf of parsedFiles) {
    const list = byDir.get(pf.dir) ?? []
    list.push(pf)
    byDir.set(pf.dir, list)
  }

  const ensureChapter = (dir: string, segments: string[]): string => {
    let parent = courseMap.get(dir)!
    const acc: string[] = []
    for (const seg of segments) {
      acc.push(seg)
      const key = dir + '//' + acc.join('/')
      let id = chapterIds.get(key)
      if (!id) {
        id = 'fd:' + hash(key)
        chapterIds.set(key, id)
        courses.push({
          id,
          name: seg,
          parentId: parent,
          sort: sort++,
          createdAt: now,
        })
      }
      parent = id
    }
    return parent
  }

  for (const [dir, group] of byDir) {
    const dirBase = dir.slice(dir.lastIndexOf('/') + 1)
    const groups = assignGroups(group)
    group.forEach((pf, fileIndex) => {
      const intro = isIntroFile(pf.label) && group.length > 1
      pf.sections.forEach((section, i) => {
        const segments = intro
          ? dedupe(section.chapters)
          : dedupe([
              ...(!groups[fileIndex] || groups[fileIndex] === dirBase ? [] : [groups[fileIndex]!]),
              ...(fileSegment(pf.label, groups[fileIndex], group.length) ?? []),
              ...section.chapters,
            ])
        const courseId = segments.length ? ensureChapter(dir, segments) : courseMap.get(dir)!
        kps.push({
          id: 'kp:' + hash(pf.rel + '#' + i),
          courseId,
          title: section.title,
          content: section.content,
          tags: section.tags,
          sourceType: pf.format,
          sourceName: pf.rel,
          createdAt: now,
          updatedAt: now,
        })
      })
    })
  }

  const rootRel = keep[0] ? ((keep[0] as any).webkitRelativePath || keep[0].name).split('/')[0] : ''
  const rootCourseId = 'fd:' + hash(rootRel)

  return {
    courses,
    kps,
    stats: { courseCount: courses.length, kpCount: kps.length, fileCount, skipped },
    rootCourseId,
  }
}

async function sectionsOf(f: File, label: string): Promise<OutlineSection[]> {
  if (detectFormat(f.name) === 'md') {
    return parseMarkdownOutline(await f.text(), label)
  }
  const fallbackTitle = f.name.replace(/\.\w+$/, '')
  const parsed = await parseDocToKPs(f, fallbackTitle)
  return parsed.map((k) => ({ ...k, chapters: [] }))
}

/** 去掉扩展名和开头的序号（01-、1.、第1章）。 */
function labelOf(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '')
  const stripped = base
    .replace(/^(?:第\s*[0-9一二三四五六七八九十百]+\s*[章节课讲篇.]?\s*|[0-9]{1,3})\s*[.、\-_:：\s]+/, '')
    .trim()
  return stripped || base
}

function isIntroFile(label: string): boolean {
  return INTRO_LABELS.has(label.trim().toLowerCase())
}

function dedupe(segs: string[]): string[] {
  const out: string[] = []
  for (const s of segs) {
    const t = s.trim()
    if (!t) continue
    if (out.length && out[out.length - 1] === t) continue
    out.push(t)
  }
  return out
}

/**
 * 文件在父章节下的那一层目录名。
 * 返回空数组表示知识点直接挂在分组（或物理目录）上，不再多套一层。
 */
function fileSegment(label: string, groupKey: string | null, siblingCount: number): string[] {
  if (siblingCount <= 1 && !groupKey) return []
  if (groupKey) {
    if (label === groupKey) return []
    if (label.startsWith(groupKey)) {
      const rest = label.slice(groupKey.length).replace(/^[\s\-_.·•:：、/／]+/, '').trim()
      return rest ? [rest] : []
    }
    return [label]
  }
  return siblingCount > 1 ? [label] : []
}

/** 同一目录内：文件名关联优先，其次用能把文件分开的共同标签。 */
function assignGroups(files: ParsedFile[]): (string | null)[] {
  const nameKeys = nameCluster(files.map((f) => f.label))
  const tagKeys: (string | null)[] = files.map(() => null)
  const pending = files.map((_, i) => i).filter((i) => !nameKeys[i])
  if (pending.length >= 2) {
    const assigned = tagCluster(pending.map((i) => files[i].tags))
    pending.forEach((i, j) => {
      tagKeys[i] = assigned[j]
    })
  }
  return files.map((_, i) => nameKeys[i] ?? tagKeys[i])
}

function nameCluster(labels: string[]): (string | null)[] {
  const options = labels.map((label) => {
    const set = new Set<string>()
    for (const other of labels) {
      const p = goodLcp(label, other)
      if (p) set.add(p)
    }
    return [...set].sort((a, b) => b.length - a.length)
  })
  const claimCount = new Map<string, number>()
  for (const opts of options) {
    for (const p of opts) claimCount.set(p, (claimCount.get(p) ?? 0) + 1)
  }
  return options.map((opts) => opts.find((p) => (claimCount.get(p) ?? 0) >= 2) ?? null)
}

/** 最长公共前缀，且切在分隔符或中英文交界上，避免把 CSS / CSV 收成同一章。 */
function goodLcp(a: string, b: string): string {
  if (a === b) return ''
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i++
  for (let len = i; len >= 2; len--) {
    const p = a.slice(0, len).replace(/[\s\-_.·•:：、/／]+$/g, '')
    if (p.length < 2) continue
    if (isGoodCut(a, p.length) && isGoodCut(b, p.length) && a.startsWith(p) && b.startsWith(p)) return p
  }
  return ''
}

function isGoodCut(label: string, prefixLen: number): boolean {
  if (prefixLen <= 0 || prefixLen > label.length) return false
  if (prefixLen === label.length) return true
  const prev = label[prefixLen - 1]
  const next = label[prefixLen]
  if (/[\s\-_.·•:：、/／]/.test(next)) return true
  const prevAscii = /[A-Za-z0-9]/.test(prev)
  const nextAscii = /[A-Za-z0-9]/.test(next)
  return prevAscii !== nextAscii
}

function tagCluster(tagLists: string[][]): (string | null)[] {
  const n = tagLists.length
  const counts = new Map<string, number>()
  for (const tags of tagLists) {
    for (const t of new Set(tags)) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return tagLists.map((tags) => {
    let best: string | null = null
    let bestSize = Infinity
    for (const t of tags) {
      const c = counts.get(t) ?? 0
      if (c >= 2 && c < n && c < bestSize) {
        best = t
        bestSize = c
      }
    }
    return best
  })
}

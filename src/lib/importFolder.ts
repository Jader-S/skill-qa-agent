import type { Course, KnowledgePoint } from '../types'
import { parseDocToKPs, detectFormat } from './parseDoc.ts'

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

/**
 * 把浏览器选择的文件夹（files 含 webkitRelativePath）构建为导入计划：
 * - 仅接受白名单扩展名，并跳过依赖/构建/VCS/配置目录与点文件。
 * - 目录结构 → 课程树（顶层文件夹 = 根课程，子文件夹 = 子课程），
 *   但只对「实际含可解析文件」的目录建课程，避免垃圾课程。
 * - 每个 md 按标题拆知识点；txt 整篇一条；json 按数组拆；docx/pptx/pdf 抽文本后启发式切分。
 * - 所有 id 由相对路径哈希确定，重复导入幂等。
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

  // 4) 建知识点：逐文件解析后挂到所在目录的课程
  const kps: KnowledgePoint[] = []
  let fileCount = 0
  let skipped = skippedByFilter

  for (const f of keep) {
    const rel = (f as any).webkitRelativePath || f.name
    const parts = rel.split('/')
    const dir = parts.slice(0, parts.length - 1).join('/')
    const courseId = courseMap.get(dir)
    if (!courseId) continue // 理论上不会触发（dir 必在 dirPaths 中）

    const fallbackTitle = f.name.replace(/\.\w+$/, '')
    try {
      const parsed = await parseDocToKPs(f, fallbackTitle)
      if (parsed.length === 0) {
        skipped++
        continue
      }
      const fmt = detectFormat(f.name)
      parsed.forEach((k, i) => {
        kps.push({
          id: 'kp:' + hash(rel + '#' + i),
          courseId,
          title: k.title,
          content: k.content,
          tags: k.tags,
          sourceType: fmt,
          sourceName: rel,
          createdAt: now,
          updatedAt: now,
        })
      })
      fileCount++
    } catch {
      skipped++
    }
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

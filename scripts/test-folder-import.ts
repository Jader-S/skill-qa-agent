import { buildFolderImport, type FolderImportPlan } from '../src/lib/importFolder.ts'
import type { Course } from '../src/types.ts'

function fakeFile(relPath: string, text: string): any {
  return {
    name: relPath.split('/').pop()!,
    webkitRelativePath: relPath,
    text: async () => text,
  }
}

const htmlMd = `# HTML 基础
HTML 是网页的结构语言。

# HTML 表单
表单用于收集用户输入。
`

const cssMd = `---
title: CSS 速览
tags: [css, style]
---
# CSS 选择器
用于选中元素。

# CSS 盒模型
每个元素都是一个盒子。
`

const closureMd = `# 闭包
闭包是函数与其词法环境的组合。
`

const readme = `这是课程说明，没有标题层级。`

const files = [
  fakeFile('课件/前端基础/HTML.md', htmlMd),
  fakeFile('课件/前端基础/CSS.md', cssMd),
  fakeFile('课件/JS/闭包.md', closureMd),
  fakeFile('课件/README.txt', readme),
  fakeFile('课件/封面.png', 'binary...'), // 应被跳过
]

const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exit(1)
  }
}

function courseByPath(courses: Course[], names: string[]): Course {
  let parentId: string | null = null
  let found: Course | undefined
  for (const name of names) {
    found = courses.find((c) => c.name === name && c.parentId === parentId)
    if (!found) {
      console.error('missing path', names.join(' / '), 'at', name)
      process.exit(1)
    }
    parentId = found.id
  }
  return found!
}

function dump(plan: FolderImportPlan) {
  const byParent = new Map<string | null, Course[]>()
  for (const c of [...plan.courses].sort((a, b) => a.sort - b.sort)) {
    const list = byParent.get(c.parentId) ?? []
    list.push(c)
    byParent.set(c.parentId, list)
  }
  const walk = (pid: string | null, depth: number) => {
    for (const c of byParent.get(pid) ?? []) {
      const n = plan.kps.filter((k) => k.courseId === c.id).length
      console.log(`${'  '.repeat(depth)}${c.name}  (${n})`)
      walk(c.id, depth + 1)
    }
  }
  walk(null, 0)
}

const plan = await buildFolderImport(files, null)

console.log('courseCount =', plan.stats.courseCount)
console.log('kpCount =', plan.stats.kpCount)
console.log('fileCount =', plan.stats.fileCount)
console.log('skipped =', plan.stats.skipped)
dump(plan)

assert(plan.stats.courseCount === 5, '应有 5 个目录（课件/前端基础/HTML/CSS/JS）')
assert(plan.stats.fileCount === 4, '应解析 4 个文件')
assert(plan.stats.skipped === 1, '应跳过 1 个 png')
assert(plan.stats.kpCount === 6, '知识点：HTML(2)+CSS(2)+JS(1)+txt(1)=6')

const htmlCourse = courseByPath(plan.courses, ['课件', '前端基础', 'HTML'])
const cssCourse = courseByPath(plan.courses, ['课件', '前端基础', 'CSS'])
const jsCourse = courseByPath(plan.courses, ['课件', 'JS'])
const rootCourse = courseByPath(plan.courses, ['课件'])
const frontCourse = courseByPath(plan.courses, ['课件', '前端基础'])

assert(plan.kps.filter((k) => k.courseId === htmlCourse.id).map((k) => k.title).sort().join(',') === 'HTML 基础,HTML 表单', 'HTML.md 的知识点应挂在 HTML 章节')
assert(plan.kps.filter((k) => k.courseId === cssCourse.id).length === 2, 'CSS.md 的知识点应挂在 CSS 章节')
assert(plan.kps.every((k) => k.courseId !== frontCourse.id), '前端基础 目录本身不应再堆放两个文件的知识点')
const closureKp = plan.kps.find((k) => k.title === '闭包')
assert(!!closureKp && closureKp.courseId === jsCourse.id, '目录里只有一个文件时，闭包仍挂在 JS 下')
const readmeKp = plan.kps.find((k) => k.title === 'README')
assert(readmeKp?.courseId === rootCourse.id, 'README.txt 应挂在课件根课程下')

const plan2 = await buildFolderImport(files, null)
assert(plan2.rootCourseId === plan.rootCourseId, '重复导入根课程 id 应稳定（幂等）')
assert(
  plan2.courses.map((c) => c.id).sort().join() === plan.courses.map((c) => c.id).sort().join(),
  '重复导入章节 id 应稳定',
)

// 同一目录多个文件：共同前缀嵌套，其余各自成章
const prefixed = await buildFolderImport([
  fakeFile('专题/闭包-定义.md', '# 定义\n闭包的定义。\n'),
  fakeFile('专题/闭包-应用.md', '# 应用\n闭包的应用。\n'),
  fakeFile('专题/原型.md', '# 原型链\n原型链用于继承。\n'),
], null)
console.log('\n=== 文件名前缀 ===')
dump(prefixed)
assert(!!courseByPath(prefixed.courses, ['专题', '闭包', '定义']), '闭包-定义 应嵌套在 闭包 下')
assert(!!courseByPath(prefixed.courses, ['专题', '闭包', '应用']), '闭包-应用 应嵌套在 闭包 下')
assert(!!courseByPath(prefixed.courses, ['专题', '原型']), '原型 与闭包无共同前缀，应与闭包同级')
const defKp = prefixed.kps.find((k) => k.title === '定义')
assert(defKp?.courseId === courseByPath(prefixed.courses, ['专题', '闭包', '定义']).id, '定义 知识点挂在对应章节')

// 标签把没有共同文件名的文件收成一章
const tagged = await buildFolderImport([
  fakeFile('笔记/定义.md', '---\ntags: [闭包]\n---\n# 定义\n定义内容。\n'),
  fakeFile('笔记/应用.md', '---\ntags: [闭包]\n---\n# 应用\n应用内容。\n'),
  fakeFile('笔记/选择器.md', '---\ntags: [css]\n---\n# 选择器\n选择器内容。\n'),
], null)
console.log('\n=== 标签关联 ===')
dump(tagged)
assert(!!courseByPath(tagged.courses, ['笔记', '闭包', '定义']), '同标签文件应归到标签章节下')
assert(!!courseByPath(tagged.courses, ['笔记', '闭包', '应用']), '应用 同样归到闭包')
assert(!!courseByPath(tagged.courses, ['笔记', '选择器']), '不同标签的文件单独成章')

// 文内多级标题 → 嵌套目录，叶子仍是知识点
const nestedMd = `# 变量
## 命名
### 风格
使用蛇形命名。
### 关键字
不能使用保留字。
## 赋值
使用等号。
# 函数
## 参数
参数按位置传递。
`
const nested = await buildFolderImport([fakeFile('课程/语言/Python.md', nestedMd)], null)
console.log('\n=== 标题嵌套 ===')
dump(nested)
assert(!!courseByPath(nested.courses, ['课程', '语言', '变量', '命名']), '有子标题的标题应成为嵌套目录')
assert(!!courseByPath(nested.courses, ['课程', '语言', '函数']), '函数 应是语言下的章节')
const styleKp = nested.kps.find((k) => k.title === '风格')
assert(styleKp?.courseId === courseByPath(nested.courses, ['课程', '语言', '变量', '命名']).id, '叶子知识点挂在最深章节')
const assignKp = nested.kps.find((k) => k.title === '赋值')
assert(assignKp?.courseId === courseByPath(nested.courses, ['课程', '语言', '变量']).id, '没有子标题的小节仍是知识点，不单独建目录')
assert(!nested.courses.some((c) => c.name === 'Python'), '目录里只有一个文件时，不再套一层与文件同名的目录')

// 同目录还有其它文件时，README 留在当前目录
const withReadme = await buildFolderImport([
  fakeFile('资料/README.md', '# 课程说明\n这是说明。\n'),
  fakeFile('资料/HTML.md', '# HTML\n结构。\n'),
], null)
console.log('\n=== README 留在当前目录 ===')
dump(withReadme)
const intro = withReadme.kps.find((k) => k.title === '课程说明')
assert(intro?.courseId === courseByPath(withReadme.courses, ['资料']).id, 'README 应挂在资料目录，不单独成章')
assert(!!courseByPath(withReadme.courses, ['资料', 'HTML']), '其它文件仍拆成章节')

console.log('\nALL OK')

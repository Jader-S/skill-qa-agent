import { buildFolderImport } from '../src/lib/importFolder.ts'

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

const plan = await buildFolderImport(files, null)

console.log('courseCount =', plan.stats.courseCount)
console.log('kpCount =', plan.stats.kpCount)
console.log('fileCount =', plan.stats.fileCount)
console.log('skipped =', plan.stats.skipped)
console.log('courseNames =', plan.courses.map((c) => `${c.parentId ? '  ' : ''}${c.name}`).join('\n'))
console.log('rootCourseId =', plan.rootCourseId, '(expect fd:' + 'x'.repeat(0) + ')')

// 断言
const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exit(1)
  }
}

assert(plan.stats.courseCount === 3, '应有 3 门课程（课件/前端基础/JS）')
assert(plan.stats.fileCount === 4, '应解析 4 个文件')
assert(plan.stats.skipped === 1, '应跳过 1 个 png')
assert(plan.stats.kpCount === 6, '知识点：HTML(2)+CSS(2)+JS(1)+txt(1)=6')
const closureKp = plan.kps.find((k) => k.title === '闭包')
assert(!!closureKp && closureKp.courseId === plan.courses.find((c) => c.name === 'JS')!.id, '闭包应挂在 JS 课程下')
const cssCourse = plan.courses.find((c) => c.name === '前端基础')!
const jsCourse = plan.courses.find((c) => c.name === 'JS')!
assert(cssCourse.parentId === plan.courses.find((c) => c.name === '课件')!.id, '前端基础 应挂课件下')
assert(jsCourse.parentId === plan.courses.find((c) => c.name === '课件')!.id, 'JS 应挂课件下')
const readmeKp = plan.kps.find((k) => k.title === 'README')
assert(readmeKp?.courseId === plan.courses.find((c) => c.name === '课件')!.id, 'README.txt 应挂在课件根课程下')
// 幂等：相同输入 id 稳定
const plan2 = await buildFolderImport(files, null)
assert(plan2.rootCourseId === plan.rootCourseId, '重复导入 id 应稳定（幂等）')

console.log('\nALL OK')

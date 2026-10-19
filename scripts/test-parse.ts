import { parseMarkdownToKPs } from '../src/lib/parseMd.ts'

const sample = `---
title: 我的课件
tags: [前端, 基础]
---

# 第一章 闭包
闭包是函数与其词法作用域的组合。

## 子节
细节说明。

# 第二章 原型链
原型链用于实现继承。
`

const r = parseMarkdownToKPs(sample, 'fallback')
console.log('=== 含 frontmatter + 多 H1 ===')
console.log('count:', r.length)
r.forEach((k, i) =>
  console.log(`  [${i}] title=${k.title} tags=${JSON.stringify(k.tags)} contentLen=${k.content.length}`),
)

const noH1 = parseMarkdownToKPs('只是纯文本，没有任何标题。', '文件名兜底')
console.log('\n=== 无 H1（整篇一条） ===')
console.log('count:', noH1.length, 'title:', noH1[0].title)

const pre = parseMarkdownToKPs('导语段落在标题之前。\n\n# 唯一章节\n正文。', 'fb')
console.log('\n=== H1 前有导语 ===')
console.log('count:', pre.length, 'firstContentStart:', pre[0].content.slice(0, 12))

const empty = parseMarkdownToKPs('# 空章节\n\n# 有内容章节\n这是内容。', 'fb')
console.log('\n=== 空章节应被过滤 ===')
console.log('count:', empty.length, 'titles:', empty.map((e) => e.title).join(','))

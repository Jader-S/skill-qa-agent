import JSZip from 'jszip'
import { LexicalRetriever } from '../src/lib/retrieval.ts'
import { splitProseToKPs, parseDocToKPs } from '../src/lib/parseDoc.ts'
import type { KnowledgePoint } from '../src/types.ts'

let failures = 0
const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error('FAIL:', msg)
    failures++
  } else {
    console.log('ok  :', msg)
  }
}

// ---------- 1. 检索相关性 ----------
const kps: KnowledgePoint[] = [
  { id: '1', courseId: 'c', title: 'React 合成事件', content: 'React 使用合成事件机制，将事件委托到根节点统一处理，提升性能。', tags: [], sourceType: 'manual', createdAt: 0, updatedAt: 0 },
  { id: '2', courseId: 'c', title: 'CSS 盒模型', content: '盒模型包含 content、padding、border、margin 四个部分。', tags: [], sourceType: 'manual', createdAt: 0, updatedAt: 0 },
  { id: '3', courseId: 'c', title: '数据库索引', content: 'B+ 树索引加速查询，降低磁盘 IO。', tags: [], sourceType: 'manual', createdAt: 0, updatedAt: 0 },
]
const r = new LexicalRetriever()
const res = r.retrieve('React 的事件机制是怎么做的', kps, 3)
assert(res.length > 0 && res[0].kpId === '1', '检索：React 事件查询应命中「React 合成事件」排第一')
assert(r.retrieve('完全无关词汇xyz', kps, 3).length >= 0, '检索：无关查询不报错')

// ---------- 2. 散文切分 ----------
const prose = `1. 引言
这是引言段落的内容，讲解背景。
2. 核心概念
盒模型包含 content、padding、border、margin 四个部分。
3. 小结
本文介绍了基础。`
const sp = splitProseToKPs(prose, '兜底')
assert(sp.length === 3, `散文切分：应切成 3 块（实际 ${sp.length}）`)
assert(sp[0].title === '1. 引言' && sp[0].content.includes('背景'), '散文切分：标题与内容正确')
const noHeading = splitProseToKPs('只有一段没有任何标题的文字内容。', '兜底标题')
assert(noHeading.length === 1 && noHeading[0].title === '兜底标题', '散文切分：无标题时整篇兜底')

// ---------- 3. docx 解析（JSZip 造最小样本） ----------
async function makeDocx(text: string): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:body></w:document>`,
  )
  return zip.generateAsync({ type: 'uint8array' })
}
const docxBytes = await makeDocx('React 合成事件机制：事件委托到根节点。')
const docxAb = docxBytes.buffer.slice(docxBytes.byteOffset, docxBytes.byteOffset + docxBytes.byteLength)
const docxFile = { name: 'note.docx', arrayBuffer: async () => docxAb } as any
const docxKps = await parseDocToKPs(docxFile, 'note')
assert(docxKps.length >= 1 && docxKps[0].content.includes('事件委托'), 'docx 解析：能抽取文本并产出知识点')

// ---------- 4. pptx 解析（JSZip 造最小样本） ----------
async function makePptx(slides: string[]): Promise<Uint8Array> {
  const zip = new JSZip()
  slides.forEach((s, i) => {
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<?xml version="1.0"?><p:sld xmlns:p="x" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:sp><p:txBody><a:p><a:r><a:t>${s}</a:t></a:r></a:p></p:txBody></p:sp></p:sld>`,
    )
  })
  return zip.generateAsync({ type: 'uint8array' })
}
const pptxBytes = await makePptx(['CSS 盒模型概述', '盒模型包含 content、padding、border、margin。'])
const pptxFile = { name: 'deck.pptx', arrayBuffer: async () => pptxBytes } as any
const pptxKps = await parseDocToKPs(pptxFile, 'deck')
assert(pptxKps.length === 2, `pptx 解析：应切 2 张幻灯片为 2 个知识点（实际 ${pptxKps.length}）`)
assert(pptxKps[1].content.includes('margin'), 'pptx 解析：第二页文本抽取正确')

if (failures === 0) console.log('\nALL PHASE2 UNIT TESTS OK')
else {
  console.error(`\n${failures} 个断言失败`)
  process.exit(1)
}

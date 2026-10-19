// 端到端探针：复刻应用的 出题 → 评分 真实流程（同 prompts.ts + parse.ts），用真实 Key 跑。
const KEY = process.env.DS_KEY
const base = 'https://api.deepseek.com/v1'

async function streamChat(system, user) {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: true,
      temperature: 0.3,
    }),
  })
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let out = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const d = t.slice(5).trim()
      if (d === '[DONE]') continue
      try {
        const j = JSON.parse(d)
        const delta = j.choices?.[0]?.delta?.content
        if (delta) out += delta
      } catch {}
    }
  }
  return out
}

function extractJson(text) {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {}
  let s = trimmed.indexOf('['), e = trimmed.lastIndexOf(']')
  if (s >= 0 && e > s) return JSON.parse(trimmed.slice(s, e + 1))
  s = trimmed.indexOf('{'); e = trimmed.lastIndexOf('}')
  if (s >= 0 && e > s) return JSON.parse(trimmed.slice(s, e + 1))
  throw new Error('JSON 解析失败')
}

const kp = {
  title: '闭包 Closure',
  content:
    '闭包是函数与其词法作用域的组合。JS 中内层函数可以访问外层函数的变量，即使外层已返回。常见用途：数据私有化、函数工厂、回调保留上下文。注意循环 + var 的经典陷阱（用 let 或闭包解决）。',
}

const genSys =
  '你是一位严格的前端 / 全栈 / AI 应用方向面试官与讲师。只能依据下面提供的知识点内容出题，不要编造知识点之外的信息。请输出 JSON 数组，每个元素格式：{"type":"choice|short_answer|code","stem":"题目","options":["A...","B..."](仅 choice 需要),"modelAnswer":"参考答案","difficulty":"easy|medium|hard","explanation":"解析"}。只输出 JSON，不要任何额外文字。'
const genUser = `知识点列表（标题 + 内容）：\n【${kp.title}】\n${kp.content}\n\n请基于上述知识点，总共生成约 2 道题，覆盖不同题型与难度。`

console.log('=== STEP1 出题（流式） ===')
const genRaw = await streamChat(genSys, genUser)
console.log('原始输出片段:', genRaw.slice(0, 120).replace(/\n/g, ' '), '...')
const questions = extractJson(genRaw)
console.log('解析出题目数:', Array.isArray(questions) ? questions.length : '非数组')
const q = (Array.isArray(questions) ? questions[0] : questions)
console.log('第1题:', JSON.stringify({ type: q.type, stem: q.stem, difficulty: q.difficulty }))

console.log('\n=== STEP2 评分（好答案） ===')
const scoreSys =
  '你是评分官。只能依据以下知识点与标准答案评分，不确定要明确说明。输出 JSON：{"score":0-100,"correct":true|false,"feedback":"评语","weakPoints":["薄弱点"]}。只输出 JSON。'
const goodAnswer = '闭包是函数与其词法作用域的组合，内层函数能访问外层变量，可用于数据私有化和函数工厂。'
const scoreUser = `知识点：【${kp.title}】\n${kp.content}\n\n题目：${q.stem}\n标准答案：${q.modelAnswer}\n\n考生作答：${goodAnswer}\n\n请给出评分 JSON。`
const scoreRaw = await streamChat(scoreSys, scoreUser)
const score = extractJson(scoreRaw)
console.log('评分结果:', JSON.stringify(score))

console.log('\n=== 端到端 OK ===')

// 复刻 src/lib/llm/openaiCompatible.ts 的 SSE 流式解析，验证真实 Key 的流式路径
const KEY = process.env.DS_KEY
const base = 'https://api.deepseek.com/v1'

async function main() {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: '用一句话解释什么是闭包，30字以内' }],
      stream: true,
      temperature: 0.3,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('ERR', res.status, text.slice(0, 200))
    process.exit(1)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let out = ''
  let chunks = 0
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
      if (d === '[DONE]') {
        console.log(`\n[deltas=${chunks}] [DONE]`)
        process.exit(0)
      }
      try {
        const j = JSON.parse(d)
        const delta = j.choices?.[0]?.delta?.content
        if (delta) {
          out += delta
          chunks++
        }
      } catch {}
    }
  }
  console.log(out)
}
main()

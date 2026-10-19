import {
  buildInterviewQuestionMessages,
  buildInterviewScoreMessages,
  buildInterviewEvalMessages,
} from '../src/lib/prompts.ts'
import type { InterviewRound } from '../src/types.ts'

const KEY = process.env.DS_KEY ?? ''

async function chat(system: string, user: string): Promise<string> {
  const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: false,
      temperature: 0.7,
    }),
  })
  const j = await r.json()
  return j.choices?.[0]?.message?.content ?? ''
}

function extractJson<T>(text: string): T {
  const m = text.match(/[\{\[][\s\S]*[\}\]]/)
  if (!m) throw new Error('无 JSON：' + text.slice(0, 200))
  return JSON.parse(m[0]) as T
}

const context = '【知识点：React 合成事件】React 使用合成事件，将事件委托到根节点统一处理。\n【知识点：CSS 盒模型】盒模型包含 content、padding、border、margin。'

let fail = 0

// 1. 出题
const q = extractJson<{ question: string; intent: string; reference: string }>(
  await chat(
    ...(Object.values(buildInterviewQuestionMessages('前端工程师', context, 0, [])) as [string, string]),
  ),
)
console.log('出题:', q.question.slice(0, 60), '| intent:', q.intent)
if (!q.question || !q.reference) fail++

// 2. 评分
const s = extractJson<{ score: number; correct: boolean; feedback: string; weakPoints?: string[] }>(
  await chat(
    ...(Object.values(
      buildInterviewScoreMessages('前端工程师', context, {
        question: q.question,
        reference: q.reference,
        userAnswer: 'React 用合成事件把事件挂到根节点统一处理，减少内存开销。',
      }),
    ) as [string, string]),
  ),
)
console.log('评分:', s.score, '| correct:', s.correct)
if (typeof s.score !== 'number') fail++

// 3. 评估
const history: InterviewRound[] = [
  { question: q.question, intent: q.intent, userAnswer: '答得还行', score: s.score, feedback: s.feedback },
]
const e = extractJson<{ overall: number; level: string; strengths: string[]; weaknesses: string[]; recommendation: string }>(
  await chat(...(Object.values(buildInterviewEvalMessages('前端工程师', history)) as [string, string])),
)
console.log('评估: 综合', e.overall, '| 评级', e.level, '| 建议', e.recommendation.slice(0, 40))
if (typeof e.overall !== 'number' || !e.level) fail++

if (fail === 0) console.log('\nE2E INTERVIEW OK')
else {
  console.error('\nE2E 失败')
  process.exit(1)
}

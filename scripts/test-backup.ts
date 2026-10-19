import { buildBackup, parseBackup, BACKUP_APP, BACKUP_VERSION } from '../src/lib/backup.ts'
import type { AppState } from '../src/types.ts'

const state: AppState = {
  courses: [{ id: 'c1', name: '前端', parentId: null, sort: 0, createdAt: 1 }],
  knowledgePoints: [
    {
      id: 'k1',
      courseId: 'c1',
      title: 'React',
      content: '库',
      tags: ['框架'],
      sourceType: 'md',
      sourcePath: null,
      createdAt: 2,
      updatedAt: 3,
    },
  ],
  questions: [
    { id: 'q1', kpId: 'k1', type: 'mc', stem: '?', options: ['a', 'b'], modelAnswer: 'a', difficulty: 1, createdAt: 4 },
  ],
  answers: [{ id: 'a1', questionId: 'q1', userAnswer: 'a', score: 100, feedback: 'ok', createdAt: 5 }],
  corrections: [
    { id: 'cr1', targetType: 'question', targetId: 'q1', field: 'score', original: '0', corrected: '100', createdAt: 6 },
  ],
  interviewSessions: [
    {
      id: 'i1',
      role: 'fe',
      config: { role: 'fe', kpIds: ['k1'], rounds: 3 },
      history: [{ question: 'x', answer: 'y', feedback: 'z' }],
      report: { overall: 80, dimensions: { depth: 80, breadth: 80, expression: 80 }, weakPoints: ['z'] },
      createdAt: 7,
    },
  ],
  settings: { provider: 'deepseek', baseURL: '', apiKey: 'sk-x', model: '', useMock: false },
  voice: { lang: 'zh-CN' },
}

// 1) build → 结构正确
const b = buildBackup(state)
if (b.app !== BACKUP_APP || b.version !== BACKUP_VERSION) throw new Error('TEST backup header fail')
console.log('TEST1 backup header =>', b.app, b.version, b.exportedAt)

// 2) 写→读 一致（所有数组长度 + 关键字段）
const restored = parseBackup(JSON.stringify(b))
const checks: [string, boolean][] = [
  ['courses', restored.courses.length === 1 && restored.courses[0].id === 'c1'],
  ['knowledgePoints', restored.knowledgePoints.length === 1 && restored.knowledgePoints[0].tags[0] === '框架'],
  ['questions.options', JSON.stringify(restored.questions[0].options) === JSON.stringify(['a', 'b'])],
  ['answers.score', restored.answers[0].score === 100],
  ['corrections', restored.corrections[0].corrected === '100'],
  ['interview.history', restored.interviewSessions[0].history[0].answer === 'y'],
  ['interview.report.weakPoints', (restored.interviewSessions[0].report as any).weakPoints[0] === 'z'],
  ['settings', restored.settings.apiKey === 'sk-x' && restored.settings.useMock === false],
  ['voice', restored.voice.lang === 'zh-CN'],
]
for (const [name, ok] of checks) {
  if (!ok) throw new Error('TEST round-trip fail: ' + name)
}
console.log('TEST2 round-trip =>', checks.map((c) => c[0]).join(', '), '全部一致')

// 3) 损坏/非备份文件应抛错
const badCases = [
  '{ not json',
  JSON.stringify({ app: 'other' }),
  JSON.stringify({ app: BACKUP_APP, data: { courses: [] } }), // 缺 version
  JSON.stringify({ app: BACKUP_APP, version: 1, data: { questions: [] } }), // 缺 courses
]
for (const c of badCases) {
  let threw = false
  try {
    parseBackup(c)
  } catch {
    threw = true
  }
  if (!threw) throw new Error('TEST validation fail: should reject -> ' + c.slice(0, 40))
}
console.log('TEST3 validation => 4 个非法输入均被正确拒绝')

console.log('backup test PASS')

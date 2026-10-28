import initSqlJs from 'sql.js'
import * as schema from '../src/lib/dbSchema.ts'

// 内存版 localStorage shim，用于验证一次性迁移路径
const mem: Record<string, string> = {}
;(globalThis as any).localStorage = {
  getItem: (k: string) => (k in mem ? mem[k] : null),
  setItem: (k: string, v: string) => {
    mem[k] = v
  },
  removeItem: (k: string) => {
    delete mem[k]
  },
}

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('❌ FAIL:', msg)
    process.exit(1)
  }
  console.log('✓', msg)
}

async function main() {
  const SQL = await initSqlJs()
  const db = new SQL.Database()

  await schema.migrate(db)

  // 空库读取应为空 + 默认配置
  const empty = await schema.loadAll(db)
  assert(empty.courses.length === 0 && empty.knowledgePoints.length === 0, '空库返回空数组')
  assert(empty.settings.provider === 'deepseek' && empty.voice.lang === 'zh-CN', '空库返回默认 settings/voice')

  // 构造含全部实体 + JSON 字段的样本
  const state = {
    courses: [{ id: 'c1', name: '前端', parentId: null, sort: 0, createdAt: 1 }],
    knowledgePoints: [
      {
        id: 'k1',
        courseId: 'c1',
        title: 'React',
        content: '# React\n内容',
        tags: ['前端', '框架'],
        sourceType: 'md' as const,
        sourceName: 'a.md',
        createdAt: 2,
        updatedAt: 3,
        aiContent: '**易错点**：混淆 React 与框架。\n**关联**：与 Vue 对比理解。',
        aiOptimizedAt: 9,
      },
    ],
    questions: [
      {
        id: 'q1',
        kpId: 'k1',
        type: 'choice' as const,
        stem: 'React 是什么？',
        options: ['库', '语言'],
        modelAnswer: '库',
        difficulty: 'easy' as const,
        explanation: '用于构建 UI',
        createdAt: 4,
      },
    ],
    answers: [
      {
        id: 'a1',
        questionId: 'q1',
        userAnswer: '库',
        score: 100,
        correct: true,
        feedback: '正确',
        weakPoints: ['类型'],
        createdAt: 5,
      },
    ],
    corrections: [
      {
        id: 'cr1',
        targetType: 'answer' as const,
        targetId: 'a1',
        field: 'feedback',
        original: 'x',
        corrected: 'y',
        createdAt: 6,
      },
    ],
    interviewSessions: [
      {
        id: 'iv1',
        role: '前端',
        scopeName: 'React',
        rounds: 1,
        history: [
          {
            question: '什么是 fiber？',
            intent: '原理',
            userAnswer: '...',
            score: 80,
            feedback: '不错',
            weakPoints: ['细节'],
          },
        ],
        report: {
          overall: 80,
          level: '中级',
          strengths: ['基础'],
          weaknesses: ['细节'],
          recommendation: '多看源码',
        },
        createdAt: 7,
      },
    ],
    settings: {
      provider: 'deepseek' as const,
      baseURL: '',
      apiKey: 'sk-x',
      model: 'deepseek-chat',
      useMock: false,
    },
    voice: { lang: 'en-US' },
    liveInterview: {
      phase: 'running' as const,
      role: '前端工程师',
      rounds: 5,
      scope: 'c1',
      scopeName: '前端',
      current: { question: 'Q?', intent: '基础概念', reference: 'R' },
      history: [{ question: 'Q?', intent: '基础概念', userAnswer: 'A', score: 70, feedback: 'ok' }],
      roundIdx: 1,
      report: null,
      ctx: '上下文',
      kpIds: ['k1'],
      updatedAt: 11,
    },
  }

  await schema.syncAll(db, state)

  const loaded = await schema.loadAll(db)
  assert(loaded.courses.length === 1 && loaded.courses[0].id === 'c1', 'courses 往返一致')
  assert(loaded.knowledgePoints.length === 1, 'knowledgePoints 往返数量一致')
  assert(
    JSON.stringify(loaded.knowledgePoints[0].tags) === JSON.stringify(['前端', '框架']),
    'kp.tags JSON 往返一致',
  )
  assert(
    loaded.knowledgePoints[0].aiContent?.includes('易错点') === true &&
      loaded.knowledgePoints[0].aiOptimizedAt === 9,
    'kp.aiContent / aiOptimizedAt 往返一致',
  )
  assert(loaded.questions[0].options?.length === 2, 'question.options JSON 往返一致')
  assert(loaded.answers[0].correct === true && loaded.answers[0].weakPoints?.length === 1, 'answer.correct/weakPoints 往返一致')
  assert(loaded.corrections[0].corrected === 'y', 'corrections 往返一致')
  assert(loaded.interviewSessions[0].history[0].intent === '原理', 'interview.history JSON 往返一致')
  assert(loaded.interviewSessions[0].report.level === '中级', 'interview.report JSON 往返一致')
  assert(loaded.settings.apiKey === 'sk-x' && loaded.settings.useMock === false, 'settings 往返一致')
  assert(loaded.voice.lang === 'en-US', 'voice 往返一致')
  assert(
    loaded.liveInterview?.phase === 'running' &&
      loaded.liveInterview.history[0].userAnswer === 'A' &&
      loaded.liveInterview.kpIds[0] === 'k1',
    'liveInterview 快照往返一致',
  )

  await schema.insertLlmCall(db, {
    id: 'u1',
    createdAt: 1_700_000_000_000,
    task: 'optimize',
    provider: 'deepseek',
    model: 'deepseek-chat',
    status: 'ok',
    promptTokens: 10,
    completionTokens: 20,
    estimated: false,
    durationMs: 5,
  })
  const calls = await schema.listLlmCalls(db, 0)
  assert(
    calls.length === 1 && calls[0].promptTokens === 10 && calls[0].completionTokens === 20 && !calls[0].estimated,
    'llm_calls 可写入并读回',
  )
  assert((await schema.listLlmCalls(db, 1_700_000_000_001)).length === 0, 'llm_calls 按时间过滤')

  // 重置清空
  await schema.resetDb(db)
  const afterReset = await schema.loadAll(db)
  assert(
    afterReset.courses.length === 0 &&
      afterReset.questions.length === 0 &&
      afterReset.interviewSessions.length === 0,
    'resetDb 清空所有业务表',
  )
  assert(afterReset.liveInterview === null, 'resetDb 同时清空 liveInterview 快照')
  assert((await schema.listLlmCalls(db)).length === 0, 'resetDb 同时清空调用记录')

  // 旧 localStorage 一次性迁移（DB 为空时导入，导入后删除键）
  const legacy = {
    courses: [{ id: 'lc1', name: '旧课', parentId: null, sort: 0, createdAt: 9 }],
    knowledgePoints: [],
    questions: [],
    answers: [],
    corrections: [],
    interviewSessions: [],
    settings: { provider: 'deepseek', baseURL: '', apiKey: '', model: '', useMock: true },
    voice: { lang: 'zh-CN' },
  }
  mem['skill-qa-agent:v1'] = JSON.stringify(legacy)
  await schema.migrateFromLocalStorage(db)
  const migrated = await schema.loadAll(db)
  assert(migrated.courses.length === 1 && migrated.courses[0].id === 'lc1', '旧 localStorage 已迁移入库')
  assert(!('skill-qa-agent:v1' in mem), '迁移后旧键已删除')
  // 二次迁移不应重复（DB 已有数据时跳过）
  mem['skill-qa-agent:v1'] = JSON.stringify(legacy)
  await schema.migrateFromLocalStorage(db)
  assert((await schema.loadAll(db)).courses.length === 1, 'DB 非空时迁移幂等（不重复导入）')
  assert(!('skill-qa-agent:v1' in mem), '幂等迁移同样清除旧键')

  console.log('\nAll dbSchema tests passed ✅')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

import type {
  AppState,
  Course,
  KnowledgePoint,
  Question,
  AnswerRecord,
  Correction,
  InterviewSession,
  InterviewRound,
  InterviewReport,
  LLMConfig,
  VoiceSettings,
  LiveInterview,
} from '../types'

/**
 * 规范化表结构（纯 SQL，不依赖任何引擎 —— 浏览器 sql.js / Node / Tauri 都可复用）。
 * run / exec 可以是同步（sql.js）或返回 Promise（桌面原生 SQLite）。调用方一律 await。
 *
 * 设计要点：
 * - 每个业务实体一张表，数组/对象字段（tags、options、history…）以 JSON 文本存储。
 * - knowledge_points 预留 embedding(BLOB) 列，未来本地向量检索可直接落表，无需外挂向量库。
 * - kv 表存 settings / voice 等单例配置。
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  sort INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_points (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  embedding BLOB,
  ai_content TEXT NOT NULL DEFAULT '',
  ai_optimized_at INTEGER
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  kp_id TEXT NOT NULL,
  type TEXT NOT NULL,
  stem TEXT NOT NULL,
  options TEXT,
  model_answer TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  explanation TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  user_answer TEXT NOT NULL,
  score INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  feedback TEXT NOT NULL,
  weak_points TEXT,
  analysis TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS corrections (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  field TEXT NOT NULL,
  original TEXT NOT NULL,
  corrected TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS interview_sessions (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  scope_name TEXT NOT NULL,
  rounds INTEGER NOT NULL,
  history TEXT NOT NULL,
  report TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_calls (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  task TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  estimated INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_calls_created ON llm_calls(created_at);
`

export async function migrate(db: any): Promise<void> {
  await db.run(SCHEMA)
  // 旧库可能没有 ai_content 列，补齐（不影响已有数据）。
  const cols = await db.exec('PRAGMA table_info(knowledge_points)')
  const has = (name: string) =>
    cols.length > 0 && cols[0].values.some((v: any[]) => v[1] === name)
  if (!has('ai_content'))
    await db.run('ALTER TABLE knowledge_points ADD COLUMN ai_content TEXT NOT NULL DEFAULT \'\'')
  if (!has('ai_optimized_at'))
    await db.run('ALTER TABLE knowledge_points ADD COLUMN ai_optimized_at INTEGER')
  const answerCols = await db.exec('PRAGMA table_info(answers)')
  const answerHas = (name: string) =>
    answerCols.length > 0 && answerCols[0].values.some((v: any[]) => v[1] === name)
  if (!answerHas('analysis')) await db.run('ALTER TABLE answers ADD COLUMN analysis TEXT')
}

/** 把 sql.js exec 的结果集转成行对象数组。 */
async function rows(db: any, sql: string): Promise<Record<string, any>[]> {
  const res = await db.exec(sql)
  if (!res.length) return []
  const { columns, values } = res[0]
  return values.map((v: any[]) => {
    const o: Record<string, any> = {}
    columns.forEach((c: string, i: number) => (o[c] = v[i]))
    return o
  })
}

function jsonOr<T>(s: any, fallback: T): T {
  if (s == null) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

/** 把整个 AppState 全量写入各表（事务内清空+插入）。单列配置走 kv。 */
export async function syncAll(db: any, state: AppState): Promise<void> {
  await db.run('BEGIN')
  try {
    await db.run('DELETE FROM courses')
    for (const c of state.courses) {
      await db.run(
        'INSERT INTO courses (id,name,parent_id,sort,created_at) VALUES (?,?,?,?,?)',
        [c.id, c.name, c.parentId, c.sort, c.createdAt],
      )
    }

    await db.run('DELETE FROM knowledge_points')
    for (const k of state.knowledgePoints) {
      await db.run(
        'INSERT INTO knowledge_points (id,course_id,title,content,tags,source_type,source_name,created_at,updated_at,embedding,ai_content,ai_optimized_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          k.id,
          k.courseId,
          k.title,
          k.content,
          JSON.stringify(k.tags ?? []),
          k.sourceType,
          k.sourceName ?? null,
          k.createdAt,
          k.updatedAt,
          null, // embedding 预留，暂不写
          k.aiContent ?? '',
          k.aiOptimizedAt ?? null,
        ],
      )
    }

    await db.run('DELETE FROM questions')
    for (const q of state.questions) {
      await db.run(
        'INSERT INTO questions (id,kp_id,type,stem,options,model_answer,difficulty,explanation,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [
          q.id,
          q.kpId,
          q.type,
          q.stem,
          q.options ? JSON.stringify(q.options) : null,
          q.modelAnswer,
          q.difficulty,
          q.explanation,
          q.createdAt,
        ],
      )
    }

    await db.run('DELETE FROM answers')
    for (const a of state.answers) {
      await db.run(
        'INSERT INTO answers (id,question_id,user_answer,score,correct,feedback,weak_points,analysis,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [
          a.id,
          a.questionId,
          a.userAnswer,
          a.score,
          a.correct ? 1 : 0,
          a.feedback,
          a.weakPoints ? JSON.stringify(a.weakPoints) : null,
          a.analysis ? JSON.stringify(a.analysis) : null,
          a.createdAt,
        ],
      )
    }

    await db.run('DELETE FROM corrections')
    for (const c of state.corrections) {
      await db.run(
        'INSERT INTO corrections (id,target_type,target_id,field,original,corrected,created_at) VALUES (?,?,?,?,?,?,?)',
        [c.id, c.targetType, c.targetId, c.field, c.original, c.corrected, c.createdAt],
      )
    }

    await db.run('DELETE FROM interview_sessions')
    for (const s of state.interviewSessions) {
      await db.run(
        'INSERT INTO interview_sessions (id,role,scope_name,rounds,history,report,created_at) VALUES (?,?,?,?,?,?,?)',
        [
          s.id,
          s.role,
          s.scopeName,
          s.rounds,
          JSON.stringify(s.history),
          JSON.stringify(s.report),
          s.createdAt,
        ],
      )
    }

    await db.run('DELETE FROM kv')
    await db.run('INSERT INTO kv (key,value) VALUES (?,?)', ['settings', JSON.stringify(state.settings)])
    await db.run('INSERT INTO kv (key,value) VALUES (?,?)', ['voice', JSON.stringify(state.voice)])
    // 进行中的面试快照：有则存，回到配置页即清空（见 useStore.setLiveInterview）。
    if (state.liveInterview) {
      await db.run('INSERT INTO kv (key,value) VALUES (?,?)', [
        'live_interview',
        JSON.stringify(state.liveInterview),
      ])
    }
    await db.run('INSERT INTO kv (key,value) VALUES (?,?)', [
      'mastered_wrongs',
      JSON.stringify(state.masteredWrongIds ?? []),
    ])

    await db.run('COMMIT')
  } catch (e) {
    await db.run('ROLLBACK')
    throw e
  }
}

/** 从各表读回完整 AppState（空库返回空数组 + 默认配置）。 */
export async function loadAll(db: any): Promise<AppState> {
  const courses: Course[] = (await rows(db, 'SELECT * FROM courses')).map((r) => ({
    id: r.id,
    name: r.name,
    parentId: r.parent_id ?? null,
    sort: Number(r.sort),
    createdAt: Number(r.created_at),
  }))

  const knowledgePoints: KnowledgePoint[] = (await rows(db, 'SELECT * FROM knowledge_points')).map((r) => ({
    id: r.id,
    courseId: r.course_id,
    title: r.title,
    content: r.content,
    tags: jsonOr<string[]>(r.tags, []),
    sourceType: r.source_type,
    sourceName: r.source_name ?? undefined,
    aiContent: r.ai_content ? String(r.ai_content) : undefined,
    aiOptimizedAt: r.ai_optimized_at != null ? Number(r.ai_optimized_at) : undefined,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }))

  const questions: Question[] = (await rows(db, 'SELECT * FROM questions')).map((r) => ({
    id: r.id,
    kpId: r.kp_id,
    type: r.type,
    stem: r.stem,
    options: r.options ? jsonOr<string[] | undefined>(r.options, undefined) : undefined,
    modelAnswer: r.model_answer,
    difficulty: r.difficulty,
    explanation: r.explanation,
    createdAt: Number(r.created_at),
  }))

  const answers: AnswerRecord[] = (await rows(db, 'SELECT * FROM answers')).map((r) => ({
    id: r.id,
    questionId: r.question_id,
    userAnswer: r.user_answer,
    score: Number(r.score),
    correct: Number(r.correct) === 1,
    feedback: r.feedback,
    weakPoints: r.weak_points ? jsonOr<string[] | undefined>(r.weak_points, undefined) : undefined,
    analysis: r.analysis ? jsonOr(r.analysis, undefined) : undefined,
    createdAt: Number(r.created_at),
  }))

  const corrections: Correction[] = (await rows(db, 'SELECT * FROM corrections')).map((r) => ({
    id: r.id,
    targetType: r.target_type,
    targetId: r.target_id,
    field: r.field,
    original: r.original,
    corrected: r.corrected,
    createdAt: Number(r.created_at),
  }))

  const interviewSessions: InterviewSession[] = (await rows(db, 'SELECT * FROM interview_sessions')).map(
    (r) => ({
      id: r.id,
      role: r.role,
      scopeName: r.scope_name,
      rounds: Number(r.rounds),
      history: jsonOr<InterviewRound[]>(r.history, []),
      report: jsonOr<InterviewReport>(r.report, {
        overall: 0,
        level: '',
        strengths: [],
        weaknesses: [],
        recommendation: '',
      }),
      createdAt: Number(r.created_at),
    }),
  )

  const kvRows = await rows(db, 'SELECT key, value FROM kv')
  const kv: Record<string, string> = {}
  for (const r of kvRows) kv[r.key] = r.value

  const settings: LLMConfig | undefined = kv.settings
    ? jsonOr<LLMConfig | undefined>(kv.settings, undefined)
    : undefined
  const voice: VoiceSettings | undefined = kv.voice
    ? jsonOr<VoiceSettings | undefined>(kv.voice, undefined)
    : undefined
  const liveInterview: LiveInterview | null = kv.live_interview
    ? jsonOr<LiveInterview | null>(kv.live_interview, null)
    : null
  const masteredWrongIds = kv.mastered_wrongs ? jsonOr<string[]>(kv.mastered_wrongs, []) : []

  return {
    courses,
    knowledgePoints,
    questions,
    answers,
    corrections,
    interviewSessions,
    masteredWrongIds,
    liveInterview,
    settings: settings ?? {
      provider: 'deepseek',
      baseURL: '',
      apiKey: '',
      model: '',
      useMock: true,
    },
    voice: voice ?? { lang: 'zh-CN' },
  }
}

/** 清空所有业务表（保留结构），用于「重置」。 */
export async function resetDb(db: any): Promise<void> {
  await db.run('BEGIN')
  try {
    for (const t of [
      'courses',
      'knowledge_points',
      'questions',
      'answers',
      'corrections',
      'interview_sessions',
      'kv',
      'llm_calls',
    ]) {
      await db.run(`DELETE FROM ${t}`)
    }
    await db.run('COMMIT')
  } catch (e) {
    await db.run('ROLLBACK')
    throw e
  }
}

export type LlmCallRow = {
  id: string
  createdAt: number
  task: string
  provider: string
  model: string
  status: string
  promptTokens: number
  completionTokens: number
  estimated: boolean
  durationMs: number
}

export async function insertLlmCall(db: any, row: LlmCallRow): Promise<void> {
  await db.run(
    `INSERT INTO llm_calls (id,created_at,task,provider,model,status,prompt_tokens,completion_tokens,estimated,duration_ms)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      row.id,
      row.createdAt,
      row.task,
      row.provider,
      row.model,
      row.status,
      row.promptTokens,
      row.completionTokens,
      row.estimated ? 1 : 0,
      row.durationMs,
    ],
  )
}

export async function listLlmCalls(db: any, since = 0): Promise<LlmCallRow[]> {
  const all = await rows(db, 'SELECT * FROM llm_calls ORDER BY created_at ASC')
  return all
    .filter((r) => Number(r.created_at) >= since)
    .map((r) => ({
      id: String(r.id),
      createdAt: Number(r.created_at),
      task: String(r.task),
      provider: String(r.provider),
      model: String(r.model),
      status: String(r.status),
      promptTokens: Number(r.prompt_tokens) || 0,
      completionTokens: Number(r.completion_tokens) || 0,
      estimated: Number(r.estimated) === 1,
      durationMs: Number(r.duration_ms) || 0,
    }))
}

/**
 * 一次性迁移：旧版本把整份 AppState 存在 localStorage('skill-qa-agent:v1')。
 * 仅当 SQLite 为空（无课程）时导入，导入后删除旧键，避免重复。
 */
export async function migrateFromLocalStorage(db: any): Promise<void> {
  try {
    const raw = localStorage.getItem('skill-qa-agent:v1')
    if (!raw) return
    const cnt = await db.exec('SELECT COUNT(*) AS n FROM courses')
    const has = cnt.length > 0 && Number(cnt[0].values[0][0]) > 0
    if (has) {
      localStorage.removeItem('skill-qa-agent:v1')
      return
    }
    const saved = JSON.parse(raw) as Partial<AppState>
    await syncAll(db, {
      courses: saved.courses ?? [],
      knowledgePoints: saved.knowledgePoints ?? [],
      questions: saved.questions ?? [],
      answers: saved.answers ?? [],
      corrections: saved.corrections ?? [],
      interviewSessions: saved.interviewSessions ?? [],
      masteredWrongIds: saved.masteredWrongIds ?? [],
      settings: saved.settings ?? {
        provider: 'deepseek',
        baseURL: '',
        apiKey: '',
        model: '',
        useMock: true,
      },
      voice: saved.voice ?? { lang: 'zh-CN' },
    })
    localStorage.removeItem('skill-qa-agent:v1')
  } catch {
    /* 迁移失败不阻塞启动 */
  }
}

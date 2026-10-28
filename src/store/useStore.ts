import { create } from 'zustand'
import type {
  AppState,
  Course,
  KnowledgePoint,
  Question,
  AnswerRecord,
  Correction,
  InterviewSession,
  LLMConfig,
  VoiceSettings,
  LiveInterview,
} from '../types'
import { uid } from '../lib/id'
import * as db from '../lib/db'
import { isDesktop, rememberApiKey } from '../lib/desktop'
import { getLastBackupAt, runAutoBackup } from '../lib/autoBackup'

// 从 .env(.local) 读取默认 LLM 配置（Vite 注入，仅本地自用场景）。
const env = import.meta.env
const envProvider = (env.VITE_LLM_PROVIDER as string) || 'deepseek'
const envBase = (env.VITE_LLM_BASE_URL as string) || ''
const envModel = (env.VITE_LLM_MODEL as string) || ''
const envKey = (env.VITE_LLM_API_KEY as string) || ''

const defaultSettings: LLMConfig = {
  provider: (envProvider as LLMConfig['provider']) || 'deepseek',
  baseURL: envBase,
  apiKey: envKey,
  model: envModel,
  // 注入了 Key ⇒ 默认走真实 API；否则默认 Mock 离线模式
  useMock: envKey ? false : true,
}

const defaultVoice: VoiceSettings = {
  lang: 'zh-CN',
}

// 把环境变量作为「填空默认值」合并进已保存的设置：
// 用户没设过的字段用 env 补；用户自己设过 Key 则尊重其 Mock 开关。
function mergeEnv(base: LLMConfig): LLMConfig {
  const mergedKey = base.apiKey || envKey
  const hadOwnKey = base.apiKey.length > 0
  return {
    provider: base.provider || envProvider,
    baseURL: base.baseURL || envBase,
    apiKey: mergedKey,
    model: base.model || envModel,
    useMock: hadOwnKey ? base.useMock : mergedKey ? false : base.useMock,
  }
}

function emptyState(): AppState {
  return {
    courses: [],
    knowledgePoints: [],
    questions: [],
    answers: [],
    corrections: [],
    interviewSessions: [],
    settings: defaultSettings,
    voice: defaultVoice,
    liveInterview: null,
  }
}

type Store = AppState & {
  hydrated: boolean // 数据库异步加载完成前，UI 显示加载态
  addCourse: (name: string, parentId: string | null) => void
  renameCourse: (id: string, name: string) => void
  deleteCourse: (id: string) => void
  addKP: (kp: Omit<KnowledgePoint, 'id' | 'createdAt' | 'updatedAt'>) => void
  updateKP: (id: string, patch: Partial<KnowledgePoint>) => void
  deleteKP: (id: string) => void
  /** AI 优化补充：写入 aiContent 与 aiOptimizedAt（原文 content 不变）。 */
  optimizeKP: (id: string, aiContent: string) => void
  importFolder: (courses: Course[], kps: KnowledgePoint[]) => void
  addQuestions: (qs: Question[]) => void
  deleteQuestion: (id: string) => void
  recordAnswer: (a: Omit<AnswerRecord, 'id' | 'createdAt'>) => void
  addCorrection: (c: Omit<Correction, 'id' | 'createdAt'>) => void
  addInterviewSession: (s: Omit<InterviewSession, 'id' | 'createdAt'>) => void
  setSettings: (patch: Partial<LLMConfig>) => void
  voice: VoiceSettings
  setVoice: (patch: Partial<VoiceSettings>) => void
  /** 保存/清空「进行中的面试」快照（null 表示清空）。 */
  setLiveInterview: (v: LiveInterview | null) => void
  reset: () => void
  /** 整库导入：用备份数据全量替换并落库（syncAll 自身清空后写入）。 */
  replaceAll: (data: AppState) => void
}

// 自动备份：数据只存在浏览器 IndexedDB 里，清站点数据即全丢。
// 距上次备份超过阈值时，借下一次数据变更顺手做一次（本地快照 + 已连目录则落盘）。
const AUTO_BACKUP_INTERVAL = 10 * 60 * 1000
let backupTimer: ReturnType<typeof setTimeout> | null = null
function maybeAutoBackup(get: () => Store) {
  if (backupTimer) return
  const last = getLastBackupAt()
  if (last && Date.now() - last < AUTO_BACKUP_INTERVAL) return
  backupTimer = setTimeout(() => {
    backupTimer = null
    const s = get()
    void runAutoBackup({
      courses: s.courses,
      knowledgePoints: s.knowledgePoints,
      questions: s.questions,
      answers: s.answers,
      corrections: s.corrections,
      interviewSessions: s.interviewSessions,
      settings: s.settings,
      voice: s.voice,
    }).catch(() => {})
  }, 2000)
}

// 防抖落库：合并 250ms 内的多次写入，统一全表同步 + 写 IndexedDB。
let syncTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSync(get: () => Store) {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncTimer = null
    const s = get()
    void db
      .syncAll({
        courses: s.courses,
        knowledgePoints: s.knowledgePoints,
        questions: s.questions,
        answers: s.answers,
        corrections: s.corrections,
        interviewSessions: s.interviewSessions,
        settings: s.settings,
        voice: s.voice,
        liveInterview: s.liveInterview ?? null,
      })
      .catch(() => {})
  }, 250)
}

export const useStore = create<Store>((set, get) => {
  const persist = () => {
    scheduleSync(get)
    maybeAutoBackup(get)
  }

  return {
    ...emptyState(),
    hydrated: false,

    addCourse: (name, parentId) => {
      set((s) => ({
        courses: [
          ...s.courses,
          { id: uid(), name, parentId, sort: s.courses.length, createdAt: Date.now() },
        ],
      }))
      persist()
    },
    renameCourse: (id, name) => {
      set((s) => ({ courses: s.courses.map((c) => (c.id === id ? { ...c, name } : c)) }))
      persist()
    },
    deleteCourse: (id) => {
      const toDelete = new Set<string>()
      const collect = (pid: string) => {
        toDelete.add(pid)
        get()
          .courses.filter((c) => c.parentId === pid)
          .forEach((c) => collect(c.id))
      }
      collect(id)
      set((s) => ({
        courses: s.courses.filter((c) => !toDelete.has(c.id)),
        knowledgePoints: s.knowledgePoints.filter((k) => !toDelete.has(k.courseId)),
      }))
      persist()
    },

    addKP: (kp) => {
      set((s) => ({
        knowledgePoints: [
          ...s.knowledgePoints,
          { ...kp, id: uid(), createdAt: Date.now(), updatedAt: Date.now() },
        ],
      }))
      persist()
    },
    updateKP: (id, patch) => {
      set((s) => ({
        knowledgePoints: s.knowledgePoints.map((k) =>
          k.id === id ? { ...k, ...patch, updatedAt: Date.now() } : k,
        ),
      }))
      persist()
    },
    deleteKP: (id) => {
      set((s) => ({ knowledgePoints: s.knowledgePoints.filter((k) => k.id !== id) }))
      persist()
    },
    optimizeKP: (id, aiContent) => {
      set((s) => ({
        knowledgePoints: s.knowledgePoints.map((k) =>
          k.id === id ? { ...k, aiContent, aiOptimizedAt: Date.now() } : k,
        ),
      }))
      persist()
    },

    importFolder: (newCourses, newKps) => {
      set((s) => {
        const cMap = new Map(s.courses.map((c) => [c.id, c]))
        newCourses.forEach((c) => cMap.set(c.id, c))
        const kMap = new Map(s.knowledgePoints.map((k) => [k.id, k]))
        newKps.forEach((k) => kMap.set(k.id, k))
        return { courses: [...cMap.values()], knowledgePoints: [...kMap.values()] }
      })
      persist()
    },

    addQuestions: (qs) => {
      set((s) => ({ questions: [...s.questions, ...qs] }))
      persist()
    },
    deleteQuestion: (id) => {
      set((s) => ({ questions: s.questions.filter((q) => q.id !== id) }))
      persist()
    },

    recordAnswer: (a) => {
      set((s) => ({
        answers: [...s.answers, { ...a, id: uid(), createdAt: Date.now() }],
      }))
      persist()
    },

    addCorrection: (c) => {
      set((s) => ({
        corrections: [...s.corrections, { ...c, id: uid(), createdAt: Date.now() }],
      }))
      persist()
    },

    addInterviewSession: (s) => {
      set((st) => ({
        interviewSessions: [
          { ...s, id: uid(), createdAt: Date.now() },
          ...st.interviewSessions,
        ],
      }))
      persist()
    },

    setSettings: (patch) => {
      set((s) => ({ settings: { ...s.settings, ...patch } }))
      persist()
    },

    setVoice: (patch) => {
      set((s) => ({ voice: { ...s.voice, ...patch } }))
      persist()
    },

    setLiveInterview: (v) => {
      set({ liveInterview: v })
      persist()
    },

    reset: () => {
      void db.resetDb().catch(() => {})
      set({ ...emptyState(), hydrated: true })
    },

    replaceAll: (data) => {
      void db
        .syncAll({
          courses: data.courses,
          knowledgePoints: data.knowledgePoints,
          questions: data.questions,
          answers: data.answers,
          corrections: data.corrections,
          interviewSessions: data.interviewSessions,
          settings: data.settings,
          voice: data.voice,
        })
        .catch(() => {})
      set({
        courses: data.courses,
        knowledgePoints: data.knowledgePoints,
        questions: data.questions,
        answers: data.answers,
        corrections: data.corrections,
        interviewSessions: data.interviewSessions,
        settings: mergeEnv(data.settings),
        voice: data.voice,
        liveInterview: data.liveInterview ?? null,
        hydrated: true,
      })
    },
  }
})

// 启动时异步加载数据库并填充 store（失败也不阻塞，留空状态）。
;(async () => {
  try {
    await db.openDb()
    const loaded = await db.loadAll()
    useStore.setState({
      courses: loaded.courses,
      knowledgePoints: loaded.knowledgePoints,
      questions: loaded.questions,
      answers: loaded.answers,
      corrections: loaded.corrections,
      interviewSessions: loaded.interviewSessions,
      settings: loaded.settings ? mergeEnv(loaded.settings) : defaultSettings,
      voice: loaded.voice,
      liveInterview: loaded.liveInterview ?? null,
      hydrated: true,
    })
    if (isDesktop()) {
      const key = useStore.getState().settings.apiKey
      if (key) void rememberApiKey(key).catch(() => {})
    }
  } catch {
    useStore.setState({ hydrated: true })
  }
})()

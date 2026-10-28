export type Course = {
  id: string
  name: string
  parentId: string | null
  sort: number
  createdAt: number
}

export type KnowledgePoint = {
  id: string
  courseId: string
  title: string
  content: string // markdown：笔记原文（AI 优化时永不改动）
  tags: string[]
  sourceType: 'manual' | 'md' | 'json' | 'txt' | 'docx' | 'pptx' | 'pdf' | 'ai'
  sourceName?: string
  /** AI 补充与拓展（独立于原文），可单独清除 / 重新生成。 */
  aiContent?: string
  aiOptimizedAt?: number
  createdAt: number
  updatedAt: number
}

export type QuestionType = 'choice' | 'short_answer' | 'code'

export type Question = {
  id: string
  kpId: string
  type: QuestionType
  stem: string
  options?: string[]
  modelAnswer: string
  difficulty: 'easy' | 'medium' | 'hard'
  explanation: string
  createdAt: number
}

/** 低于 60 分时和评分一起返回的丢分解析。 */
export type AttemptAnalysis = {
  lossPoints: { point: string; why: string }[]
  explanation: string
  complexity: 'simple' | 'complex'
  references: { title: string; url: string }[]
}

export type AnswerRecord = {
  id: string
  questionId: string
  userAnswer: string
  score: number // 0-100
  correct: boolean
  feedback: string
  weakPoints?: string[]
  analysis?: AttemptAnalysis
  createdAt: number
}

export type Correction = {
  id: string
  targetType: 'answer' | 'question'
  targetId: string
  field: string
  original: string
  corrected: string
  createdAt: number
}

/** 模拟面试：单轮记录。 */
export type InterviewRound = {
  question: string
  intent: string // 本轮考察意图（基础/原理/实战/调试/设计）
  userAnswer: string
  score: number
  feedback: string
  weakPoints?: string[]
  /** 出题时检索到的知识点。旧记录可能没有。 */
  kpIds?: string[]
  analysis?: AttemptAnalysis
}

/** 模拟面试：终轮评估报告。 */
export type InterviewReport = {
  overall: number // 0-100
  level: string // 如 初级/中级/高级/待提升
  strengths: string[]
  weaknesses: string[]
  recommendation: string
}

/** 模拟面试：一次完整会话。 */
export type InterviewSession = {
  id: string
  role: string
  scopeName: string
  rounds: number
  history: InterviewRound[]
  report: InterviewReport
  createdAt: number
}

/**
 * 模拟面试：进行中的会话快照。自动保存到本地库，
 * 使切换课程目录 / 切换 Tab / 刷新页面都不丢失本轮面试进度。
 */
export type LiveInterview = {
  phase: 'config' | 'running' | 'done'
  role: string
  rounds: number
  scope: string
  scopeName: string
  current: { question: string; intent: string; reference: string; kpIds?: string[] } | null
  history: InterviewRound[]
  roundIdx: number
  report: InterviewReport | null
  ctx: string
  kpIds: string[]
  updatedAt: number
}

export type LLMProviderId = 'deepseek' | 'openai' | 'qwen' | 'ollama' | 'mock'

export type LLMConfig = {
  provider: LLMProviderId
  baseURL: string
  apiKey: string
  model: string
  useMock: boolean
}

/** 语音交互设置（Phase 3 客户端模态层）。仅保留语音输入（STT），不做文字朗读。 */
export type VoiceSettings = {
  lang: string // 语音识别语言，如 zh-CN / en-US
}

export type AppState = {
  courses: Course[]
  knowledgePoints: KnowledgePoint[]
  questions: Question[]
  answers: AnswerRecord[]
  corrections: Correction[]
  interviewSessions: InterviewSession[]
  /** 已移出错题本、但仍可在「已掌握」里看到的作答 id 或「面试会话:轮次」。 */
  masteredWrongIds: string[]
  settings: LLMConfig
  voice: VoiceSettings
  /** 进行中的面试快照（可空；不纳入整库备份，仅本地自动保存）。 */
  liveInterview?: LiveInterview | null
}

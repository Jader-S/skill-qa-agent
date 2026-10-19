import type { AppState } from '../types'

// 整库 JSON 备份：把全部课程/知识点/题目/答案/修正/面试/设置序列化为一个文件，
// 用于换机、清站点数据后的完整恢复（区别于「导出 Obsidian .md」仅导出知识点）。

export const BACKUP_APP = 'skill-qa-agent'
export const BACKUP_VERSION = 1

export type LibraryBackup = {
  app: string
  version: number
  exportedAt: string
  data: {
    courses: AppState['courses']
    knowledgePoints: AppState['knowledgePoints']
    questions: AppState['questions']
    answers: AppState['answers']
    corrections: AppState['corrections']
    interviewSessions: AppState['interviewSessions']
    settings: AppState['settings']
    voice: AppState['voice']
  }
}

/** 由当前状态构造备份对象（带应用标识 + 版本 + 导出时间）。 */
export function buildBackup(state: AppState): LibraryBackup {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      courses: state.courses,
      knowledgePoints: state.knowledgePoints,
      questions: state.questions,
      answers: state.answers,
      corrections: state.corrections,
      interviewSessions: state.interviewSessions,
      settings: state.settings,
      voice: state.voice,
    },
  }
}

/** 解析并校验备份文本，返回可整库替换的 AppState 数据。校验失败抛错。 */
export function parseBackup(text: string): AppState {
  let obj: any
  try {
    obj = JSON.parse(text)
  } catch {
    throw new Error('文件不是合法的 JSON')
  }
  if (!obj || obj.app !== BACKUP_APP) {
    throw new Error('不是「技能问答 Agent」的备份文件')
  }
  if (typeof obj.version !== 'number') {
    throw new Error('备份文件缺少版本字段')
  }
  const d = obj.data
  if (!d || !Array.isArray(d.courses)) {
    throw new Error('备份内容损坏：缺少课程数据')
  }
  for (const k of [
    'knowledgePoints',
    'questions',
    'answers',
    'corrections',
    'interviewSessions',
  ] as const) {
    if (!Array.isArray(d[k])) {
      throw new Error(`备份内容损坏：缺少 ${k}`)
    }
  }
  if (!d.settings || typeof d.settings !== 'object') {
    throw new Error('备份内容损坏：缺少设置')
  }
  return {
    courses: d.courses,
    knowledgePoints: d.knowledgePoints ?? [],
    questions: d.questions ?? [],
    answers: d.answers ?? [],
    corrections: d.corrections ?? [],
    interviewSessions: d.interviewSessions ?? [],
    settings: d.settings,
    voice: d.voice ?? { lang: 'zh-CN' },
  }
}

/** 浏览器端触发下载整库备份 JSON。 */
export function downloadBackup(state: AppState): void {
  if (typeof document === 'undefined') return
  const payload = JSON.stringify(buildBackup(state), null, 2)
  const blob = new Blob([payload], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  a.href = url
  a.download = `skill-qa-agent-backup-${stamp}.json`
  a.click()
  URL.revokeObjectURL(url)
}

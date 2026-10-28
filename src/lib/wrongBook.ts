import type { AppState, AttemptAnalysis, Correction } from '../types'

export type WrongItem = {
  key: string
  kind: 'quiz' | 'interview'
  score: number
  feedback: string
  userAnswer: string
  question: string
  kpIds: string[]
  courseIds: string[]
  analysis?: AttemptAnalysis
  createdAt: number
  mastered: boolean
  earlier: { score: number; userAnswer: string; createdAt: number }[]
}

function effectiveScore(questionId: string, score: number, corrections: Correction[]): number {
  const fixes = corrections.filter(
    (c) => c.targetType === 'answer' && c.targetId === questionId && c.field === 'score',
  )
  const last = fixes[fixes.length - 1]
  if (!last) return score
  const n = Number(last.corrected)
  return Number.isFinite(n) ? n : score
}

/** 从已有作答和面试记录整理错题。低于 60 分入册；后来考过或手动标记的进已掌握。 */
export function buildWrongItems(state: Pick<
  AppState,
  'answers' | 'questions' | 'knowledgePoints' | 'corrections' | 'interviewSessions' | 'masteredWrongIds'
>): WrongItem[] {
  const mastered = new Set(state.masteredWrongIds ?? [])
  const questionById = new Map(state.questions.map((q) => [q.id, q]))
  const kpById = new Map(state.knowledgePoints.map((k) => [k.id, k]))
  const items: WrongItem[] = []

  const byQuestion = new Map<string, typeof state.answers>()
  for (const answer of state.answers) {
    const list = byQuestion.get(answer.questionId) ?? []
    list.push(answer)
    byQuestion.set(answer.questionId, list)
  }

  for (const [questionId, list] of byQuestion) {
    const ordered = [...list].sort((a, b) => a.createdAt - b.createdAt)
    const latest = ordered[ordered.length - 1]
    const question = questionById.get(questionId)
    if (!question) continue
    const kp = kpById.get(question.kpId)
    const scoreOf = (answer: (typeof ordered)[number]) =>
      effectiveScore(questionId, answer.score, state.corrections)
    const latestScore = scoreOf(latest)
    const fail =
      latestScore < 60 ? latest : [...ordered].reverse().find((answer) => scoreOf(answer) < 60)
    if (!fail) continue
    const isMastered = latestScore >= 60 || mastered.has(fail.id)
    if (latestScore < 60 && !isMastered) {
      /* 在册 */
    } else if (!isMastered) {
      continue
    }
    items.push({
      key: fail.id,
      kind: 'quiz',
      score: scoreOf(fail),
      feedback: fail.feedback,
      userAnswer: fail.userAnswer,
      question: question.stem,
      kpIds: [question.kpId],
      courseIds: kp ? [kp.courseId] : [],
      analysis: fail.analysis,
      createdAt: fail.createdAt,
      mastered: isMastered,
      earlier: ordered
        .filter((answer) => answer.id !== fail.id)
        .map((answer) => ({
          score: scoreOf(answer),
          userAnswer: answer.userAnswer,
          createdAt: answer.createdAt,
        })),
    })
  }

  state.interviewSessions.forEach((session) => {
    session.history.forEach((round, index) => {
      if (round.score >= 60) return
      const key = `${session.id}:${index}`
      const kps = (round.kpIds ?? []).map((id) => kpById.get(id)).filter((kp) => !!kp)
      items.push({
        key,
        kind: 'interview',
        score: round.score,
        feedback: round.feedback,
        userAnswer: round.userAnswer,
        question: round.question,
        kpIds: round.kpIds ?? [],
        courseIds: [...new Set(kps.map((kp) => kp.courseId))],
        analysis: round.analysis,
        createdAt: session.createdAt,
        mastered: mastered.has(key),
        earlier: [],
      })
    })
  })

  return items.sort((a, b) => b.createdAt - a.createdAt)
}

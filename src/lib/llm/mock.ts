import type { ChatMessage, LLMProvider, LLMTask } from './provider'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
const truncate = (s: string, n = 24) => (s.length > n ? s.slice(0, n) + '…' : s)

/**
 * 离线 Mock 提供器：无 Key / 无网络时也能完整跑通自测流程，
 * 同时作为"真实模型不可用"时的兜底。生产环境建议关闭。
 */
export const mockProvider: LLMProvider = {
  id: 'mock',
  label: 'Mock（离线演示）',
  async *streamChat(messages, opts) {
    const task: LLMTask = opts?.task ?? 'followup'
    const lastUser =
      [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    let out = ''

    if (task === 'generate') {
      out = JSON.stringify([
        {
          type: 'choice',
          stem: `关于「${truncate(lastUser)}」，下列说法正确的是？`,
          options: ['A. 选项一', 'B. 选项二', 'C. 选项三', 'D. 选项四'],
          modelAnswer: 'A. 选项一',
          difficulty: 'easy',
          explanation: '（Mock）请接入真实模型以获得权威题目与解析。',
        },
        {
          type: 'short_answer',
          stem: `简述「${truncate(lastUser)}」的核心要点。`,
          modelAnswer: '（Mock）要点一、要点二、要点三。',
          difficulty: 'medium',
          explanation: '（Mock）按知识点展开即可。',
        },
      ])
    } else if (task === 'optimize') {
      out = `（Mock 补充）这是离线占位，不是真实讲解。接入模型后可重新生成「${truncate(lastUser)}」的补充与拓展。`
    } else if (task === 'score' || task === 'interview_score') {
      const ok = lastUser.length > 40
      out = JSON.stringify(
        ok
          ? {
              score: 85,
              correct: true,
              feedback: '（Mock）评分仅用于演示流程，请接入真实模型获取权威评分。',
              weakPoints: [],
              lossPoints: [],
              explanation: '',
              complexity: 'simple',
              references: [],
            }
          : {
              score: 45,
              correct: false,
              feedback: '（Mock）这题还没答到点子上。',
              weakPoints: ['示例薄弱点：建议结合实际场景理解'],
              lossPoints: [{ point: '缺少关键定义', why: '（Mock）回答没有覆盖知识点里的核心概念。' }],
              explanation: '（Mock）先记住这一节的定义，再用自己的话举一个例子。',
              complexity: 'simple',
              references: [],
            },
      )
    } else if (task === 'interview_q') {
      out = JSON.stringify({
        question: `（Mock）请说明「${truncate(lastUser)}」的定义和一处权衡。`,
        intent: '基础概念',
        reference: '能说出定义，并举一个实际取舍。',
      })
    } else if (task === 'interview_eval') {
      out = JSON.stringify({
        overall: 70,
        level: '待提升',
        strengths: ['愿意作答'],
        weaknesses: ['（Mock）这是离线占位评估'],
        recommendation: '接入真实模型后再看总评。',
      })
    } else if (task === 'outline') {
      out = JSON.stringify({
        chapters: [
          {
            title: '基础概念',
            blurb: '先把这一主题的词汇说清楚。',
            children: [{ title: '核心术语', blurb: '能用自己的话下定义。', children: [] }],
          },
          { title: '动手实践', blurb: '做一个最小例子。', children: [] },
        ],
      })
    } else if (task === 'chapter_kps') {
      out = JSON.stringify({
        points: [
          {
            title: `（Mock）${truncate(lastUser, 12)}`,
            content: '（Mock）这是离线生成的知识点正文。接入模型后可以按同一章节重新生成。',
          },
        ],
      })
    } else if (task === 'interest') {
      out = JSON.stringify({
        action: 'points',
        chapterTitle: '',
        points: [
          {
            title: '兴趣补充',
            content: `（Mock）围绕「${truncate(lastUser, 16)}」写的占位正文。`,
          },
        ],
      })
    } else {
      out = `（Mock 追问）你已经掌握了基础概念，能否进一步说明「${truncate(
        lastUser,
      )}」在实际工程中的权衡与边界情况？`
    }

    for (const ch of out) {
      yield ch
      await delay(4)
    }
  },
}

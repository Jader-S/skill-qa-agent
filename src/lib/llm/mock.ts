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
    } else if (task === 'score') {
      const ok = lastUser.length > 8
      out = JSON.stringify({
        score: ok ? 85 : 60,
        correct: ok,
        feedback: '（Mock）评分仅用于演示流程，请接入真实模型获取权威评分。',
        weakPoints: ['示例薄弱点：建议结合实际场景理解'],
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
